# Changelog: Sửa lỗi Filter không khóa biểu đồ

## 🐛 Vấn đề

Khi người dùng áp dụng filter theo thời gian (ngày, giờ bắt đầu, giờ kết thúc), biểu đồ hiển thị dữ liệu đã lọc đúng. Tuy nhiên, khi có dữ liệu mới real-time từ WebSocket, các giá trị mới này vẫn được tự động thêm vào biểu đồ, mặc dù chúng nằm ngoài khoảng thời gian đã lọc.

**Ví dụ:**
1. User lọc dữ liệu từ 08:00 đến 12:00 ngày 15/01/2025
2. Biểu đồ hiển thị đúng 100 bản ghi trong khoảng thời gian đó
3. Lúc 14:30 có dữ liệu mới từ sensor → dữ liệu này vẫn được thêm vào chart
4. Biểu đồ bây giờ có 101 bản ghi, trong đó 1 bản ghi nằm ngoài filter (14:30)

## ✅ Giải pháp

Thêm cờ `state.isFiltered` để theo dõi trạng thái filter:
- Khi `isFiltered = true`: Không cập nhật biểu đồ với dữ liệu mới từ WebSocket
- Khi `isFiltered = false`: Cập nhật biểu đồ real-time như bình thường

## 🐛 Vấn đề bổ sung (Update 2)

### Vấn đề 2.1: Chart không hiển thị sau khi refresh trang
Khi refresh trang, `initialData` từ WebSocket chỉ chứa 50 bản ghi cuối, có thể không đủ để vẽ chart (cần tối thiểu 2 bản ghi).

### Vấn đề 2.2: Chart không hiển thị real-time sau khi Arduino reconnect
Khi Arduino node mất kết nối rồi kết nối lại, nếu `state.history` trống hoặc quá nhỏ, chart không tự động cập nhật.

## 📝 Các thay đổi

### 1. **public/app.js** - State management

Thêm cờ `isFiltered`:

```javascript
const state = {
  nodes: new Map(),
  history: [],
  selectedNode: null,
  dailyStats: [],
  isFiltered: false, // Track if filters are active ← MỚI
  filters: {
    date: null,
    startTime: null,
    endTime: null
  }
};
```

### 2. **public/app.js** - initialData handler (Fix refresh issue)

Load đầy đủ dữ liệu từ API thay vì dùng `initialData` giới hạn:

```javascript
socket.on('initialData', (data) => {
  console.log('Received initial data:', data);
  data.nodes.forEach(node => {
    state.nodes.set(node.id, node);
  });
  state.history = data.history || [];
  state.isFiltered = false; // Ensure chart is in real-time mode ← MỚI
  renderNodes();
  updateNodeSelect();

  // Fetch full history from API instead of using limited initialData ← MỚI
  fetchRecentHistory();

  fetchDailyStats();
  addLog('info', `Đã tải ${data.nodes.length} nodes, đang tải dữ liệu biểu đồ...`);
});
```

### 3. **public/app.js** - WebSocket handler (Fix filter + auto-reload)

Chỉ cập nhật chart khi KHÔNG có filter active, và tự động reload nếu history quá nhỏ:

```javascript
socket.on('sensorData', (data) => {
  console.log('Sensor data:', data);
  state.nodes.set(data.id, data);

  // Only update history and chart if no filter is active
  if (!state.isFiltered) {
    // If history is empty or too small, reload from API ← MỚI (Fix reconnect)
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

  // Always update node card (latest data) ← VẪN CẬP NHẬT NODE CARD
  updateNodeCard(data);
  updateNodeSelect();

  // ... logging code
});
```

**Quan trọng:**
- Node cards vẫn cập nhật real-time (hiển thị giá trị mới nhất)
- Chỉ biểu đồ bị "khóa" khi có filter
- Nếu history < 2 bản ghi → tự động reload từ API

### 4. **public/app.js** - Initial load (Fix status indicator)

Cập nhật status indicator khi khởi động:

```javascript
// Initial load
addLog('info', 'Dashboard khởi động');
updateFilterStatus(); // Initialize filter status indicator ← MỚI
```

### 6. **public/app.js** - fetchFilteredHistory()

Set `isFiltered = true` khi apply filter:

```javascript
async function fetchFilteredHistory() {
  // ... fetch logic

  if (data.success) {
    state.history = data.data;
    state.isFiltered = true; // Mark as filtered ← MỚI
    drawChart();
    updateFilterStatus(); // ← MỚI: Update visual indicator
    addLog('info', `Đã lọc ${data.count} bản ghi - Biểu đồ đã khóa`);
  }
}
```

### 7. **public/app.js** - fetchRecentHistory()

Clear `isFiltered` khi xóa filter:

```javascript
async function fetchRecentHistory() {
  // ... fetch logic

  if (data.success) {
    state.history = data.data;
    state.isFiltered = false; // Clear filtered state ← MỚI
    drawChart();
    updateFilterStatus(); // ← MỚI: Update visual indicator
    addLog('info', `Đã tải ${data.count} bản ghi gần nhất - Biểu đồ real-time`);
  }
}
```

### 8. **public/app.js** - Visual indicator

Thêm hàm hiển thị trạng thái filter:

```javascript
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
```

### 9. **public/index.html** - UI indicator

