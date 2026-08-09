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
const USE_GPIO_LORA_MODE = String(process.env.USE_GPIO_LORA_MODE || 'false').toLowerCase() === 'true';

// File paths for persistence
const DATA_DIR = path.join(__dirname, '../data');
const DAILY_STATS_FILE = path.join(DATA_DIR, 'daily-stats.json');
const NODE_CONFIGS_FILE = path.join(DATA_DIR, 'node-configs.json');
const LORA_NETWORK_FILE = path.join(DATA_DIR, 'lora-network.json');
const GATEWAY_SYNC_FILE = path.join(DATA_DIR, 'gateway-lora-sync.json');
const BACKUP_INTERVAL = parseInt(process.env.BACKUP_INTERVAL) || 3600000; // 1 hour default
const ANALYTICS_WINDOW_MINUTES = parseInt(process.env.ANALYTICS_WINDOW_MINUTES, 10) || 120;
const ANALYTICS_FORECAST_MINUTES = parseInt(process.env.ANALYTICS_FORECAST_MINUTES, 10) || 30;
const ANALYTICS_TEMP_HIGH = Number(process.env.ANALYTICS_TEMP_HIGH || 32);
const ANALYTICS_HUM_HIGH = Number(process.env.ANALYTICS_HUM_HIGH || 75);
const ANALYTICS_ANOMALY_ZSCORE = Number(process.env.ANALYTICS_ANOMALY_ZSCORE || 2.5);
const NODE_OFFLINE_SECONDS = parseInt(process.env.NODE_OFFLINE_SECONDS, 10) || 150;

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('Created data directory:', DATA_DIR);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, filePath) => {
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8'
    };

    const contentType = contentTypes[path.extname(filePath).toLowerCase()];
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
  }
}));

// Data storage (in-memory, optimized for Raspberry Pi)
const sensorData = new Map();
const dataHistory = [];
let connectedClients = 0;

// Daily statistics storage: Map<nodeId, Map<date, stats>>
const dailyStats = new Map();

// Node configuration storage: Map<nodeId, config>
const nodeConfigs = new Map();

const DEFAULT_LORA_NETWORK = {
  gatewayAddress: 0,
  networkId: 0,
  channel: 23,
  baudRateCode: 9,
  airRate: 5,
  power: 0
};

let loraNetwork = {
  ...DEFAULT_LORA_NETWORK,
  updatedAt: new Date().toISOString()
};

let gatewayLoraSync = {
  requiredProfileVersion: loraNetwork.updatedAt,
  appliedProfileVersion: null,
  inSync: false,
  updatedAt: new Date().toISOString(),
  note: 'Gateway profile chưa được xác nhận.'
};

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

function saveNodeConfigs() {
  try {
    const configs = Array.from(nodeConfigs.values());
    fs.writeFileSync(NODE_CONFIGS_FILE, JSON.stringify(configs, null, 2));
  } catch (err) {
    console.error('❌ Failed to save node configs:', err.message);
  }
}

function loadNodeConfigs() {
  try {
    if (!fs.existsSync(NODE_CONFIGS_FILE)) {
      console.log('📂 No node configs found (starting fresh)');
      return;
    }

    const configs = JSON.parse(fs.readFileSync(NODE_CONFIGS_FILE, 'utf8'));
    configs.forEach(config => {
      const configKey = String(config.targetUid || config.nodeId || '').trim();
      if (configKey) {
        nodeConfigs.set(configKey, config);
      }
    });

    console.log(`📂 Loaded ${configs.length} node config records`);
  } catch (err) {
    console.error('❌ Failed to load node configs:', err.message);
  }
}

function saveLoraNetwork() {
  try {
    fs.writeFileSync(LORA_NETWORK_FILE, JSON.stringify(loraNetwork, null, 2));
  } catch (err) {
    console.error('❌ Failed to save LoRa network config:', err.message);
  }
}

function loadLoraNetwork() {
  try {
    if (!fs.existsSync(LORA_NETWORK_FILE)) {
      console.log('📂 No LoRa network config found (using defaults)');
      saveLoraNetwork();
      return;
    }

    loraNetwork = normalizeLoraNetwork(JSON.parse(fs.readFileSync(LORA_NETWORK_FILE, 'utf8')));
    console.log('📂 Loaded LoRa network config');
  } catch (err) {
    console.error('❌ Failed to load LoRa network config:', err.message);
  }
}

function saveGatewayLoraSync() {
  try {
    fs.writeFileSync(GATEWAY_SYNC_FILE, JSON.stringify(gatewayLoraSync, null, 2));
  } catch (err) {
    console.error('❌ Failed to save gateway LoRa sync state:', err.message);
  }
}

