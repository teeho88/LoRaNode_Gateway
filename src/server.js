const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// GPIO control for AS32-TTL-100 (Raspberry Pi only)
let Gpio;
try {
  Gpio = require('onoff').Gpio;
} catch (err) {
  // onoff not available (Windows/Mac) - GPIO control disabled
  Gpio = null;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const SERIAL_PORT = process.env.SERIAL_PORT || '/dev/ttyUSB0'; // Default for Raspberry Pi
const BAUD_RATE = parseInt(process.env.BAUD_RATE) || 9600;
const MAX_HISTORY = parseInt(process.env.MAX_HISTORY) || 500; // Reduced for RPi

// File paths for persistence
const DATA_DIR = path.join(__dirname, '../data');
const DAILY_STATS_FILE = path.join(DATA_DIR, 'daily-stats.json');
const BACKUP_INTERVAL = parseInt(process.env.BACKUP_INTERVAL) || 3600000; // 1 hour default

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('Created data directory:', DATA_DIR);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Data storage (in-memory, optimized for Raspberry Pi)
const sensorData = new Map();
const dataHistory = [];
let connectedClients = 0;

// Daily statistics storage: Map<nodeId, Map<date, stats>>
const dailyStats = new Map();

// Helper function to get date string (YYYY-MM-DD)
function getDateString(date = new Date()) {
  return date.toISOString().split('T')[0];
}

// Helper function to get time string (HH:MM:SS)
function getTimeString(date = new Date()) {
  return date.toTimeString().split(' ')[0];
}

// Initialize or update daily stats for a node
function updateDailyStats(nodeId, temp, hum, timestamp) {
  const date = getDateString(new Date(timestamp));

  if (!dailyStats.has(nodeId)) {
    dailyStats.set(nodeId, new Map());
  }

  const nodeStats = dailyStats.get(nodeId);

  if (!nodeStats.has(date)) {
    nodeStats.set(date, {
      date,
      nodeId,
      tempMax: temp,
      tempMin: temp,
      humMax: hum,
      humMin: hum,
      tempMaxTime: timestamp,
      tempMinTime: timestamp,
      humMaxTime: timestamp,
      humMinTime: timestamp,
      count: 1,
      firstRecord: timestamp,
      lastRecord: timestamp
    });
  } else {
    const stats = nodeStats.get(date);

    // Update temperature stats
    if (temp > stats.tempMax) {
      stats.tempMax = temp;
      stats.tempMaxTime = timestamp;
    }
    if (temp < stats.tempMin) {
      stats.tempMin = temp;
      stats.tempMinTime = timestamp;
    }

    // Update humidity stats
    if (hum > stats.humMax) {
      stats.humMax = hum;
      stats.humMaxTime = timestamp;
    }
    if (hum < stats.humMin) {
      stats.humMin = hum;
      stats.humMinTime = timestamp;
    }

    stats.count++;
    stats.lastRecord = timestamp;
  }
}

// Save daily stats to SD card
function saveDailyStats() {
  try {
    const statsArray = [];
    dailyStats.forEach((nodeStats, nodeId) => {
      nodeStats.forEach((stats, date) => {
        statsArray.push(stats);
      });
    });

    fs.writeFileSync(DAILY_STATS_FILE, JSON.stringify(statsArray, null, 2));
    console.log(`💾 Saved ${statsArray.length} daily stats records`);
  } catch (err) {
    console.error('❌ Failed to save daily stats:', err.message);
  }
}

// Load daily stats from SD card on startup
function loadDailyStats() {
  try {
    if (fs.existsSync(DAILY_STATS_FILE)) {
      const data = JSON.parse(fs.readFileSync(DAILY_STATS_FILE, 'utf8'));

      data.forEach(stats => {
        if (!dailyStats.has(stats.nodeId)) {
          dailyStats.set(stats.nodeId, new Map());
        }
        dailyStats.get(stats.nodeId).set(stats.date, stats);
      });

      console.log(`📂 Loaded ${data.length} daily stats records`);
    } else {
      console.log('📂 No previous stats found (starting fresh)');
    }
  } catch (err) {
    console.error('❌ Failed to load daily stats:', err.message);
  }
}

// Cleanup old daily stats (keep only last 30 days)
function cleanupOldStats() {
  try {
    const today = new Date();
    const cutoffDate = new Date(today);
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    const cutoffString = getDateString(cutoffDate);

    let removedCount = 0;
    dailyStats.forEach((nodeStats, nodeId) => {
      const datesToRemove = [];
      nodeStats.forEach((stats, date) => {
        if (date < cutoffString) {
          datesToRemove.push(date);
        }
      });

      datesToRemove.forEach(date => {
        nodeStats.delete(date);
        removedCount++;
      });

      // Remove node entry if no stats remain
      if (nodeStats.size === 0) {
        dailyStats.delete(nodeId);
      }
    });

    if (removedCount > 0) {
      console.log(`🗑️  Cleaned up ${removedCount} old records (>30 days)`);
      saveDailyStats(); // Save after cleanup
    }
  } catch (err) {
    console.error('Failed to cleanup old stats:', err.message);
  }
}

// GPIO Pin Definitions (BCM numbering) for AS32-TTL-100
const M0_PIN = 23;
const M1_PIN = 24;
const AUX_PIN = 18;

let m0, m1, aux;

// Initialize GPIO for AS32-TTL-100 control (Raspberry Pi only)
function initGPIO() {
  if (!Gpio) {
    console.log('⚠️  GPIO not available (not running on Raspberry Pi)');
    return;
  }

  // OPTION 1: Hardwired M0, M1 to GND (recommended if module doesn't support AT config)
  // If your AS32-TTL-100 module doesn't respond to AT commands,
  // simply connect M0 and M1 directly to GND for NORMAL mode
  const USE_HARDWIRED_MODE = true; // Set to false to use GPIO control

  if (USE_HARDWIRED_MODE) {
    console.log('ℹ️  M0 and M1 hardwired to GND (NORMAL mode)');
    console.log('   No GPIO control needed - module always in transmit/receive mode');
    return;
  }

  // OPTION 2: GPIO control (if module supports mode switching)
  try {
    m0 = new Gpio(M0_PIN, 'out');
    m1 = new Gpio(M1_PIN, 'out');
    aux = new Gpio(AUX_PIN, 'in');

    // Set normal mode (M0=0, M1=0) for transmit/receive
    m0.writeSync(0);
    m1.writeSync(0);

    console.log('✅ GPIO initialized: AS32-TTL-100 in NORMAL mode (M0=0, M1=0)');
  } catch (err) {
    console.error('⚠️  GPIO initialization failed:', err.message);
    console.log('   Module must be set to normal mode manually (M0→GND, M1→GND)');
  }
}

// Cleanup GPIO on exit
function cleanupGPIO() {
  try {
    if (m0) m0.unexport();
    if (m1) m1.unexport();
    if (aux) aux.unexport();
  } catch (err) {
    // Ignore cleanup errors
  }
}

// Serial Port Configuration
let port;
let serialBuffer = ''; // Buffer for packet framing (persistent across lines)

function initSerialPort() {
  try {
    port = new SerialPort({
      path: SERIAL_PORT,
      baudRate: BAUD_RATE,
    });

    port.on('open', () => {
      console.log(`\n🔌 Serial Port: ${SERIAL_PORT} @ ${BAUD_RATE} baud`);
      console.log('📡 Packet framing: < > markers enabled');
      console.log('⏳ Waiting for sensor data...\n');
    });

    port.on('error', (err) => {
      console.error('Serial port error:', err.message);
    });

    // Listen to raw data (byte by byte) for better packet framing control
    port.on('data', (data) => {
      try {
        const chunk = data.toString('utf8');

        // Process each character
        for (let char of chunk) {
          if (char === '<') {
            // Start of new packet
            serialBuffer = '';
          } else if (char === '>') {
            // End of packet, process it
            if (serialBuffer.length > 0) {
              try {
                const jsonData = JSON.parse(serialBuffer);
                handleSensorData(jsonData);
              } catch (err) {
                console.error('❌ JSON Parse Error:', err.message);
                console.error('   Buffer:', serialBuffer.substring(0, 100) + '...');
              }
              serialBuffer = '';
            }
          } else if (char !== '\n' && char !== '\r') {
            // Add character to buffer (ignore newlines)
            serialBuffer += char;
          }
        }

        // Fallback: Try to parse as plain JSON (for backward compatibility)
        const trimmed = chunk.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}') &&
            !trimmed.includes('<') && !trimmed.includes('>')) {
          try {
            const jsonData = JSON.parse(trimmed);
            handleSensorData(jsonData);
          } catch (err) {
            // Ignore parse errors for fallback mode
          }
        }
      } catch (err) {
        console.error('❌ Serial Data Error:', err.message);
      }
    });

  } catch (err) {
    console.error('Failed to initialize serial port:', err.message);
    console.log('Running in demo mode without serial connection');
  }
}