Thêm phần tử hiển thị trạng thái:

```html
<div class="chart-controls">
  <select id="node-select">...</select>
  <input type="date" id="date-filter">
  <input type="time" id="start-time-filter">
  <input type="time" id="end-time-filter">
  <button id="apply-filter">Lọc</button>
  <button id="clear-filter">Xóa lọc</button>
  <span id="filter-status"></span> ← MỚI
</div>
```

### 10. **public/app.js** - Clear filter button

Thêm clear `isFiltered`:

```javascript
clearFilterBtn.addEventListener('click', () => {
  state.filters.date = null;
  state.filters.startTime = null;
  state.filters.endTime = null;
  state.isFiltered = false; // Clear filtered state ← MỚI
  dateFilter.value = '';
  startTimeFilter.value = '';
  endTimeFilter.value = '';

  fetchRecentHistory();
});
```

## 🎯 Workflow sau khi sửa

### Trường hợp 1: Không có filter (Real-time mode)

```
Dữ liệu mới từ WebSocket
  ↓
state.isFiltered = false
  ↓
Thêm vào state.history
  ↓
Vẽ lại chart
  ↓
Hiển thị: 🔄 Real-time (tự động cập nhật)
```

### Trường hợp 2: Có filter active (Locked mode)

```
User nhấn "Lọc" (08:00-12:00)
  ↓
fetchFilteredHistory()
  ↓
state.isFiltered = true
  ↓
Biểu đồ hiển thị dữ liệu đã lọc
  ↓
Hiển thị: 🔒 Biểu đồ đã khóa (không tự động cập nhật)
  ↓
Dữ liệu mới từ WebSocket (14:30)
  ↓
state.isFiltered = true → BỎ QUA cập nhật chart
  ↓
Node card vẫn cập nhật (hiển thị 14:30)
  ↓
Biểu đồ không thay đổi (vẫn là 08:00-12:00)
```

### Trường hợp 3: Xóa filter

```
User nhấn "Xóa lọc"
  ↓
fetchRecentHistory()
  ↓
state.isFiltered = false
  ↓
Load 100 bản ghi gần nhất
  ↓
Hiển thị: 🔄 Real-time (tự động cập nhật)
  ↓
Dữ liệu mới từ WebSocket
  ↓
Thêm vào chart (real-time trở lại)
```

## 🧪 Test cases

### Test 1: Filter khóa chart
1. Chọn ngày hôm qua, lọc 08:00-12:00
2. Nhấn "Lọc"
3. ✅ Thấy thông báo "🔒 Biểu đồ đã khóa"
4. Đợi sensor gửi data mới (hoặc Arduino gửi data)
5. ✅ Node card cập nhật
6. ✅ Biểu đồ KHÔNG thay đổi

### Test 2: Clear filter về real-time
1. (Tiếp từ Test 1 - chart đang khóa)
2. Nhấn "Xóa lọc"
3. ✅ Thấy thông báo "🔄 Real-time"
4. ✅ Chart load 100 bản ghi gần nhất
5. Đợi sensor gửi data mới
6. ✅ Chart tự động cập nhật

### Test 3: Node card luôn real-time
1. Filter chart theo thời gian
2. ✅ Chart khóa
3. Sensor gửi data mới
4. ✅ Node card hiển thị giá trị mới nhất (temp, hum, relay status)
5. ✅ Chart vẫn không đổi

## 📊 So sánh trước và sau

| Tính năng | Trước khi sửa | Sau khi sửa |
|-----------|---------------|-------------|
| Filter chart | ✅ Lọc đúng | ✅ Lọc đúng |
| Data mới khi filter | ❌ Thêm vào chart | ✅ Không thêm vào chart |
| Node card real-time | ✅ Cập nhật | ✅ Cập nhật |
| Visual indicator | ❌ Không có | ✅ Có (🔒/🔄) |
| Log message | ⚠️ Không rõ ràng | ✅ Rõ ràng (khóa/real-time) |

## 🎨 UI Changes

**Trước:**
```
[Select Node] [Date] [Start] [End] [Lọc] [Xóa lọc]
```

**Sau:**
```
[Select Node] [Date] [Start] [End] [Lọc] [Xóa lọc] 🔒 Biểu đồ đã khóa
```

Hoặc:

```
[Select Node] [Date] [Start] [End] [Lọc] [Xóa lọc] 🔄 Real-time
```

## ✅ Files modified

1. `public/app.js` - Logic chính
2. `public/index.html` - UI indicator

## 🚀 Deployment

```bash
# Không cần rebuild hoặc restart server
# Chỉ cần refresh browser (Ctrl+F5 hoặc Shift+F5)

# Nếu dùng systemd service:
# Không cần restart - file static tự động reload
```

## 📝 Notes

- **Node cards luôn real-time**: Điều này đúng vì user cần biết giá trị mới nhất của sensor để điều khiển relay
- **Chỉ chart bị khóa**: Đây là mục đích của filter - xem dữ liệu trong khoảng thời gian cụ thể mà không bị nhiễu bởi data mới
- **Không ảnh hưởng backend**: Tất cả thay đổi ở frontend, server không cần sửa

---

**Ngày cập nhật:** 2025-01-15
**Người thực hiện:** Claude Code Assistant