function refreshGatewaySyncState(note) {
  const requiredProfileVersion = loraNetwork.updatedAt;
  gatewayLoraSync = {
    requiredProfileVersion,
    appliedProfileVersion: gatewayLoraSync.appliedProfileVersion || null,
    inSync: gatewayLoraSync.appliedProfileVersion === requiredProfileVersion,
    updatedAt: new Date().toISOString(),
    note: note || gatewayLoraSync.note || ''
  };
}

function loadGatewayLoraSync() {
  try {
    if (fs.existsSync(GATEWAY_SYNC_FILE)) {
      const data = JSON.parse(fs.readFileSync(GATEWAY_SYNC_FILE, 'utf8'));
      gatewayLoraSync = {
        ...gatewayLoraSync,
        requiredProfileVersion: data.requiredProfileVersion || gatewayLoraSync.requiredProfileVersion,
        appliedProfileVersion: data.appliedProfileVersion || null,
        updatedAt: data.updatedAt || gatewayLoraSync.updatedAt,
        note: data.note || gatewayLoraSync.note
      };
    }
  } catch (err) {
    console.error('❌ Failed to load gateway LoRa sync state:', err.message);
  }

  refreshGatewaySyncState(gatewayLoraSync.note);
  saveGatewayLoraSync();
}

function confirmGatewaySync(appliedProfileVersion, note) {
  gatewayLoraSync.appliedProfileVersion = appliedProfileVersion || loraNetwork.updatedAt;
  refreshGatewaySyncState(note || 'Đã xác nhận gateway đổi sang profile mạng hiện tại.');
  saveGatewayLoraSync();
  return gatewayLoraSync;
}

function ensureGatewayProfileSynced() {
  refreshGatewaySyncState(gatewayLoraSync.note);
  if (!gatewayLoraSync.inSync) {
    throw new Error(
      `Gateway chưa đồng bộ profile LoRa (required=${gatewayLoraSync.requiredProfileVersion}, applied=${gatewayLoraSync.appliedProfileVersion || 'none'}). Xác nhận gateway trước khi Activate node.`
    );
  }
}

function matchesNodeIdentifier(record, nodeId) {
  if (!nodeId) {
    return true;
  }

  return record.nodeKey === nodeId || record.id === nodeId || record.uid === nodeId;
}

function calculateMean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateStd(values, mean) {
  if (!values.length || mean === null) return null;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function calculateLinearTrend(records, field) {
  if (records.length < 2) {
    return { slopePerMinute: 0 };
  }

  const baseTime = new Date(records[0].timestamp).getTime();
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  records.forEach(record => {
    const x = (new Date(record.timestamp).getTime() - baseTime) / 60000;
    const y = Number(record[field]);
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  });

  const n = records.length;
  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) {
    return { slopePerMinute: 0 };
  }

  const slopePerMinute = (n * sumXY - sumX * sumY) / denominator;
  return { slopePerMinute };
}

function getTrendLabel(slopePerMinute, stableBand = 0.02) {
  if (Math.abs(slopePerMinute) <= stableBand) return 'stable';
  return slopePerMinute > 0 ? 'rising' : 'falling';
}

function computeNodeAnalytics(records, forecastMinutes) {
  const sorted = records
    .filter(item => !item.ack && Number.isFinite(Number(item.temp)) && Number.isFinite(Number(item.hum)))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (!sorted.length) {
    return null;
  }

  const temps = sorted.map(item => Number(item.temp));
  const hums = sorted.map(item => Number(item.hum));
  const last = sorted[sorted.length - 1];
  const tempTrend = calculateLinearTrend(sorted, 'temp');
  const humTrend = calculateLinearTrend(sorted, 'hum');
  const forecastTemp = Number((Number(last.temp) + tempTrend.slopePerMinute * forecastMinutes).toFixed(2));
  const forecastHum = Number((Number(last.hum) + humTrend.slopePerMinute * forecastMinutes).toFixed(2));

  const tempMean = calculateMean(temps);
  const humMean = calculateMean(hums);
  const tempStd = calculateStd(temps, tempMean);
  const humStd = calculateStd(hums, humMean);

  let anomalyCount = 0;
  sorted.forEach(item => {
    const tempZ = tempStd && tempStd > 0 ? Math.abs((Number(item.temp) - tempMean) / tempStd) : 0;
    const humZ = humStd && humStd > 0 ? Math.abs((Number(item.hum) - humMean) / humStd) : 0;
    if (tempZ >= ANALYTICS_ANOMALY_ZSCORE || humZ >= ANALYTICS_ANOMALY_ZSCORE) {
      anomalyCount++;
    }
  });

  const riskScore = Math.max(
    Number(last.temp) / ANALYTICS_TEMP_HIGH,
    forecastTemp / ANALYTICS_TEMP_HIGH,
    Number(last.hum) / ANALYTICS_HUM_HIGH,
    forecastHum / ANALYTICS_HUM_HIGH
  );

  let riskLevel = 'low';
  if (riskScore >= 1.15) {
    riskLevel = 'high';
  } else if (riskScore >= 0.95) {
    riskLevel = 'medium';
  }

  const latestNode = getLiveNode(last.nodeKey || last.uid || last.id) || last;
  const nodeKey = latestNode.nodeKey || latestNode.uid || latestNode.id;

  return {
    nodeKey,
    nodeId: latestNode.id,
    uid: latestNode.uid || null,
    sampleCount: sorted.length,
    lastTimestamp: last.timestamp,
    current: {
      temp: Number(last.temp),
      hum: Number(last.hum)
    },
    forecast: {
      minutes: forecastMinutes,
      temp: forecastTemp,
      hum: forecastHum
    },
    trend: {
      tempPerHour: Number((tempTrend.slopePerMinute * 60).toFixed(3)),
      humPerHour: Number((humTrend.slopePerMinute * 60).toFixed(3)),
      tempDirection: getTrendLabel(tempTrend.slopePerMinute),
      humDirection: getTrendLabel(humTrend.slopePerMinute)
    },
    anomalyCount,
    riskLevel
  };
}