function handleSensorData(data) {
  const timestamp = new Date().toISOString();

  // Add timestamp to data
  const dataWithTimestamp = {
    ...data,
    timestamp,
    receivedAt: Date.now()
  };

  // Store latest data for this node
  sensorData.set(data.id, dataWithTimestamp);

  // Add to history (with limit for memory efficiency on RPi)
  dataHistory.push(dataWithTimestamp);
  if (dataHistory.length > MAX_HISTORY) {
    dataHistory.shift();
  }

  // Update daily statistics using average values (from 2 sensors)
  if (data.temp !== undefined && data.hum !== undefined && !data.ack) {
    updateDailyStats(data.id, data.temp, data.hum, timestamp);
  }

  // Log received data in compact format
  if (data.temp1 !== undefined && data.temp2 !== undefined) {
    // 2 sensors format
    console.log(
      `📊 ${data.id} | ` +
      `S1: ${data.temp1}°C ${data.hum1}% | ` +
      `S2: ${data.temp2}°C ${data.hum2}% | ` +
      `Avg: ${data.temp}°C ${data.hum}% | ` +
      `Relay: ${data.relay ? '🟢 ON' : '⚪ OFF'} ${data.manual ? '[Manual]' : '[Auto]'}`
    );
  } else {
    // Single sensor format
    console.log(
      `📊 ${data.id} | ` +
      `${data.temp}°C ${data.hum}% | ` +
      `Relay: ${data.relay ? '🟢 ON' : '⚪ OFF'} ${data.manual ? '[Manual]' : '[Auto]'}`
    );
  }

  // Broadcast to connected WebSocket clients
  io.emit('sensorData', dataWithTimestamp);

  // Check for acknowledgments
  if (data.ack) {
    console.log(`✅ ACK from ${data.id}: Relay ${data.relay ? '🟢 ON' : '⚪ OFF'}`);
    io.emit('commandAck', { nodeId: data.id, relay: data.relay });
  }
}

