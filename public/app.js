// WebSocket connection
const socket = io();

// State management
const state = {
  nodes: new Map(),
  history: [],
  selectedNode: null,
  dailyStats: [],
  nodeConfigs: new Map(),
  loraNetwork: null,
  gatewaySync: null,
  analyticsOverview: null,
  nodeHealth: null,
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
const duplicateIdWarning = document.getElementById('duplicate-id-warning');
const configForm = document.getElementById('node-config-form');
const configGatewayAddress = document.getElementById('config-gateway-address');
const configTarget = document.getElementById('config-target');
const configNodeId = document.getElementById('config-node-id');
const configAddress = document.getElementById('config-address');
const configNetworkId = document.getElementById('config-network-id');
const configChannel = document.getElementById('config-channel');
const configBaudRateCode = document.getElementById('config-baud-rate-code');
const configAirRate = document.getElementById('config-air-rate');
const configPower = document.getElementById('config-power');
const configStatus = document.getElementById('config-status');
const activateConfigBtn = document.getElementById('activate-config');
const commitConfigBtn = document.getElementById('commit-config');
const rollbackConfigBtn = document.getElementById('rollback-config');
const gatewaySyncStatus = document.getElementById('gateway-sync-status');
const gatewaySyncConfirmBtn = document.getElementById('gateway-sync-confirm');
const dateFilter = document.getElementById('date-filter');
const startTimeFilter = document.getElementById('start-time-filter');
const endTimeFilter = document.getElementById('end-time-filter');
const applyFilterBtn = document.getElementById('apply-filter');
const clearFilterBtn = document.getElementById('clear-filter');
const filterStatus = document.getElementById('filter-status');
const chartCanvas = document.getElementById('chart');
const chartCtx = chartCanvas.getContext('2d');
const tabButtons = document.querySelectorAll('.tab-button');
const tabPanels = document.querySelectorAll('.tab-panel');
const analyticsNodeSelect = document.getElementById('analytics-node-select');
const analyticsWindowSelect = document.getElementById('analytics-window');
const analyticsForecastSelect = document.getElementById('analytics-forecast');
const analyticsRefreshBtn = document.getElementById('analytics-refresh');
const analyticsSummary = document.getElementById('analytics-summary');
const analyticsCards = document.getElementById('analytics-cards');

function getNodeKey(node) {
  return node.nodeKey || node.uid || node.id;
}

function getNodeLabel(node) {
  return node.uid ? `${node.id} (${node.uid})` : node.id;
}

function getHistoryNodeKey(record) {
  return record.nodeKey || record.uid || record.id;
}

function matchesSelectedNode(record, selectedNode) {
  if (!selectedNode) {
    return true;
  }

  const recordKey = getHistoryNodeKey(record);
  return recordKey === selectedNode || record.id === selectedNode || record.uid === selectedNode;
}

function getConfigActionTarget() {
  const selectedKey = configTarget.value || '';
  const selectedNode = state.nodes.get(selectedKey);
  const fallbackNodeId = configNodeId.value.trim();

  return {
    target: selectedNode?.id || selectedKey || fallbackNodeId,
    targetUid: selectedNode?.uid || ''
  };
}

function updateDuplicateIdWarning() {
  if (!duplicateIdWarning) {
    return;
  }

  const duplicateIds = new Map();
  state.nodes.forEach(node => {
    duplicateIds.set(node.id, (duplicateIds.get(node.id) || 0) + 1);
  });

  const conflicts = Array.from(duplicateIds.entries())
    .filter(([, count]) => count > 1)
    .map(([id]) => id);

  if (conflicts.length === 0) {
    duplicateIdWarning.textContent = '';
    duplicateIdWarning.classList.remove('active');
    return;
  }

  duplicateIdWarning.textContent = `Phát hiện ID trùng: ${conflicts.join(', ')}. Gateway vẫn phân biệt theo UID, nhưng bạn nên đổi ID để dễ quản lý.`;
  duplicateIdWarning.classList.add('active');
}

function updateGatewaySyncStatus(syncState) {
  if (!gatewaySyncStatus || !syncState) {
    return;
  }

  state.gatewaySync = syncState;
  gatewaySyncStatus.classList.remove('synced', 'pending', 'error');
  const required = syncState.requiredProfileVersion || 'N/A';
  const applied = syncState.appliedProfileVersion || 'chưa xác nhận';
  const suffix = ` (required: ${required}, applied: ${applied})`;

  if (syncState.inSync) {
    gatewaySyncStatus.textContent = `Đã đồng bộ${suffix}`;
    gatewaySyncStatus.classList.add('synced');
  } else {
    gatewaySyncStatus.textContent = `Chưa đồng bộ${suffix}`;
    gatewaySyncStatus.classList.add('pending');
  }
}

function trendClass(direction) {
  if (direction === 'rising') return 'analytics-trend-up';
  if (direction === 'falling') return 'analytics-trend-down';
  return 'analytics-trend-stable';
}

function trendSymbol(direction) {
  if (direction === 'rising') return '↑';
  if (direction === 'falling') return '↓';
  return '→';
}

function getHealthForNode(node) {
  if (!state.nodeHealth) {
    return null;
  }

  return state.nodeHealth.nodes.find(item =>
    item.nodeKey === node.nodeKey ||
    item.uid === node.uid ||
    item.nodeId === node.nodeId
  );
}

function healthLabel(level) {
  if (level === 'critical') return 'CRITICAL';
  if (level === 'warning') return 'WARNING';
  return 'GOOD';
}

function renderAnalytics() {
  if (!state.analyticsOverview) {
    analyticsSummary.textContent = 'Chưa có dữ liệu phân tích';
    analyticsCards.innerHTML = '<div class="loading">Chưa có dữ liệu</div>';
    return;
  }

  const overview = state.analyticsOverview;
  const health = state.nodeHealth;
  analyticsSummary.textContent =
    `Cửa sổ ${overview.windowMinutes} phút | Dự báo ${overview.forecastMinutes} phút | `
    + `Nhiệt độ TB: ${overview.summary.avgTemp ?? '--'}°C | Độ ẩm TB: ${overview.summary.avgHum ?? '--'}% | `
    + `Nguy cơ cao: ${overview.summary.highRiskNodes} | Nguy cơ vừa: ${overview.summary.mediumRiskNodes} | `
    + `Node có bất thường: ${overview.summary.anomalyNodes}`
    + (health ? ` | Health: ${health.summary.good} tốt, ${health.summary.warning} cảnh báo, ${health.summary.critical} nguy cấp, ${health.summary.offline} offline` : '');

  const displayNodes = new Map();
  overview.nodes.forEach(node => {
    displayNodes.set(node.nodeKey, node);
  });
  (health?.nodes || []).forEach(nodeHealth => {
    if (!displayNodes.has(nodeHealth.nodeKey)) {
      displayNodes.set(nodeHealth.nodeKey, {
        nodeKey: nodeHealth.nodeKey,
        nodeId: nodeHealth.nodeId,
        uid: nodeHealth.uid,
        sampleCount: nodeHealth.sampleCount,
        current: nodeHealth.current,
        forecast: nodeHealth.analytics?.forecast || { minutes: overview.forecastMinutes, temp: '--', hum: '--' },
        trend: nodeHealth.analytics?.trend || {
          tempPerHour: '--',
          humPerHour: '--',
          tempDirection: 'stable',
          humDirection: 'stable'
        },
        anomalyCount: nodeHealth.analytics?.anomalyCount || 0,
        riskLevel: nodeHealth.analytics?.riskLevel || 'low'
      });
    }
  });

  if (!displayNodes.size) {
    analyticsCards.innerHTML = '<div class="loading">Không có đủ dữ liệu để phân tích trong cửa sổ đã chọn</div>';
    return;
  }

  analyticsCards.innerHTML = '';
  displayNodes.forEach(node => {
    const card = document.createElement('article');
    const nodeHealth = getHealthForNode(node);
    const healthClass = nodeHealth ? ` health-${nodeHealth.healthLevel}` : '';
    card.className = `analytics-card risk-${node.riskLevel}${healthClass}`;

    const label = node.uid ? `${node.nodeId} (${node.uid})` : node.nodeId;
    const recommendations = nodeHealth?.recommendations?.slice(0, 2).join(' ') || 'Chua co du lieu health.';
    card.innerHTML = `
      <div class="analytics-node">${label}</div>
      ${nodeHealth ? `<div class="analytics-row"><span>Sức khỏe</span><strong>${nodeHealth.healthScore}/100 ${healthLabel(nodeHealth.healthLevel)}</strong></div>` : ''}
      ${nodeHealth ? `<div class="analytics-row"><span>Online</span><span>${nodeHealth.online ? 'OK' : 'OFFLINE'} | ${nodeHealth.lastSeenSeconds}s</span></div>` : ''}
      ${nodeHealth ? `<div class="analytics-row"><span>Nhịp gói</span><span>${nodeHealth.expectedInterval ? `${nodeHealth.expectedInterval}s` : '--'}</span></div>` : ''}
      <div class="analytics-row"><span>Rủi ro</span><strong>${node.riskLevel.toUpperCase()}</strong></div>
      <div class="analytics-row"><span>Mẫu phân tích</span><span>${node.sampleCount}</span></div>
      <div class="analytics-row"><span>Hiện tại</span><span>${node.current.temp}°C | ${node.current.hum}%</span></div>
      <div class="analytics-row"><span>Dự báo +${node.forecast.minutes}p</span><span>${node.forecast.temp}°C | ${node.forecast.hum}%</span></div>
      <div class="analytics-row"><span>Xu hướng nhiệt</span><span class="${trendClass(node.trend.tempDirection)}">${trendSymbol(node.trend.tempDirection)} ${node.trend.tempPerHour}/h</span></div>
      <div class="analytics-row"><span>Xu hướng ẩm</span><span class="${trendClass(node.trend.humDirection)}">${trendSymbol(node.trend.humDirection)} ${node.trend.humPerHour}/h</span></div>
      <div class="analytics-row"><span>Bất thường</span><strong>${node.anomalyCount}</strong></div>
      <div class="analytics-recommendation">${recommendations}</div>
    `;

    analyticsCards.appendChild(card);
  });
}

// Connection status
socket.on('connect', () => {
  updateConnectionStatus(true);
  addLog('success', 'Đã kết nối tới gateway');
});

tabButtons.forEach(button => {
  button.addEventListener('click', () => {
    switchTab(button.dataset.tab);
  });
});

socket.on('disconnect', () => {
  updateConnectionStatus(false);
  addLog('error', 'Mất kết nối tới gateway');
});

// Receive initial data
socket.on('initialData', (data) => {
  console.log('Received initial data:', data);
  data.nodes.forEach(node => {
    state.nodes.set(getNodeKey(node), node);
  });
  state.history = data.history || [];
  if (data.gatewaySync) {
    updateGatewaySyncStatus(data.gatewaySync);
  }
  state.isFiltered = false; // Ensure chart is in real-time mode on connect
  renderNodes();
  updateNodeSelect();

  // Fetch full history from API instead of using limited initialData
  fetchRecentHistory();

  fetchDailyStats();
  fetchLoraNetwork();
  fetchGatewaySync();
  fetchAnalyticsOverview();
  fetchNodeConfigs();
  addLog('info', `Đã tải ${data.nodes.length} nodes, đang tải dữ liệu biểu đồ...`);
});

// Receive real-time sensor data
socket.on('sensorData', (data) => {
  console.log('Sensor data:', data);
  state.nodes.set(getNodeKey(data), data);

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

socket.on('configSent', (data) => {
  state.nodeConfigs.delete(data.config.target);
  if (data.config.targetUid) {
    state.nodeConfigs.delete(data.config.targetUid);
  }
  state.nodeConfigs.set(data.config.targetUid || data.config.nodeId, data.config);
  configStatus.textContent = `Đã gửi cấu hình tới ${data.config.target}; profile LoRa đang ở trạng thái staged`;
  configStatus.style.color = '#28a745';
  addLog('success', `Đã gửi cấu hình node: ${JSON.stringify(data.command)}`);
});

socket.on('loraNetworkUpdated', (data) => {
  state.loraNetwork = data.data;
  fillLoraNetworkForm(data.data);
  addLog('success', 'Đã lưu profile mạng LoRa dùng chung');
});

socket.on('gatewaySyncUpdated', (syncState) => {
  updateGatewaySyncStatus(syncState);
});

socket.on('configAck', (data) => {
  const loraNote = data.loraApplied ? 'LoRa đã áp dụng' : 'LoRa đã lưu/stage, chưa kích hoạt';
  const rollbackNote = data.rollbackArmed ? ' - rollback tự động đang bật' : '';
  configStatus.textContent = `${data.nodeId} xác nhận cấu hình (${loraNote}${rollbackNote})`;
  configStatus.style.color = '#28a745';
  addLog('success', `${data.nodeId} xác nhận cấu hình. ${data.message || loraNote}`);
});

socket.on('configActionSent', (data) => {
  configStatus.textContent = `${data.message}: ${data.target}`;
  configStatus.style.color = data.action === 'rollback' ? '#dc3545' : '#667eea';
  addLog('info', `${data.message}: ${data.target}`);
});

socket.on('configError', (data) => {
  configStatus.textContent = `Lỗi: ${data.message}`;
  configStatus.style.color = '#dc3545';
  addLog('error', `Lỗi cấu hình: ${data.message}`);
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

function switchTab(tabName) {
  const availableTabs = Array.from(tabButtons).map(button => button.dataset.tab);
  const nextTab = availableTabs.includes(tabName) ? tabName : 'nodes';

  tabButtons.forEach(button => {
    const isActive = button.dataset.tab === nextTab;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });

  tabPanels.forEach(panel => {
    panel.classList.toggle('active', panel.dataset.tabPanel === nextTab);
  });

  localStorage.setItem('activeDashboardTab', nextTab);

  if (nextTab === 'chart') {
    drawChart();
  }

  if (nextTab === 'stats') {
    fetchDailyStats();
  }

  if (nextTab === 'config') {
    fetchLoraNetwork();
    fetchNodeConfigs();
    fetchGatewaySync();
  }

  if (nextTab === 'analytics') {
    fetchAnalyticsOverview();
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
  const nodeKey = getNodeKey(node);
  const card = document.createElement('div');
  card.className = 'node-card';
  card.id = `node-${nodeKey}`;

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
    const td1 = (node.temp1 - (100 - node.hum1) / 5).toFixed(1);
    const td2 = (node.temp2 - (100 - node.hum2) / 5).toFixed(1);

    // Display data from 2 sensors
    sensorDataHTML = `
      <div class="node-data">
        <div class="sensor-group">
          <div class="sensor-label">🏠 Trong kho (S1)</div>
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
          <div class="sensor-label">🌲 Ngoài kho (S2)</div>
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
          <div class="sensor-label">💧 Điểm sương (Td)</div>
          <div class="sensor-values">
            <div class="data-item">
              <div class="data-label">Trong kho</div>
              <div class="data-value temp avg">${td1}°C</div>
            </div>
            <div class="data-item">
              <div class="data-label">Ngoài kho</div>
              <div class="data-value temp avg">${td2}°C</div>
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
      ${node.uid ? `<span class="node-uid">UID: ${node.uid}</span>` : ''}
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
      <button class="btn btn-on" onclick="controlRelay('${nodeKey}', true)">BẬT</button>
      <button class="btn btn-off" onclick="controlRelay('${nodeKey}', false)">TẮT</button>
      <button class="btn btn-auto" onclick="setAutoMode('${nodeKey}')">AUTO</button>
    </div>

    <div class="timestamp">Cập nhật ${timeAgo} trước</div>
  `;

  return card;
}

// Update existing node card
function updateNodeCard(node) {
  const existingCard = document.getElementById(`node-${getNodeKey(node)}`);
  if (existingCard) {
    const newCard = createNodeCard(node);
    existingCard.replaceWith(newCard);
  } else {
    renderNodes();
  }
}

// Control relay
function buildNodeCommand(nodeKey) {
  const node = state.nodes.get(nodeKey);
  if (!node) {
    throw new Error(`Không tìm thấy node ${nodeKey}`);
  }

  const command = { target: node.id };
  if (node.uid) {
    command.targetUid = node.uid;
  }

  return { command, node };
}

function controlRelay(nodeKey, relayState) {
  const { command, node } = buildNodeCommand(nodeKey);
  command.relay = relayState;

  socket.emit('controlRelay', command);
  addLog('info', `Gửi lệnh ${relayState ? 'BẬT' : 'TẮT'} relay tới ${getNodeLabel(node)}`);
}

// Set auto mode
function setAutoMode(nodeKey) {
  const { command, node } = buildNodeCommand(nodeKey);
  command.auto = true;

  socket.emit('controlRelay', command);
  addLog('info', `Chuyển ${getNodeLabel(node)} sang chế độ AUTO`);
}

// Update node select dropdown
function updateNodeSelect() {
  const currentValue = state.selectedNode || nodeSelect.value;
  const currentConfigTarget = configTarget.value;
  const currentAnalyticsTarget = analyticsNodeSelect.value;
  nodeSelect.innerHTML = '<option value="" disabled selected>-- Chọn Node --</option>';
  configTarget.innerHTML = '<option value="" disabled selected>-- Chọn Node --</option>';
  analyticsNodeSelect.innerHTML = '<option value="">-- Tất cả Node --</option>';

  state.nodes.forEach((node, nodeKey) => {
    const option = document.createElement('option');
    option.value = nodeKey;
    option.textContent = getNodeLabel(node);
    nodeSelect.appendChild(option);

    const configOption = document.createElement('option');
    configOption.value = nodeKey;
    configOption.textContent = getNodeLabel(node);
    configTarget.appendChild(configOption);

    const analyticsOption = document.createElement('option');
    analyticsOption.value = nodeKey;
    analyticsOption.textContent = getNodeLabel(node);
    analyticsNodeSelect.appendChild(analyticsOption);
  });

  if (currentValue && state.nodes.has(currentValue)) {
    state.selectedNode = currentValue;
    nodeSelect.value = currentValue;
  } else {
    state.selectedNode = state.nodes.size > 0 ? state.nodes.keys().next().value : null;
    nodeSelect.value = state.selectedNode || '';
  }

  if (currentConfigTarget && state.nodes.has(currentConfigTarget)) {
    configTarget.value = currentConfigTarget;
  }

  if (currentAnalyticsTarget && state.nodes.has(currentAnalyticsTarget)) {
    analyticsNodeSelect.value = currentAnalyticsTarget;
  }

  updateDuplicateIdWarning();
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

configTarget.addEventListener('change', (e) => {
  fillConfigForm(e.target.value);
});

gatewaySyncConfirmBtn.addEventListener('click', () => {
  confirmGatewaySync();
});

analyticsRefreshBtn.addEventListener('click', () => {
  fetchAnalyticsOverview();
});

analyticsNodeSelect.addEventListener('change', () => {
  fetchAnalyticsOverview();
});

analyticsWindowSelect.addEventListener('change', () => {
  fetchAnalyticsOverview();
});

analyticsForecastSelect.addEventListener('change', () => {
  fetchAnalyticsOverview();
});

configForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  try {
    configStatus.textContent = 'Đang lưu profile mạng chung...';
    configStatus.style.color = '#667eea';

    const loraNetwork = getLoraNetworkFromForm();
    const response = await fetch('/api/config/network', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loraNetwork)
    });
    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message);
    }

    state.loraNetwork = result.data;
    fillLoraNetworkForm(result.data);
    if (result.gatewaySync) {
      updateGatewaySyncStatus(result.gatewaySync);
    }

    const command = {
      target: state.nodes.get(configTarget.value)?.id || configTarget.value,
      targetUid: state.nodes.get(configTarget.value)?.uid || '',
      nodeId: configNodeId.value.trim(),
      address: configAddress.value
    };

    socket.emit('configureNode', command);
    configStatus.textContent = 'Đang gửi cấu hình node với profile mạng chung...';
  } catch (err) {
    configStatus.textContent = `Lỗi: ${err.message}`;
    configStatus.style.color = '#dc3545';
    addLog('error', `Lỗi cấu hình mạng LoRa: ${err.message}`);
  }
});

activateConfigBtn.addEventListener('click', () => {
  const { target, targetUid } = getConfigActionTarget();
  if (!target) {
    configStatus.textContent = 'Vui lòng chọn node trước khi kích hoạt';
    configStatus.style.color = '#dc3545';
    return;
  }

  if (state.gatewaySync && !state.gatewaySync.inSync) {
    configStatus.textContent = 'Gateway chưa đồng bộ profile mới. Hãy bấm "Tôi đã cấu hình gateway" trước khi Activate.';
    configStatus.style.color = '#dc3545';
    addLog('warning', 'Chặn activate vì gateway chưa đồng bộ profile mạng.');
    return;
  }

  socket.emit('activateNodeConfig', { target, targetUid });
  configStatus.textContent = 'Đã gửi lệnh kích hoạt. Hãy cấu hình gateway sang cùng profile mới rồi mới Commit; nếu không node sẽ tự rollback.';
  configStatus.style.color = '#f0ad4e';
});

commitConfigBtn.addEventListener('click', () => {
  const { target, targetUid } = getConfigActionTarget();
  if (!target) {
    configStatus.textContent = 'Vui lòng chọn node trước khi commit';
    configStatus.style.color = '#dc3545';
    return;
  }

  socket.emit('commitNodeConfig', { target, targetUid });
  configStatus.textContent = 'Đã gửi lệnh commit cấu hình LoRa';
  configStatus.style.color = '#28a745';
});

rollbackConfigBtn.addEventListener('click', () => {
  const { target, targetUid } = getConfigActionTarget();
  if (!target) {
    configStatus.textContent = 'Vui lòng chọn node trước khi rollback';
    configStatus.style.color = '#dc3545';
    return;
  }

  socket.emit('rollbackNodeConfig', { target, targetUid });
  configStatus.textContent = 'Đã gửi lệnh rollback cấu hình LoRa';
  configStatus.style.color = '#dc3545';
});

function getLoraNetworkFromForm() {
  return {
    gatewayAddress: configGatewayAddress.value,
    networkId: configNetworkId.value,
    channel: configChannel.value,
    baudRateCode: configBaudRateCode.value,
    airRate: configAirRate.value,
    power: configPower.value
  };
}

function fillLoraNetworkForm(config) {
  configGatewayAddress.value = config.gatewayAddress;
  configNetworkId.value = config.networkId;
  configChannel.value = config.channel;
  configBaudRateCode.value = config.baudRateCode;
  configAirRate.value = config.airRate;
  configPower.value = config.power;
}

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
    data = data.filter(d => matchesSelectedNode(d, state.selectedNode));
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
      const syncFlag = data.gatewayLoraSync?.inSync ? 'GatewaySync:OK' : 'GatewaySync:PENDING';
      systemInfo.textContent = `Nodes: ${data.nodes} | Clients: ${data.connectedClients} | ${syncFlag} | RAM: ${data.memory.heapUsed} | Uptime: ${data.uptime}`;
      if (data.gatewayLoraSync) {
        updateGatewaySyncStatus(data.gatewayLoraSync);
      }
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

async function fetchNodeConfigs() {
  try {
    const response = await fetch('/api/config/nodes');
    const data = await response.json();
    if (data.success) {
      state.nodeConfigs.clear();
      data.data.forEach(config => {
        state.nodeConfigs.set(config.targetUid || config.nodeId, config);
      });

      if (configTarget.value) {
        fillConfigForm(configTarget.value);
      }
    }
  } catch (err) {
    console.error('Failed to fetch node configs:', err);
  }
}

async function fetchLoraNetwork() {
  try {
    const response = await fetch('/api/config/network');
    const data = await response.json();
    if (data.success) {
      state.loraNetwork = data.data;
      fillLoraNetworkForm(data.data);
      if (data.gatewaySync) {
        updateGatewaySyncStatus(data.gatewaySync);
      }
    }
  } catch (err) {
    console.error('Failed to fetch LoRa network config:', err);
  }
}

async function fetchGatewaySync() {
  try {
    const response = await fetch('/api/config/gateway/sync');
    const data = await response.json();
    if (data.success) {
      updateGatewaySyncStatus(data.data);
    }
  } catch (err) {
    console.error('Failed to fetch gateway sync status:', err);
  }
}

async function confirmGatewaySync() {
  try {
    const response = await fetch('/api/config/gateway/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appliedProfileVersion: state.loraNetwork?.updatedAt || '',
        note: 'Gateway confirmed via dashboard'
      })
    });
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.message || 'Xác nhận đồng bộ thất bại');
    }
    updateGatewaySyncStatus(data.data);
    configStatus.textContent = 'Đã xác nhận gateway đã đổi profile mạng mới';
    configStatus.style.color = '#17a2b8';
    addLog('success', 'Đã xác nhận gateway đồng bộ profile LoRa');
  } catch (err) {
    if (gatewaySyncStatus) {
      gatewaySyncStatus.classList.remove('synced', 'pending');
      gatewaySyncStatus.classList.add('error');
    }
    addLog('error', `Lỗi xác nhận gateway: ${err.message}`);
  }
}