function getAnalyticsOverview(options = {}) {
  const now = Date.now();
  const windowMinutes = Number.isFinite(Number(options.windowMinutes))
    ? Math.min(Math.max(Number(options.windowMinutes), 15), 1440)
    : ANALYTICS_WINDOW_MINUTES;
  const forecastMinutes = Number.isFinite(Number(options.forecastMinutes))
    ? Math.min(Math.max(Number(options.forecastMinutes), 5), 180)
    : ANALYTICS_FORECAST_MINUTES;
  const nodeIdFilter = String(options.nodeId || '').trim();
  const windowStart = now - windowMinutes * 60 * 1000;

  const recentRecords = dataHistory.filter(item =>
    !item.ack &&
    new Date(item.timestamp).getTime() >= windowStart &&
    matchesNodeIdentifier(item, nodeIdFilter)
  );

  const grouped = new Map();
  recentRecords.forEach(item => {
    const key = item.nodeKey || item.uid || item.id;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(item);
  });

  const nodes = [];
  grouped.forEach(records => {
    const analytics = computeNodeAnalytics(records, forecastMinutes);
    if (analytics) {
      nodes.push(analytics);
    }
  });

  const avgTemp = nodes.length ? Number((nodes.reduce((sum, item) => sum + item.current.temp, 0) / nodes.length).toFixed(2)) : null;
  const avgHum = nodes.length ? Number((nodes.reduce((sum, item) => sum + item.current.hum, 0) / nodes.length).toFixed(2)) : null;

  return {
    generatedAt: new Date().toISOString(),
    windowMinutes,
    forecastMinutes,
    count: nodes.length,
    summary: {
      avgTemp,
      avgHum,
      highRiskNodes: nodes.filter(node => node.riskLevel === 'high').length,
      mediumRiskNodes: nodes.filter(node => node.riskLevel === 'medium').length,
      anomalyNodes: nodes.filter(node => node.anomalyCount > 0).length
    },
    nodes: nodes.sort((a, b) => {
      const riskOrder = { high: 0, medium: 1, low: 2 };
      return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    })
  };
}

