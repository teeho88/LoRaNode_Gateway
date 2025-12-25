// WebSocket connection
const socket = io();

// State management
const state = {
  nodes: new Map(),
  history: [],
  selectedNode: null,
  dailyStats: [],
  isFiltered: false, // Track if filters are active
  filters: {
    date: null,
    startTime: null,
    endTime: null
  }
};

// DOM elements
const nodesContainer = document.getElementById('nodes-container');
const dailyStatsContainer = document.getElementById('daily-stats-container');
const connectionStatus = document.getElementById('connection-status');
const systemInfo = document.getElementById('system-info');
const logsContainer = document.getElementById('logs');
const nodeSelect = document.getElementById('node-select');
const dateFilter = document.getElementById('date-filter');
const startTimeFilter = document.getElementById('start-time-filter');
const endTimeFilter = document.getElementById('end-time-filter');
const applyFilterBtn = document.getElementById('apply-filter');
const clearFilterBtn = document.getElementById('clear-filter');
const filterStatus = document.getElementById('filter-status');
const chartCanvas = document.getElementById('chart');
const chartCtx = chartCanvas.getContext('2d');

// Connection status
socket.on('connect', () => {
  updateConnectionStatus(true);
  addLog('success', 'Đã kết nối tới gateway');
});

socket.on('disconnect', () => {
  updateConnectionStatus(false);
  addLog('error', 'Mất kết nối tới gateway');
});

// Receive initial data
socket.on('initialData', (data) => {
  console.log('Received initial data:', data);
  data.nodes.forEach(node => {
    state.nodes.set(node.id, node);
  });
  state.history = data.history || [];
  state.isFiltered = false; // Ensure chart is in real-time mode on connect
  renderNodes();
  updateNodeSelect();

  // Fetch full history from API instead of using limited initialData
  fetchRecentHistory();

  fetchDailyStats();
  addLog('info', `Đã tải ${data.nodes.length} nodes, đang tải dữ liệu biểu đồ...`);
});

// Receive real-time sensor data
socket.on('sensorData', (data) => {
  console.log('Sensor data:', data);
  state.nodes.set(data.id, data);

  // Only update history and chart if no filter is active
  if (!state.isFiltered) {
    // If history is empty or too small, reload from API
    if (state.history.length < 2) {
      console.log('History too small, reloading from API...');
      fetchRecentHistory();
    } else {
      state.history.push(data);

      // Keep history limited (memory optimization)
      if (state.history.length > 100) {
        state.history.shift();
      }

      drawChart();
    }
  }

  // Always update node card (latest data)
  updateNodeCard(data);
  updateNodeSelect();

  if (!data.ack) {
    // Check if data has 2 sensors
    if (data.temp1 !== undefined && data.temp2 !== undefined) {
      addLog('info', `${data.id}: S1[${data.temp1}°C, ${data.hum1}%] S2[${data.temp2}°C, ${data.hum2}%] Avg[${data.temp}°C, ${data.hum}%] Relay: ${data.relay ? 'ON' : 'OFF'}`);
    } else {
      addLog('info', `${data.id}: ${data.temp}°C, ${data.hum}%, Relay: ${data.relay ? 'ON' : 'OFF'}`);
    }
  }
});

// Command acknowledgment
socket.on('commandAck', (data) => {
  addLog('success', `${data.nodeId} xác nhận: Relay ${data.relay ? 'BẬT' : 'TẮT'}`);
});

// Command sent confirmation
socket.on('commandSent', (data) => {
  addLog('success', `Đã gửi lệnh: ${JSON.stringify(data.command)}`);
});

// Command error
socket.on('commandError', (data) => {
  addLog('error', `Lỗi: ${data.message}`);
});

// Update connection status indicator
function updateConnectionStatus(connected) {
  if (connected) {
    connectionStatus.innerHTML = '🟢 Đã kết nối';
    connectionStatus.classList.add('connected');
  } else {
    connectionStatus.innerHTML = '🔴 Mất kết nối';
    connectionStatus.classList.remove('connected');
  }
}

