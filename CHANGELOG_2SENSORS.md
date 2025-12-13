# Changelog: Cập nhật hệ thống hỗ trợ 2 cảm biến DHT11

## Tổng quan

Hệ thống đã được nâng cấp để hỗ trợ **2 cảm biến DHT11** trên mỗi node thay vì 1 cảm biến. Dữ liệu từ cả 2 cảm biến được thu thập, truyền và hiển thị riêng biệt, đồng thời tính giá trị trung bình để điều khiển relay tự động.

## Module LoRa

Hệ thống đã chuyển từ **SX1278 (SPI)** sang **AS32-TTL-100 (UART)** với packet framing `<>` để đảm bảo truyền dữ liệu tin cậy.

---

## Thay đổi chi tiết

### 1. Arduino Node (`lora_sensor_node_AS32.ino`)

#### Hardware:
```
DHT11 Sensor 1 → D4
DHT11 Sensor 2 → D6
Relay          → D7
LoRa AS32 TX   → D2 (Arduino RX)
LoRa AS32 RX   → D3 (Arduino TX)
LoRa AS32 AUX  → D5 (optional)
LoRa AS32 M0   → GND (Normal mode)
LoRa AS32 M1   → GND (Normal mode)
```

#### Thay đổi code:
- ✅ Khởi tạo 2 đối tượng DHT: `dht1` và `dht2`
- ✅ Lưu trữ riêng: `temperature1`, `humidity1`, `temperature2`, `humidity2`
- ✅ Tính giá trị trung bình: `avgTemperature`, `avgHumidity`
- ✅ Xử lý lỗi thông minh: nếu 1 cảm biến lỗi, dùng cảm biến còn lại
- ✅ Sử dụng SoftwareSerial thay vì SPI
- ✅ Packet framing với markers `<` và `>`

#### Định dạng JSON mới:
```json
{
  "id": "KHO_A",
  "temp1": 25.5,    // Cảm biến 1
  "hum1": 65.0,
  "temp2": 26.2,    // Cảm biến 2
  "hum2": 68.0,
  "temp": 25.9,     // Trung bình (dùng cho relay control)
  "hum": 66.5,
  "relay": false,
  "manual": false
}
```

#### Log Serial Monitor:
```
--- Sensor Readings ---
Sensor 1 - Temp: 25.5°C, Hum: 65.0%
Sensor 2 - Temp: 26.2°C, Hum: 68.0%
Average - Temp: 25.9°C, Hum: 66.5%
---------------------
Sent: <{"id":"KHO_A","temp1":25.5,"hum1":65.0,...}>
```

---

### 2. Gateway Server (`src/server.js`)

#### Packet Framing:
- ✅ Thêm buffer `serialBuffer` để xử lý packet framing
- ✅ Parse dữ liệu giữa markers `<` và `>`
- ✅ Fallback: hỗ trợ cả JSON không có markers (backward compatible)
- ✅ Gửi lệnh với packet framing: `<command>\n`

#### Log Server:
```javascript
[2025-01-15T10:30:15.000Z] Received from KHO_A: {
  temp: 25.9,
  hum: 66.5,
  relay: false,
  sensor1: { temp: 25.5, hum: 65.0 },
  sensor2: { temp: 26.2, hum: 68.0 },
  avg: { temp: 25.9, hum: 66.5 }
}
```

#### API Response:
Tất cả API endpoints (`/api/nodes`, `/api/history`) giờ trả về đầy đủ:
```json
{
  "id": "KHO_A",
  "temp1": 25.5,
  "hum1": 65.0,
  "temp2": 26.2,
  "hum2": 68.0,
  "temp": 25.9,
  "hum": 66.5,
  "relay": false,
  "manual": false,
  "timestamp": "2025-01-15T10:30:15.000Z",
  "receivedAt": 1736938215000
}
```

---

### 3. Web Dashboard (`public/app.js` & `public/style.css`)

#### Hiển thị Node Card:
- ✅ Tự động phát hiện node có 2 cảm biến (kiểm tra `temp1` và `temp2`)
- ✅ Hiển thị 3 phần: Cảm biến 1, Cảm biến 2, Trung bình
- ✅ Backward compatible: node chỉ có 1 cảm biến vẫn hiển thị bình thường

#### Layout mới:
```
┌─────────────────────────────────┐
│  KHO_A              [ONLINE]    │
├─────────────────────────────────┤
│  🌡️ Cảm biến 1                 │
│  Nhiệt độ: 25.5°C  Độ ẩm: 65%  │
├─────────────────────────────────┤
│  🌡️ Cảm biến 2                 │
│  Nhiệt độ: 26.2°C  Độ ẩm: 68%  │
├─────────────────────────────────┤
│  📊 Trung bình                  │
│  Nhiệt độ: 25.9°C  Độ ẩm: 66.5%│
├─────────────────────────────────┤
│  Relay: BẬT         [AUTO]      │
│  [BẬT] [TẮT] [AUTO]             │
└─────────────────────────────────┘
```

#### Log hiển thị:
```
[10:30:15] KHO_A: S1[25.5°C, 65%] S2[26.2°C, 68%] Avg[25.9°C, 66.5%] Relay: OFF
```

#### CSS:
- ✅ Thêm `.sensor-group` styling
- ✅ `.sensor-group.average` có background đặc biệt (highlight)
- ✅ Font size điều chỉnh: sensor nhỏ hơn, average lớn hơn
- ✅ Responsive design vẫn hoạt động tốt