function getMedian(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function getHealthLevel(score) {
  if (score < 50) return 'critical';
  if (score < 80) return 'warning';
  return 'good';
}

function buildNodeHealthRecord(node, analytics) {
  const nodeKey = node.nodeKey || node.uid || node.id;
  const lastSeen = node.receivedAt || new Date(node.timestamp || 0).getTime();
  const lastSeenSeconds = Math.max(0, Math.round((Date.now() - lastSeen) / 1000));
  const recentRecords = dataHistory
    .filter(item => !item.ack && matchesNodeIdentifier(item, nodeKey))
    .slice(-60)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const intervals = [];
  for (let i = 1; i < recentRecords.length; i++) {
    const prev = new Date(recentRecords[i - 1].timestamp).getTime();
    const curr = new Date(recentRecords[i].timestamp).getTime();
    const deltaSeconds = (curr - prev) / 1000;
    if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) {
      intervals.push(deltaSeconds);
    }
  }

  const expectedInterval = getMedian(intervals);
  const recommendations = [];
  let score = 100;

  if (lastSeenSeconds > NODE_OFFLINE_SECONDS) {
    score -= 55;
    recommendations.push('Node im lang qua lau, hay kiem tra nguon, anten va khoang cach LoRa.');
  } else if (lastSeenSeconds > NODE_OFFLINE_SECONDS * 0.6) {
    score -= 20;
    recommendations.push('Node dang cham gan nguong offline, nen kiem tra song hoac nguon.');
  }

  if (expectedInterval && expectedInterval > NODE_OFFLINE_SECONDS * 0.4) {
    score -= 15;
    recommendations.push('Goi tin khong deu, nen kiem tra nhieu song hoac vi tri anten.');
  }

  if (!Number.isFinite(Number(node.temp)) || !Number.isFinite(Number(node.hum))) {
    score -= 30;
    recommendations.push('Du lieu cam bien khong hop le, hay kiem tra DHT va day DATA.');
  }

  if (analytics?.riskLevel === 'high') {
    score -= 25;
    recommendations.push('Moi truong dang hoac sap vuot nguong cao, uu tien kiem tra thong gio/quat.');
  } else if (analytics?.riskLevel === 'medium') {
    score -= 10;
    recommendations.push('Moi truong gan nguong, nen theo doi sat trong cua so du bao tiep theo.');
  }

  if ((analytics?.anomalyCount || 0) > 0) {
    score -= Math.min(20, analytics.anomalyCount * 5);
    recommendations.push('Co diem do bat thuong, nen kiem tra cam bien va vi tri lap.');
  }

  if (node.manual) {
    score -= 5;
    recommendations.push('Node dang o manual, can nhac chuyen AUTO sau khi kiem tra thuc te.');
  }

  score = Math.max(0, Math.round(score));
  if (!recommendations.length) {
    recommendations.push('Node hoat dong on dinh trong cua so quan sat.');
  }

  return {
    nodeKey,
    nodeId: node.id,
    uid: node.uid || null,
    healthScore: score,
    healthLevel: getHealthLevel(score),
    online: lastSeenSeconds <= NODE_OFFLINE_SECONDS,
    lastSeenSeconds,
    expectedInterval: expectedInterval ? Math.round(expectedInterval) : null,
    sampleCount: recentRecords.length,
    current: {
      temp: Number.isFinite(Number(node.temp)) ? Number(node.temp) : null,
      hum: Number.isFinite(Number(node.hum)) ? Number(node.hum) : null,
      relay: Boolean(node.relay),
      manual: Boolean(node.manual)
    },
    analytics: analytics ? {
      riskLevel: analytics.riskLevel,
      anomalyCount: analytics.anomalyCount,
      forecast: analytics.forecast,
      trend: analytics.trend
    } : null,
    recommendations
  };
}

function getNodeHealthOverview(options = {}) {
  const analyticsOverview = getAnalyticsOverview(options);
  const analyticsByKey = new Map();

  analyticsOverview.nodes.forEach(item => {
    analyticsByKey.set(item.nodeKey, item);
    if (item.uid) analyticsByKey.set(item.uid, item);
    if (item.nodeId) analyticsByKey.set(item.nodeId, item);
  });

  const nodeIdFilter = String(options.nodeId || '').trim();
  const nodes = Array.from(sensorData.values())
    .filter(node => matchesNodeIdentifier(node, nodeIdFilter))
    .map(node => {
      const key = node.nodeKey || node.uid || node.id;
      return buildNodeHealthRecord(node, analyticsByKey.get(key) || analyticsByKey.get(node.uid) || analyticsByKey.get(node.id));
    })
    .sort((a, b) => a.healthScore - b.healthScore);

  return {
    generatedAt: new Date().toISOString(),
    count: nodes.length,
    offlineThreshold: NODE_OFFLINE_SECONDS,
    summary: {
      good: nodes.filter(item => item.healthLevel === 'good').length,
      warning: nodes.filter(item => item.healthLevel === 'warning').length,
      critical: nodes.filter(item => item.healthLevel === 'critical').length,
      offline: nodes.filter(item => !item.online).length
    },
    nodes
  };
}

function resolveNodeIdentity(target, targetUid) {
  const inputTarget = String(target || '').trim();
  const inputTargetUid = String(targetUid || '').trim();
  const lookupKey = inputTargetUid || inputTarget;
  const liveNode = lookupKey ? getLiveNode(lookupKey) : null;
  const storedConfig = lookupKey ? getOptionalStoredNodeConfig(lookupKey) : null;
  const resolvedTarget = liveNode?.id || storedConfig?.target || storedConfig?.nodeId || inputTarget;
  const resolvedTargetUid = inputTargetUid || liveNode?.uid || storedConfig?.targetUid || '';

  return {
    inputTarget,
    inputTargetUid,
    target: resolvedTarget,
    targetUid: resolvedTargetUid,
    liveNode,
    storedConfig
  };
}