// Render all nodes
function renderNodes() {
  if (state.nodes.size === 0) {
    nodesContainer.innerHTML = '<div class="loading">Chưa có node nào</div>';
    return;
  }

  nodesContainer.innerHTML = '';
  state.nodes.forEach((node, id) => {
    nodesContainer.appendChild(createNodeCard(node));
  });

  // Update system info
  fetchSystemStatus();
}

// Create a node card
function createNodeCard(node) {
  const card = document.createElement('div');
  card.className = 'node-card';
  card.id = `node-${node.id}`;

  // Check if node is online (data received in last 30 seconds)
  const isOnline = (Date.now() - node.receivedAt) < 30000;
  if (!isOnline) {
    card.classList.add('offline');
  }

  const timeDiff = Math.round((Date.now() - node.receivedAt) / 1000);
  const timeAgo = timeDiff < 60 ? `${timeDiff}s` : `${Math.round(timeDiff / 60)}m`;

  // Check if node has 2 sensors data
  const hasTwoSensors = (node.temp1 !== undefined && node.temp2 !== undefined);

  let sensorDataHTML = '';
  if (hasTwoSensors) {
    // Display data from 2 sensors
    sensorDataHTML = `
      <div class="node-data">
        <div class="sensor-group">
          <div class="sensor-label">🌡️ Cảm biến 1</div>
          <div class="sensor-values">
            <div class="data-item">
              <div class="data-label">Nhiệt độ</div>
              <div class="data-value temp">${node.temp1}°C</div>
            </div>
            <div class="data-item">
              <div class="data-label">Độ ẩm</div>
              <div class="data-value hum">${node.hum1}%</div>
            </div>
          </div>
        </div>

        <div class="sensor-group">
          <div class="sensor-label">🌡️ Cảm biến 2</div>
          <div class="sensor-values">
            <div class="data-item">
              <div class="data-label">Nhiệt độ</div>
              <div class="data-value temp">${node.temp2}°C</div>
            </div>
            <div class="data-item">
              <div class="data-label">Độ ẩm</div>
              <div class="data-value hum">${node.hum2}%</div>
            </div>
          </div>
        </div>

        <div class="sensor-group average">
          <div class="sensor-label">📊 Trung bình</div>
          <div class="sensor-values">
            <div class="data-item">
              <div class="data-label">Nhiệt độ</div>
              <div class="data-value temp avg">${node.temp}°C</div>
            </div>
            <div class="data-item">
              <div class="data-label">Độ ẩm</div>
              <div class="data-value hum avg">${node.hum}%</div>
            </div>
          </div>
        </div>
      </div>
    `;
  } else {
    // Display single sensor data (backward compatibility)
    sensorDataHTML = `
      <div class="node-data">
        <div class="data-item">
          <div class="data-label">Nhiệt độ</div>
          <div class="data-value temp">${node.temp}°C</div>
        </div>
        <div class="data-item">
          <div class="data-label">Độ ẩm</div>
          <div class="data-value hum">${node.hum}%</div>
        </div>
      </div>
    `;
  }

  card.innerHTML = `
    <div class="node-header">
      <span class="node-id">${node.id}</span>
      <span class="node-status ${isOnline ? 'online' : 'offline'}">
        ${isOnline ? 'ONLINE' : 'OFFLINE'}
      </span>
    </div>

    ${sensorDataHTML}

    <div class="relay-status">
      <span class="relay-indicator ${node.relay ? 'on' : ''}"></span>
      <span>Relay: ${node.relay ? 'BẬT' : 'TẮT'}</span>
      <span class="mode-badge ${node.manual ? 'manual' : 'auto'}">
        ${node.manual ? 'MANUAL' : 'AUTO'}
      </span>
    </div>

    <div class="node-controls">
      <button class="btn btn-on" onclick="controlRelay('${node.id}', true)">BẬT</button>
      <button class="btn btn-off" onclick="controlRelay('${node.id}', false)">TẮT</button>
      <button class="btn btn-auto" onclick="setAutoMode('${node.id}')">AUTO</button>
    </div>

    <div class="timestamp">Cập nhật ${timeAgo} trước</div>
  `;

  return card;
}