function sendCommand(command) {
  if (!port || !port.isOpen) {
    throw new Error('Serial port not available');
  }

  // Add packet framing with < > markers
  const commandString = '<' + JSON.stringify(command) + '>\n';
  port.write(commandString, (err) => {
    if (err) {
      console.error('❌ Command send error:', err.message);
      throw err;
    }
    console.log(`📤 Command → ${command.target}: ${command.relay !== undefined ? `Relay ${command.relay ? 'ON' : 'OFF'}` : ''}${command.auto !== undefined ? 'Mode AUTO' : ''}`);
  });
}

// API Routes

// Get all sensor nodes data
app.get('/api/nodes', (req, res) => {
  const nodes = Array.from(sensorData.values());
  res.json({
    success: true,
    count: nodes.length,
    data: nodes
  });
});

// Get specific node data
app.get('/api/nodes/:id', (req, res) => {
  const nodeId = req.params.id;
  const data = sensorData.get(nodeId);

  if (!data) {
    return res.status(404).json({
      success: false,
      message: `Node ${nodeId} not found`
    });
  }

  res.json({
    success: true,
    data
  });
});

// Get data history with date/time filtering
app.get('/api/history', (req, res) => {
  const { nodeId, limit = 100, date, startTime, endTime } = req.query;

  if (!nodeId) {
    return res.status(400).json({
      success: false,
      message: 'nodeId is required for history'
    });
  }

  let history = dataHistory;

  // Filter by node ID
  history = history.filter(d => d.id === nodeId);

  // Filter by date (YYYY-MM-DD)
  if (date) {
    history = history.filter(d => {
      const recordDate = getDateString(new Date(d.timestamp));
      return recordDate === date;
    });
  }

  // Filter by time range (HH:MM:SS format)
  if (startTime || endTime) {
    history = history.filter(d => {
      const recordTime = getTimeString(new Date(d.timestamp));
      const afterStart = !startTime || recordTime >= startTime;
      const beforeEnd = !endTime || recordTime <= endTime;
      return afterStart && beforeEnd;
    });
  }

  const limitedHistory = history.slice(-parseInt(limit));

  res.json({
    success: true,
    count: limitedHistory.length,
    data: limitedHistory
  });
});