function normalizeLoraNetwork(body) {
  const numericFields = {
    gatewayAddress: { min: 0, max: 65535 },
    networkId: { min: 0, max: 255 },
    channel: { min: 0, max: 80 },
    baudRateCode: { min: 0, max: 19 },
    airRate: { min: 0, max: 10 },
    power: { min: 0, max: 3 }
  };

  const config = {
    ...DEFAULT_LORA_NETWORK,
    updatedAt: new Date().toISOString()
  };

  Object.entries(numericFields).forEach(([field, range]) => {
    const rawValue = body[field] !== undefined && body[field] !== '' ? body[field] : config[field];
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < range.min || value > range.max) {
      throw new Error(`${field} must be an integer from ${range.min} to ${range.max}`);
    }

    config[field] = value;
  });

  return config;
}

function normalizeNodeConfig(body) {
  const identity = resolveNodeIdentity(body.target, body.targetUid);
  const currentId = identity.target;
  const targetUid = identity.targetUid;
  const nodeId = String(body.nodeId || identity.liveNode?.id || identity.storedConfig?.nodeId || currentId).trim();
  const existingConfig = identity.storedConfig || nodeConfigs.get(nodeId);

  if (!identity.inputTarget && !identity.inputTargetUid) {
    throw new Error('Target node ID or UID is required');
  }

  if (!currentId) {
    throw new Error('Unable to resolve target node ID. Keep node online or provide target ID explicitly.');
  }

  if (!/^[A-Za-z0-9_-]{1,15}$/.test(nodeId)) {
    throw new Error('Node ID must be 1-15 characters: letters, numbers, "_" or "-"');
  }

  const addressRaw = body.address !== undefined && body.address !== ''
    ? body.address
    : existingConfig?.lora?.address || 1;
  const address = Number(addressRaw);
  if (!Number.isInteger(address) || address < 0 || address > 65535) {
    throw new Error('address must be an integer from 0 to 65535');
  }

  const config = {
    target: currentId,
    targetUid,
    nodeId,
    lora: {
      address,
      ...getSharedLoraFields()
    },
    updatedAt: new Date().toISOString()
  };

  return config;
}

function getSharedLoraFields() {
  return {
    networkId: loraNetwork.networkId,
    channel: loraNetwork.channel,
    baudRateCode: loraNetwork.baudRateCode,
    airRate: loraNetwork.airRate,
    power: loraNetwork.power
  };
}

function buildNodeConfigCommand(config, options = {}) {
  const command = {
    target: config.target,
    config: {
      id: config.nodeId,
      applyLora: Boolean(options.applyLora)
    }
  };

  if (config.targetUid) {
    command.targetUid = config.targetUid;
  }

  if (Object.keys(config.lora).length > 0) {
    command.config.lora = config.lora;
  }

  return command;
}

function buildNodeConfigActionCommand(target, action) {
  const config = {};

  if (action === 'commit') {
    config.commitLora = true;
  } else if (action === 'rollback') {
    config.rollbackLora = true;
  } else {
    throw new Error('Unsupported config action');
  }

  const liveNode = getLiveNode(target);
  const storedConfig = getOptionalStoredNodeConfig(target);
  const command = {
    target: liveNode?.id || storedConfig?.target || storedConfig?.nodeId || target,
    config
  };

  const targetUid = liveNode?.uid || storedConfig?.targetUid;
  if (targetUid) {
    command.targetUid = targetUid;
  }

  return command;
}

function getOptionalStoredNodeConfig(target) {
  return nodeConfigs.get(target) ||
    Array.from(nodeConfigs.values()).find(item => item.nodeId === target || item.target === target || item.targetUid === target);
}

function getStoredNodeConfig(target) {
  const config = getOptionalStoredNodeConfig(target);
  if (!config) {
    throw new Error(`No staged configuration found for ${target}`);
  }

  return config;
}

function getLiveNode(target) {
  return sensorData.get(target) ||
    Array.from(sensorData.values()).find(node => node.id === target || node.uid === target || node.nodeKey === target);
}