// Update existing node card
function updateNodeCard(node) {
  const existingCard = document.getElementById(`node-${node.id}`);
  if (existingCard) {
    const newCard = createNodeCard(node);
    existingCard.replaceWith(newCard);
  } else {
    renderNodes();
  }
}

// Control relay
function controlRelay(nodeId, state) {
  const command = {
    target: nodeId,
    relay: state
  };
  socket.emit('controlRelay', command);
  addLog('info', `Gửi lệnh ${state ? 'BẬT' : 'TẮT'} relay tới ${nodeId}`);
}

// Set auto mode
function setAutoMode(nodeId) {
  const command = {
    target: nodeId,
    auto: true
  };
  socket.emit('controlRelay', command);
  addLog('info', `Chuyển ${nodeId} sang chế độ AUTO`);
}

// Update node select dropdown
function updateNodeSelect() {
  const currentValue = nodeSelect.value;
  nodeSelect.innerHTML = '<option value="" disabled selected>-- Chọn Node --</option>';

  state.nodes.forEach((node, id) => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id;
    nodeSelect.appendChild(option);
  });

  nodeSelect.value = currentValue;
}

// Node select change handler
// Node select change handler
nodeSelect.addEventListener('change', (e) => {
  state.selectedNode = e.target.value || null;

  // Reset filters when switching nodes
  state.filters.date = null;
  state.filters.startTime = null;
  state.filters.endTime = null;
  state.isFiltered = false;

  dateFilter.value = '';
  startTimeFilter.value = '';
  endTimeFilter.value = '';

  updateFilterStatus();

  if (state.selectedNode) {
    fetchRecentHistory();
  } else {
    drawChart();
  }
});

// Draw chart (simple canvas-based chart)
function drawChart() {
  const width = chartCanvas.width;
  const height = chartCanvas.height;
  const padding = 40;

  // Clear canvas
  chartCtx.clearRect(0, 0, width, height);

  // Require node selection
  if (!state.selectedNode) {
    chartCtx.fillStyle = '#666';
    chartCtx.font = '14px Arial';
    chartCtx.textAlign = 'center';
    chartCtx.fillText('Vui lòng chọn Node để xem biểu đồ', width / 2, height / 2);
    return;
  }

  // Filter data by selected node
  let data = state.history;
  if (state.selectedNode) {
    data = data.filter(d => d.id === state.selectedNode);
  }

  if (data.length < 2) {
    chartCtx.fillStyle = '#999';
    chartCtx.font = '14px Arial';
    chartCtx.textAlign = 'center';
    chartCtx.fillText('Chưa đủ dữ liệu để vẽ biểu đồ', width / 2, height / 2);
    return;
  }

  // Get min/max for scaling
  const temps = data.map(d => d.temp);
  const hums = data.map(d => d.hum);
  const minTemp = Math.min(...temps) - 2;
  const maxTemp = Math.max(...temps) + 2;
  const minHum = Math.min(...hums) - 5;
  const maxHum = Math.max(...hums) + 5;

  // Draw axes
  chartCtx.strokeStyle = '#ddd';
  chartCtx.lineWidth = 1;
  chartCtx.beginPath();
  chartCtx.moveTo(padding, padding);
  chartCtx.lineTo(padding, height - padding);
  chartCtx.lineTo(width - padding, height - padding);
  chartCtx.stroke();

  // Draw temperature line
  chartCtx.strokeStyle = '#ff6b6b';
  chartCtx.lineWidth = 2;
  chartCtx.beginPath();
  data.forEach((d, i) => {
    const x = padding + (i / (data.length - 1)) * (width - 2 * padding);
    const y = height - padding - ((d.temp - minTemp) / (maxTemp - minTemp)) * (height - 2 * padding);
    if (i === 0) {
      chartCtx.moveTo(x, y);
    } else {
      chartCtx.lineTo(x, y);
    }
  });
  chartCtx.stroke();

  // Draw humidity line
  chartCtx.strokeStyle = '#4ecdc4';
  chartCtx.lineWidth = 2;
  chartCtx.beginPath();
  data.forEach((d, i) => {
    const x = padding + (i / (data.length - 1)) * (width - 2 * padding);
    const y = height - padding - ((d.hum - minHum) / (maxHum - minHum)) * (height - 2 * padding);
    if (i === 0) {
      chartCtx.moveTo(x, y);
    } else {
      chartCtx.lineTo(x, y);
    }
  });
  chartCtx.stroke();

  // Draw legend
  chartCtx.fillStyle = '#ff6b6b';
  chartCtx.fillRect(width - 150, 20, 20, 10);
  chartCtx.fillStyle = '#333';
  chartCtx.font = '12px Arial';
  chartCtx.textAlign = 'left';
  chartCtx.fillText('Nhiệt độ (°C)', width - 125, 28);

  chartCtx.fillStyle = '#4ecdc4';
  chartCtx.fillRect(width - 150, 40, 20, 10);
  chartCtx.fillStyle = '#333';
  chartCtx.fillText('Độ ẩm (%)', width - 125, 48);
}