// Control relay
app.post('/api/control/relay', (req, res) => {
  const { target, relay, auto } = req.body;

  if (!target) {
    return res.status(400).json({
      success: false,
      message: 'Target node ID is required'
    });
  }

  try {
    const command = { target };

    if (relay !== undefined) {
      command.relay = Boolean(relay);
    }

    if (auto !== undefined) {
      command.auto = Boolean(auto);
    }

    sendCommand(command);

    res.json({
      success: true,
      message: `Command sent to ${target}`,
      command
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// Get daily statistics for a node
app.get('/api/daily-stats/:nodeId', (req, res) => {
  const { nodeId } = req.params;
  const { date } = req.query;

  if (!dailyStats.has(nodeId)) {
    return res.status(404).json({
      success: false,
      message: `No statistics found for node ${nodeId}`
    });
  }

  const nodeStats = dailyStats.get(nodeId);

  if (date) {
    // Get stats for specific date
    const stats = nodeStats.get(date);
    if (!stats) {
      return res.status(404).json({
        success: false,
        message: `No statistics found for ${nodeId} on ${date}`
      });
    }
    return res.json({
      success: true,
      data: stats
    });
  }

  // Get all dates
  const allStats = Array.from(nodeStats.values()).sort((a, b) =>
    new Date(b.date) - new Date(a.date)
  );

  res.json({
    success: true,
    count: allStats.length,
    data: allStats
  });
});

// Get today's statistics for all nodes
app.get('/api/daily-stats', (req, res) => {
  const today = getDateString();
  const todayStats = [];

  dailyStats.forEach((nodeStats, nodeId) => {
    const stats = nodeStats.get(today);
    if (stats) {
      todayStats.push(stats);
    }
  });

  res.json({
    success: true,
    date: today,
    count: todayStats.length,
    data: todayStats
  });
});

// Get system status
app.get('/api/status', (req, res) => {
  const memUsage = process.memoryUsage();

  // Count total daily stats entries
  let totalDailyStats = 0;
  dailyStats.forEach(nodeStats => {
    totalDailyStats += nodeStats.size;
  });

  res.json({
    success: true,
    status: 'running',
    serialPort: {
      path: SERIAL_PORT,
      baudRate: BAUD_RATE,
      isOpen: port ? port.isOpen : false
    },
    nodes: sensorData.size,
    historySize: dataHistory.length,
    dailyStatsCount: totalDailyStats,
    connectedClients,
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB'
    },
    uptime: Math.round(process.uptime()) + 's'
  });
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// WebSocket connection handling
io.on('connection', (socket) => {
  connectedClients++;
  console.log(`🌐 Client connected (Total: ${connectedClients})`);

  // Send current data to newly connected client
  socket.emit('initialData', {
    nodes: Array.from(sensorData.values()),
    history: dataHistory.slice(-50) // Last 50 records
  });

  socket.on('disconnect', () => {
    connectedClients--;
    console.log(`🔌 Client disconnected (Total: ${connectedClients})`);
  });

  // Handle control commands from web interface
  socket.on('controlRelay', (data) => {
    try {
      sendCommand(data);
      socket.emit('commandSent', { success: true, command: data });
    } catch (err) {
      socket.emit('commandError', { success: false, message: err.message });
    }
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 LoRa Gateway Server Started');
  console.log('='.repeat(60));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌐 Dashboard: http://localhost:${PORT}`);
  console.log(`📡 API Endpoints:`);
  console.log(`   GET  /api/nodes           - All nodes`);
  console.log(`   GET  /api/nodes/:id       - Specific node`);
  console.log(`   GET  /api/history         - Data history`);
  console.log(`   POST /api/control/relay   - Control relay`);
  console.log(`   GET  /api/status          - System status`);
  console.log('='.repeat(60));

  // Load persisted daily stats from SD card
  loadDailyStats();

  // Initialize GPIO for AS32-TTL-100 control (Raspberry Pi only)
  initGPIO();

  // Initialize serial port
  initSerialPort();

  // Start periodic backup timer (hourly by default)
  setInterval(() => {
    saveDailyStats();
  }, BACKUP_INTERVAL);

  // Daily cleanup at midnight (remove stats older than 30 days)
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0); // Next midnight
  const timeUntilMidnight = midnight - now;

  setTimeout(() => {
    cleanupOldStats();
    // Schedule daily cleanup
    setInterval(() => {
      cleanupOldStats();
    }, 24 * 60 * 60 * 1000); // Every 24 hours
  }, timeUntilMidnight);

  console.log(`💾 Auto-backup: every ${BACKUP_INTERVAL / 1000 / 60} minutes\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');

  // Save daily stats before exit
  saveDailyStats();

  // Cleanup GPIO
  cleanupGPIO();

  if (port && port.isOpen) {
    port.close(() => {
      console.log('Serial port closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

// Also handle SIGTERM for systemd
process.on('SIGTERM', () => {
  console.log('\nSIGTERM received, saving data...');
  saveDailyStats();

  // Cleanup GPIO
  cleanupGPIO();

  if (port && port.isOpen) {
    port.close(() => {
      console.log('Serial port closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});