async function fetchAnalyticsOverview() {
  try {
    const params = new URLSearchParams();
    if (analyticsNodeSelect.value) {
      params.append('nodeId', analyticsNodeSelect.value);
    }
    params.append('windowMinutes', analyticsWindowSelect.value || '120');
    params.append('forecastMinutes', analyticsForecastSelect.value || '30');

    const queryString = params.toString();
    const [analyticsResponse, healthResponse] = await Promise.all([
      fetch(`/api/analytics/overview?${queryString}`),
      fetch(`/api/analytics/health?${queryString}`)
    ]);

    const data = await analyticsResponse.json();
    const healthData = await healthResponse.json();

    if (data.success && healthData.success) {
      state.analyticsOverview = data;
      state.nodeHealth = healthData;
      renderAnalytics();
    } else {
      throw new Error(data.message || healthData.message || 'Không thể tải analytics');
    }
  } catch (err) {
    console.error('Failed to fetch analytics:', err);
    analyticsSummary.textContent = `Lỗi tải analytics: ${err.message}`;
    analyticsCards.innerHTML = '<div class="loading">Không thể tải dữ liệu phân tích</div>';
  }
}

function fillConfigForm(nodeId) {
  const node = state.nodes.get(nodeId);
  const config = state.nodeConfigs.get(nodeId) || state.nodeConfigs.get(node?.uid) || state.nodeConfigs.get(node?.id);
  const lora = config ? config.lora || {} : {};

  configNodeId.value = config ? config.nodeId : (node ? node.id : nodeId);
  configAddress.value = lora.address !== undefined ? lora.address : '';
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
    if (!state.selectedNode) {
      state.history = [];
      drawChart();
      addLog('info', 'Hãy chọn node trước khi lọc dữ liệu');
      return;
    }

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
    if (!state.selectedNode) {
      state.history = [];
      drawChart();
      return;
    }

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
  fetchGatewaySync();
  fetchAnalyticsOverview();
}, 30000); // Update every 30 seconds

// Check node status (online/offline) every 5 seconds
setInterval(() => {
  state.nodes.forEach(node => {
    updateNodeCard(node);
  });
}, 5000);

// Initial load
addLog('info', 'Dashboard khởi động');
updateFilterStatus(); // Initialize filter status indicator
fetchGatewaySync();
fetchAnalyticsOverview();
switchTab(localStorage.getItem('activeDashboardTab') || 'nodes');