---

## Tương thích ngược (Backward Compatibility)

### ✅ Hệ thống vẫn hỗ trợ:
1. **Node cũ chỉ có 1 cảm biến**: Dashboard tự động phát hiện và hiển thị giao diện cũ
2. **JSON không có packet framing**: Server vẫn parse được JSON thông thường
3. **API format cũ**: Các field `temp` và `hum` vẫn tồn tại (là giá trị trung bình)

---

## Hướng dẫn nâng cấp

### Cho Node hiện có:

1. **Hardware**: Thêm DHT11 thứ 2 vào pin D6
   ```
   DHT11 #2:
   - DATA → D6
   - VCC  → 5V
   - GND  → GND
   ```

2. **Software**: Upload code mới `lora_sensor_node_AS32.ino`

3. **Thư viện**: Đảm bảo đã cài:
   - DHT sensor library (Adafruit)
   - ArduinoJson
   - SoftwareSerial (built-in)

4. **Module LoRa**: Thay SX1278 bằng AS32-TTL-100
   - Kết nối TX → D2, RX → D3
   - Nối M0, M1 → GND
   - Cấu hình: Channel 23 (433MHz), Baud 9600

### Cho Gateway:

1. **Code**: Đã cập nhật sẵn trong `src/server.js`
2. **Restart**: `npm start` hoặc restart systemd service
3. **Module LoRa**: Gateway cũng cần AS32-TTL-100 thay vì SX1278

---

## Ưu điểm của bản nâng cấp

### 1. Độ chính xác cao hơn
- ✅ Trung bình 2 cảm biến giảm sai số
- ✅ Phát hiện cảm biến lỗi tự động

### 2. Độ tin cậy cao hơn
- ✅ Dự phòng: nếu 1 cảm biến hỏng, hệ thống vẫn hoạt động
- ✅ Packet framing tránh mất dữ liệu

### 3. Dễ sử dụng hơn
- ✅ AS32-TTL-100 đơn giản hơn SX1278 (chỉ 2 dây thay vì 6 dây)
- ✅ Kết nối ít hơn, ít lỗi hơn

### 4. Tầm xa hơn
- ✅ AS32-TTL-100 với 100mW: ~3km line-of-sight
- ✅ SX1278 thông thường: ~2km

---

## Kiểm tra hoạt động

### Arduino Serial Monitor (9600 baud):
```
LoRa Sensor Node (AS32-TTL-100) Initializing...
DHT11 Sensors initialized (2 sensors)
LoRa Module Initialized!
Node ID: KHO_A
Ready to send data...
--- Sensor Readings ---
Sensor 1 - Temp: 25.5°C, Hum: 65.0%
Sensor 2 - Temp: 26.2°C, Hum: 68.0%
Average - Temp: 25.9°C, Hum: 66.5%
---------------------
Sent: <{"id":"KHO_A","temp1":25.5,...}>
```

### Server Console:
```
Serial port COM3 opened at 9600 baud
Using packet framing with < > markers
[2025-01-15T10:30:15.000Z] Received from KHO_A: {
  temp: 25.9,
  hum: 66.5,
  relay: false,
  sensor1: { temp: 25.5, hum: 65.0 },
  sensor2: { temp: 26.2, hum: 68.0 },
  avg: { temp: 25.9, hum: 66.5 }
}
```

### Web Dashboard:
- Mở http://localhost:3000
- Xem node card hiển thị 3 phần: Sensor 1, Sensor 2, Average
- Log hiển thị: `KHO_A: S1[25.5°C, 65%] S2[26.2°C, 68%]...`

---

## Xử lý lỗi thường gặp

### 1. Chỉ thấy 1 cảm biến
**Nguyên nhân**: Cảm biến 2 chưa kết nối hoặc lỗi
**Giải pháp**:
- Kiểm tra kết nối DHT11 #2 ở pin D6
- Xem Serial Monitor có log "Warning: Sensor 2 failed"

### 2. Không nhận được dữ liệu
**Nguyên nhân**: Packet framing không khớp
**Giải pháp**:
- Đảm bảo cả Arduino và Gateway đều dùng code mới
- Kiểm tra Serial Monitor có thấy `<{...}>`

### 3. Dashboard hiển thị lỗi
**Nguyên nhân**: Server chưa restart
**Giải pháp**:
- Restart server: `npm start`
- Clear cache trình duyệt: Ctrl+F5

---

## Files đã thay đổi

- ✅ `arduino/lora_sensor_node_AS32/lora_sensor_node_AS32.ino` - Code Arduino mới
- ✅ `arduino/README_AS32.md` - Hướng dẫn AS32-TTL-100
- ✅ `src/server.js` - Gateway server với packet framing
- ✅ `public/app.js` - Dashboard hiển thị 2 cảm biến
- ✅ `public/style.css` - CSS cho layout mới
- ✅ `CHANGELOG_2SENSORS.md` - File này

---

## Ghi chú

- Hệ thống cũ (1 cảm biến + SX1278) vẫn hoạt động bình thường
- Có thể mix cả 2 loại node (cũ và mới) trong cùng mạng
- Để nâng cấp dần, không cần thay đổi tất cả node cùng lúc

---

**Ngày cập nhật**: 2025-01-15
**Phiên bản**: 2.0 (2 sensors + AS32-TTL-100)