// Add log entry
function addLog(type, message) {
  const log = document.createElement('div');
  log.className = `log-entry ${type}`;

  const timestamp = new Date().toLocaleTimeString('vi-VN');
  log.innerHTML = `
    <span class="log-timestamp">[${timestamp}]</span>
    <span class="log-message">${message}</span>
  `;

  logsContainer.insertBefore(log, logsContainer.firstChild);

  // Keep only last 50 logs
  while (logsContainer.children.length > 50) {
    logsContainer.removeChild(logsContainer.lastChild);
  }
}

// Fetch system status
async function fetchSystemStatus() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    if (data.success) {
      systemInfo.textContent = `Nodes: ${data.nodes} | Clients: ${data.connectedClients} | RAM: ${data.memory.heapUsed} | Uptime: ${data.uptime}`;
    }
  } catch (err) {
    console.error('Failed to fetch system status:', err);
  }
}

// Fetch daily statistics
async function fetchDailyStats() {
  try {
    const response = await fetch('/api/daily-stats');
    const data = await response.json();
    if (data.success) {
      state.dailyStats = data.data;
      renderDailyStats();
    }
  } catch (err) {
    console.error('Failed to fetch daily stats:', err);
  }
}

// Render daily statistics
function renderDailyStats() {
  if (state.dailyStats.length === 0) {
    dailyStatsContainer.innerHTML = '<div class="loading">Chưa có dữ liệu thống kê</div>';
    return;
  }

  dailyStatsContainer.innerHTML = '';
  state.dailyStats.forEach(stats => {
    const card = document.createElement('div');
    card.className = 'stat-card';

    const tempMaxTime = new Date(stats.tempMaxTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const tempMinTime = new Date(stats.tempMinTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const humMaxTime = new Date(stats.humMaxTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const humMinTime = new Date(stats.humMinTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

    card.innerHTML = `
      <h3>${stats.nodeId}</h3>
      <div class="stat-row">
        <span class="stat-label">🔥 Nhiệt độ cao nhất:</span>
        <span>
          <span class="stat-value high">${stats.tempMax}°C</span>
          <span class="stat-time">${tempMaxTime}</span>
        </span>
      </div>
      <div class="stat-row">
        <span class="stat-label">❄️ Nhiệt độ thấp nhất:</span>
        <span>
          <span class="stat-value low">${stats.tempMin}°C</span>
          <span class="stat-time">${tempMinTime}</span>
        </span>
      </div>
      <div class="stat-row">
        <span class="stat-label">💧 Độ ẩm cao nhất:</span>
        <span>
          <span class="stat-value high">${stats.humMax}%</span>
          <span class="stat-time">${humMaxTime}</span>
        </span>
      </div>
      <div class="stat-row">
        <span class="stat-label">💨 Độ ẩm thấp nhất:</span>
        <span>
          <span class="stat-value low">${stats.humMin}%</span>
          <span class="stat-time">${humMinTime}</span>
        </span>
      </div>
      <div class="stat-row">
        <span class="stat-label">📊 Số lần đo:</span>
        <span class="stat-value">${stats.count}</span>
      </div>
    `;

    dailyStatsContainer.appendChild(card);
  });
}

// Fetch filtered history data
async function fetchFilteredHistory() {
  try {
    const params = new URLSearchParams();

    if (state.selectedNode) {
      params.append('nodeId', state.selectedNode);
    }
    if (state.filters.date) {
      params.append('date', state.filters.date);
    }
    if (state.filters.startTime) {
      params.append('startTime', state.filters.startTime);
    }
    if (state.filters.endTime) {
      params.append('endTime', state.filters.endTime);
    }
    params.append('limit', '200');

    const response = await fetch(`/api/history?${params}`);
    const data = await response.json();

    if (data.success) {
      state.history = data.data;
      state.isFiltered = true; // Mark as filtered
      drawChart();
      updateFilterStatus();
      addLog('info', `Đã lọc ${data.count} bản ghi - Biểu đồ đã khóa`);
    }
  } catch (err) {
    console.error('Failed to fetch filtered history:', err);
    addLog('error', 'Lỗi khi lọc dữ liệu');
  }
}

// Fetch recent history (unfiltered)
async function fetchRecentHistory() {
  try {
    const params = new URLSearchParams();

    if (state.selectedNode) {
      params.append('nodeId', state.selectedNode);
    }
    params.append('limit', '100');

    const response = await fetch(`/api/history?${params}`);
    const data = await response.json();

    if (data.success) {
      state.history = data.data;
      state.isFiltered = false; // Clear filtered state
      drawChart();
      updateFilterStatus();
      addLog('info', `Đã tải ${data.count} bản ghi gần nhất - Biểu đồ real-time`);
    }
  } catch (err) {
    console.error('Failed to fetch recent history:', err);
    addLog('error', 'Lỗi khi tải dữ liệu');
  }
}

// Update filter status indicator
function updateFilterStatus() {
  if (state.isFiltered) {
    filterStatus.innerHTML = '🔒 Biểu đồ đã khóa (không tự động cập nhật)';
    filterStatus.style.color = '#ff6b6b';
    filterStatus.style.fontWeight = 'bold';
  } else {
    filterStatus.innerHTML = '🔄 Real-time (tự động cập nhật)';
    filterStatus.style.color = '#4ecdc4';
    filterStatus.style.fontWeight = 'normal';
  }
}

// Apply filters
applyFilterBtn.addEventListener('click', () => {
  state.filters.date = dateFilter.value || null;
  state.filters.startTime = startTimeFilter.value ? startTimeFilter.value + ':00' : null;
  state.filters.endTime = endTimeFilter.value ? endTimeFilter.value + ':59' : null;

  fetchFilteredHistory();
});

// Clear filters
clearFilterBtn.addEventListener('click', () => {
  state.filters.date = null;
  state.filters.startTime = null;
  state.filters.endTime = null;
  state.isFiltered = false; // Clear filtered state
  dateFilter.value = '';
  startTimeFilter.value = '';
  endTimeFilter.value = '';

  // Reload recent history from API (last 100 records)
  fetchRecentHistory();
});

// Periodic updates
setInterval(() => {
  fetchSystemStatus();
  fetchDailyStats();
}, 30000); // Update every 30 seconds

// Initial load
addLog('info', 'Dashboard khởi động');
updateFilterStatus(); // Initialize filter status indicator