function getNodeKey(data) {
  return data.uid || data.nodeKey || data.id;
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
  if (!USE_GPIO_LORA_MODE) {
    console.log('ℹ️  M0 and M1 hardwired to GND (NORMAL mode)');
    console.log('   Set USE_GPIO_LORA_MODE=true to let gateway control M0/M1 via GPIO');
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
  const nodeKey = getNodeKey(data);

  // Add timestamp to data
  const dataWithTimestamp = {
    ...data,
    nodeKey,
    timestamp,
    receivedAt: Date.now()
  };

  // Store latest data for this node
  sensorData.set(nodeKey, dataWithTimestamp);

  // Add to history (with limit for memory efficiency on RPi)
  dataHistory.push(dataWithTimestamp);
  if (dataHistory.length > MAX_HISTORY) {
    dataHistory.shift();
  }

  // Update daily statistics using average values (from 2 sensors)
  if (data.temp !== undefined && data.hum !== undefined && !data.ack) {
    updateDailyStats(nodeKey, data.temp, data.hum, timestamp);
  }

  // Log received data in compact format
  if (data.temp1 !== undefined && data.temp2 !== undefined) {
    // 2 sensors format
    const td1 = (data.temp1 - (100 - data.hum1) / 5).toFixed(1);
    const td2 = (data.temp2 - (100 - data.hum2) / 5).toFixed(1);
    console.log(
      `📊 ${data.id} | ` +
      `In: ${data.temp1}°C ${data.hum1}% (Td:${td1}) | ` +
      `Out: ${data.temp2}°C ${data.hum2}% (Td:${td2}) | ` +
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
    if (data.configAck) {
      console.log(`✅ CONFIG ACK from ${data.id}: ${data.message || 'configuration updated'}`);
      io.emit('configAck', {
        nodeId: data.id,
        nodeKey,
        uid: data.uid,
        oldId: data.oldId,
        loraApplied: data.loraApplied,
        rollbackArmed: data.rollbackArmed,
        message: data.message
      });
    } else {
      console.log(`✅ ACK from ${data.id}: Relay ${data.relay ? '🟢 ON' : '⚪ OFF'}`);
      io.emit('commandAck', { nodeId: data.id, nodeKey, uid: data.uid, relay: data.relay });
    }
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
  const data = sensorData.get(nodeId) ||
    Array.from(sensorData.values()).find(node => node.id === nodeId || node.uid === nodeId);

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
  const nodeFilter = String(nodeId || '').trim();

  let history = dataHistory;

  // Filter by node ID
  if (nodeFilter) {
    history = history.filter(d => d.nodeKey === nodeFilter || d.id === nodeFilter || d.uid === nodeFilter);
  }

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

app.get('/api/analytics/overview', (req, res) => {
  try {
    const overview = getAnalyticsOverview({
      windowMinutes: req.query.windowMinutes,
      forecastMinutes: req.query.forecastMinutes,
      nodeId: req.query.nodeId
    });

    res.json({
      success: true,
      ...overview
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message
    });
  }
});

app.get('/api/analytics/alerts', (req, res) => {
  try {
    const overview = getAnalyticsOverview({
      windowMinutes: req.query.windowMinutes,
      forecastMinutes: req.query.forecastMinutes,
      nodeId: req.query.nodeId
    });

    const alerts = overview.nodes
      .filter(node => node.riskLevel !== 'low' || node.anomalyCount > 0)
      .map(node => ({
        nodeKey: node.nodeKey,
        nodeId: node.nodeId,
        uid: node.uid,
        riskLevel: node.riskLevel,
        anomalyCount: node.anomalyCount,
        current: node.current,
        forecast: node.forecast,
        trend: node.trend
      }));

    res.json({
      success: true,
      generatedAt: overview.generatedAt,
      count: alerts.length,
      alerts
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message
    });
  }
});

app.get('/api/analytics/health', (req, res) => {
  try {
    const overview = getNodeHealthOverview({
      windowMinutes: req.query.windowMinutes,
      forecastMinutes: req.query.forecastMinutes,
      nodeId: req.query.nodeId
    });

    res.json({
      success: true,
      ...overview
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message
    });
  }
});

// Control relay
app.post('/api/control/relay', (req, res) => {
  const { target, targetUid, relay, auto } = req.body;

  if (!target && !targetUid) {
    return res.status(400).json({
      success: false,
      message: 'Target node ID or UID is required'
    });
  }

  try {
    const identity = resolveNodeIdentity(target, targetUid);
    const commandTarget = identity.target || String(target || '').trim();
    if (!commandTarget) {
      throw new Error('Unable to resolve target node ID');
    }

    const command = { target: commandTarget };
    if (identity.targetUid) {
      command.targetUid = identity.targetUid;
    }

    if (relay !== undefined) {
      command.relay = Boolean(relay);
    }

    if (auto !== undefined) {
      command.auto = Boolean(auto);
    }

    sendCommand(command);

    res.json({
      success: true,
      message: `Command sent to ${commandTarget}`,
      command
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

app.get('/api/config/nodes', (_req, res) => {
  res.json({
    success: true,
    count: nodeConfigs.size,
    data: Array.from(nodeConfigs.values())
  });
});

app.get('/api/config/network', (_req, res) => {
  res.json({
    success: true,
    data: loraNetwork,
    gatewaySync: gatewayLoraSync
  });
});

app.post('/api/config/network', (req, res) => {
  try {
    loraNetwork = normalizeLoraNetwork(req.body);
    saveLoraNetwork();
    refreshGatewaySyncState('Profile mạng LoRa đã đổi. Cần cấu hình lại gateway trước khi Activate node.');
    saveGatewayLoraSync();
    io.emit('gatewaySyncUpdated', gatewayLoraSync);

    res.json({
      success: true,
      message: 'LoRa network profile saved. Apply node configuration to push it to nodes.',
      data: loraNetwork,
      gatewaySync: gatewayLoraSync
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message
    });
  }
});

app.get('/api/config/gateway/sync', (_req, res) => {
  refreshGatewaySyncState(gatewayLoraSync.note);
  res.json({
    success: true,
    data: gatewayLoraSync
  });
});

app.post('/api/config/gateway/confirm', (req, res) => {
  const appliedProfileVersion = String(req.body?.appliedProfileVersion || '').trim();
  const note = String(req.body?.note || '').trim();
  const syncState = confirmGatewaySync(appliedProfileVersion, note || 'Gateway đã được cấu hình sang profile mới.');
  io.emit('gatewaySyncUpdated', syncState);

  res.json({
    success: true,
    data: syncState
  });
});

app.post('/api/config/node', (req, res) => {
  try {
    const config = normalizeNodeConfig(req.body);
    const command = buildNodeConfigCommand(config);

    sendCommand(command);
    if (config.target) nodeConfigs.delete(config.target);
    if (config.targetUid) nodeConfigs.delete(config.targetUid);
    nodeConfigs.set(config.targetUid || config.nodeId, config);
    saveNodeConfigs();

    res.json({
      success: true,
      message: `Configuration sent to ${config.target}`,
      config,
      command
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message
    });
  }
});

app.post('/api/config/node/activate', (req, res) => {
  try {
    const { target, targetUid } = req.body;
    if (!target && !targetUid) {
      return res.status(400).json({ success: false, message: 'Target node ID or UID is required' });
    }

    const targetKey = String(targetUid || target || '').trim();
    ensureGatewayProfileSynced();
    const config = getStoredNodeConfig(targetKey);
    const command = buildNodeConfigCommand(config, { applyLora: true });
    sendCommand(command);

    res.json({
      success: true,
      message: `Activation sent to ${command.target}. Node will auto-rollback if not committed.`,
      command
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.post('/api/config/node/commit', (req, res) => {
  try {
    const { target, targetUid } = req.body;
    if (!target && !targetUid) {
      return res.status(400).json({ success: false, message: 'Target node ID or UID is required' });
    }

    const targetKey = String(targetUid || target || '').trim();
    const command = buildNodeConfigActionCommand(targetKey, 'commit');
    sendCommand(command);

    res.json({
      success: true,
      message: `Commit sent to ${command.target}`,
      command
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.post('/api/config/node/rollback', (req, res) => {
  try {
    const { target, targetUid } = req.body;
    if (!target && !targetUid) {
      return res.status(400).json({ success: false, message: 'Target node ID or UID is required' });
    }

    const targetKey = String(targetUid || target || '').trim();
    const command = buildNodeConfigActionCommand(targetKey, 'rollback');
    sendCommand(command);

    res.json({
      success: true,
      message: `Rollback sent to ${command.target}`,
      command
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
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
    loraNetwork,
    gatewayLoraSync,
    nodes: sensorData.size,
    historySize: dataHistory.length,
    dailyStatsCount: totalDailyStats,
    nodeConfigsCount: nodeConfigs.size,
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
    history: dataHistory.slice(-50), // Last 50 records
    gatewaySync: gatewayLoraSync
  });

  socket.on('disconnect', () => {
    connectedClients--;
    console.log(`🔌 Client disconnected (Total: ${connectedClients})`);
  });

  // Handle control commands from web interface
  socket.on('controlRelay', (data) => {
    try {
      const identity = resolveNodeIdentity(data.target, data.targetUid);
      const commandTarget = identity.target || String(data.target || '').trim();
      if (!commandTarget) {
        throw new Error('Target node ID or UID is required');
      }

      const command = { target: commandTarget };
      if (identity.targetUid) {
        command.targetUid = identity.targetUid;
      }

      if (data.relay !== undefined) {
        command.relay = Boolean(data.relay);
      }
      if (data.auto !== undefined) {
        command.auto = Boolean(data.auto);
      }

      sendCommand(command);
      socket.emit('commandSent', { success: true, command });
    } catch (err) {
      socket.emit('commandError', { success: false, message: err.message });
    }
  });

  socket.on('configureNode', (data) => {
    try {
      const config = normalizeNodeConfig(data);
      const command = buildNodeConfigCommand(config);

      sendCommand(command);
      if (config.target) nodeConfigs.delete(config.target);
      if (config.targetUid) nodeConfigs.delete(config.targetUid);
      nodeConfigs.set(config.targetUid || config.nodeId, config);
      saveNodeConfigs();

      socket.emit('configSent', { success: true, config, command });
    } catch (err) {
      socket.emit('configError', { success: false, message: err.message });
    }
  });

  socket.on('saveLoraNetwork', (data) => {
    try {
      loraNetwork = normalizeLoraNetwork(data);
      saveLoraNetwork();
      refreshGatewaySyncState('Profile mạng LoRa đã đổi. Cần cấu hình lại gateway trước khi Activate node.');
      saveGatewayLoraSync();
      io.emit('loraNetworkUpdated', { success: true, data: loraNetwork });
      io.emit('gatewaySyncUpdated', gatewayLoraSync);
    } catch (err) {
      socket.emit('configError', { success: false, message: err.message });
    }
  });

  socket.on('activateNodeConfig', (data) => {
    try {
      const targetKey = String(data.targetUid || data.target || '').trim();
      ensureGatewayProfileSynced();
      const config = getStoredNodeConfig(targetKey);
      const command = buildNodeConfigCommand(config, { applyLora: true });
      sendCommand(command);
      socket.emit('configActionSent', {
        success: true,
        action: 'activate',
        target: command.target,
        message: 'Activation sent. Node will auto-rollback if not committed.',
        command
      });
    } catch (err) {
      socket.emit('configError', { success: false, message: err.message });
    }
  });

  socket.on('commitNodeConfig', (data) => {
    try {
      const targetKey = String(data.targetUid || data.target || '').trim();
      const command = buildNodeConfigActionCommand(targetKey, 'commit');
      sendCommand(command);
      socket.emit('configActionSent', {
        success: true,
        action: 'commit',
        target: command.target,
        message: 'Commit sent',
        command
      });
    } catch (err) {
      socket.emit('configError', { success: false, message: err.message });
    }
  });

  socket.on('rollbackNodeConfig', (data) => {
    try {
      const targetKey = String(data.targetUid || data.target || '').trim();
      const command = buildNodeConfigActionCommand(targetKey, 'rollback');
      sendCommand(command);
      socket.emit('configActionSent', {
        success: true,
        action: 'rollback',
        target: command.target,
        message: 'Rollback sent',
        command
      });
    } catch (err) {
      socket.emit('configError', { success: false, message: err.message });
    }
  });
});

function startBackgroundJobs() {
  loadDailyStats();
  loadLoraNetwork();
  loadGatewayLoraSync();
  loadNodeConfigs();

  initGPIO();
  initSerialPort();

  setInterval(() => {
    saveDailyStats();
    saveGatewayLoraSync();
  }, BACKUP_INTERVAL);

  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const timeUntilMidnight = midnight - now;

  setTimeout(() => {
    cleanupOldStats();
    setInterval(() => {
      cleanupOldStats();
    }, 24 * 60 * 60 * 1000);
  }, timeUntilMidnight);

  console.log(`Auto-backup: every ${BACKUP_INTERVAL / 1000 / 60} minutes\n`);
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use.`);
    console.error('Another gateway instance may already be running.');
    console.error(`Windows check: netstat -ano -p tcp | findstr :${PORT}`);
    console.error('Windows stop:  Stop-Process -Id <PID> -Force');
    console.error('Alternative: set PORT=3001 then run npm start\n');
    process.exit(1);
  }

  console.error('Server error:', err.message);
  process.exit(1);
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
  console.log(`   GET  /api/analytics/*     - Analytics & forecast`);
  console.log(`   POST /api/control/relay   - Control relay`);
  console.log(`   GET  /api/status          - System status`);
  console.log(`   POST /api/config/node     - Configure node`);
  console.log(`   POST /api/config/node/*   - Activate/commit/rollback node config`);
  console.log(`   POST /api/config/network  - Save shared LoRa network`);
  console.log(`   POST /api/config/gateway/confirm - Confirm gateway profile sync`);
  console.log('='.repeat(60));

  startBackgroundJobs();

  console.log(`💾 Auto-backup: every ${BACKUP_INTERVAL / 1000 / 60} minutes\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');

  // Save daily stats before exit
  saveDailyStats();
  saveNodeConfigs();
  saveLoraNetwork();
  saveGatewayLoraSync();

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
  saveNodeConfigs();
  saveLoraNetwork();
  saveGatewayLoraSync();

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
