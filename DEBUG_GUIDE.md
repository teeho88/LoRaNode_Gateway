# Hướng dẫn Debug - Gateway không nhận dữ liệu

## 🚨 Triệu chứng
- Arduino gửi dữ liệu thành công (thấy trong Serial Monitor)
- Gateway nhận được dữ liệu qua serial port
- Nhưng server không hiển thị node, dashboard trống

---

## 🔍 Các bước kiểm tra

### Bước 1: Kiểm tra Serial Port

#### Trên Windows:
1. Mở **Device Manager** (Win + X → Device Manager)
2. Tìm **Ports (COM & LPT)**
3. Xác định Arduino đang ở port nào (ví dụ: COM3, COM4)

#### Trên Linux/Raspberry Pi:
```bash
ls /dev/tty*
# Thường là /dev/ttyUSB0 hoặc /dev/ttyACM0
```

#### Cập nhật file `.env`:
```
SERIAL_PORT=COM3          # Windows
# hoặc
SERIAL_PORT=/dev/ttyUSB0  # Linux/RPi
```

---

### Bước 2: Test Arduino riêng biệt

1. Mở Arduino IDE
2. Mở Serial Monitor (Ctrl+Shift+M)
3. Chọn baud rate: **9600**
4. Quan sát output:

**✅ Output đúng:**
```
--- Sensor Readings ---
Sensor 1 - Temp: 25.5°C, Hum: 65.0%
Sensor 2 - Temp: 26.2°C, Hum: 68.0%
Average - Temp: 25.9°C, Hum: 66.5%
---------------------
Sent: <{"id":"KHO_A","temp1":25.5,"hum1":65.0,"temp2":26.2,"hum2":68.0,"temp":25.9,"hum":66.5,"relay":false,"manual":false}>
```

**❌ Output sai (thiếu `<>`):**
```
Sent: {"id":"KHO_A","temp":25.9,...}
```
→ Nếu thiếu `<>`, kiểm tra lại code Arduino có dùng `START_MARKER` và `END_MARKER`

---

### Bước 3: Test Gateway với Debug Logs

1. **Đóng Arduino Serial Monitor** (quan trọng! chỉ 1 chương trình được mở port)
2. Chạy gateway:
```bash
npm start
```

3. Quan sát logs:

#### ✅ Case 1: Hoạt động bình thường
```
Serial port COM3 opened at 9600 baud
Using packet framing with < > markers
Waiting for sensor data...
[RAW] <{"id":"KHO_A","temp1":25.5,"hum1":65.0,"temp2":26.2,"hum2":68.0,"temp":25.9,"hum":66.5,"relay":false,"manual":false}>
[DEBUG] Packet start detected
[DEBUG] Packet end detected, buffer: {"id":"KHO_A","temp1":25.5,"hum1":65.0,"temp2":26.2,"hum2":68.0,"temp":25.9,"hum":66.5,"relay":false,"manual":false}
[SUCCESS] Parsed JSON: { id: 'KHO_A', temp1: 25.5, hum1: 65, temp2: 26.2, hum2: 68, temp: 25.9, hum: 66.5, relay: false, manual: false }
[2025-01-15T10:30:15.000Z] Received from KHO_A: {
  temp: 25.9,
  hum: 66.5,
  relay: false,
  sensor1: { temp: 25.5, hum: 65 },
  sensor2: { temp: 26.2, hum: 68 },
  avg: { temp: 25.9, hum: 66.5 }
}
```
→ **Thành công!** Mở http://localhost:3000 sẽ thấy node

#### ❌ Case 2: Không thấy `[RAW]`
```
Serial port COM3 opened at 9600 baud
Using packet framing with < > markers
Waiting for sensor data...
(không có gì thêm)
```

**Nguyên nhân:**
- COM port sai
- Arduino chưa được nối vào
- Serial Monitor đang mở (chỉ 1 app được mở port cùng lúc)
- Cable USB lỗi

**Giải pháp:**
1. Kiểm tra lại COM port trong `.env`
2. Đóng tất cả Serial Monitor
3. Rút và cắm lại USB Arduino
4. Restart server

#### ❌ Case 3: Thấy `[RAW]` nhưng không parse được
```
[RAW] {"id":"KHO_A","temp1":25.5,...}
(không có [DEBUG] Packet start)
```

**Nguyên nhân:** Arduino không gửi `<>` markers

**Giải pháp:**
1. Kiểm tra Arduino code có hàm `sendLoRaMessage()`:
```cpp
void sendLoRaMessage(String message) {
  waitForAux();
  loraSerial.print(START_MARKER);  // Phải có dòng này!
  loraSerial.print(message);
  loraSerial.print(END_MARKER);    // Phải có dòng này!
  delay(50);
}
```

2. Hoặc sử dụng fallback mode (server tự động parse JSON không có `<>`)

#### ❌ Case 4: Parse JSON lỗi
```
[RAW] <{"id":"KHO_A","temp1":25.5,>
[DEBUG] Packet start detected
[DEBUG] Packet end detected, buffer: {"id":"KHO_A","temp1":25.5,
[ERROR] Failed to parse JSON: {"id":"KHO_A","temp1":25.5,
[ERROR] Parse error: Unexpected end of JSON input
```

**Nguyên nhân:** JSON bị cắt nửa, thiếu dấu đóng ngoặc

**Giải pháp:**
1. Kiểm tra Arduino có đủ RAM không (JSON size 300 bytes)
2. Tăng delay sau khi gửi:
```cpp
delay(50); // Tăng lên 100 nếu cần
```
3. Giảm tốc độ gửi dữ liệu (SEND_INTERVAL từ 5000 lên 10000)

---

### Bước 4: Kiểm tra Dashboard

Nếu server logs thành công nhưng dashboard vẫn trống:

1. Mở Developer Tools (F12) → Console
2. Xem có lỗi JavaScript không
3. Kiểm tra Network tab xem có kết nối WebSocket không

**WebSocket phải hiện:**
```
ws://localhost:3000/socket.io/?EIO=4&transport=websocket
Status: 101 Switching Protocols
```

4. Hard refresh browser: **Ctrl+Shift+R** (Windows) hoặc **Cmd+Shift+R** (Mac)

---

## 🛠️ Công cụ Debug nâng cao

### 1. Test Serial Port với Python

Nếu muốn test serial port độc lập:

```python
import serial
import time

ser = serial.Serial('COM3', 9600, timeout=1)
print("Listening...")

while True:
    if ser.in_waiting:
        data = ser.readline().decode('utf-8', errors='ignore')
        print(f"Received: {data}")
```

### 2. Test với Mock Data

Nếu muốn test server mà không cần Arduino:

**File: `test-mock-data.js`**
```javascript
const io = require('socket.io-client');

const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('Connected to server');

  // Mock data với 2 sensors
  const mockData = {
    id: 'TEST_NODE',
    temp1: 25.5,
    hum1: 65.0,
    temp2: 26.2,
    hum2: 68.0,
    temp: 25.9,
    hum: 66.5,
    relay: false,
    manual: false
  };

  // Inject directly to server (if you add a test endpoint)
  console.log('Sending mock data:', mockData);
});
```

Chạy:
```bash
node test-mock-data.js
```

---

## 🔧 Cấu hình thường gặp

### Windows (Test local)
```env
# .env
SERIAL_PORT=COM3
BAUD_RATE=9600
PORT=3000
MAX_HISTORY=500
```

### Raspberry Pi (Production)
```env
# .env
SERIAL_PORT=/dev/ttyUSB0
BAUD_RATE=9600
PORT=3000
MAX_HISTORY=500
```

---

## ✅ Checklist Debug

- [ ] Arduino Serial Monitor thấy dữ liệu với `<{...}>`
- [ ] File `.env` có COM port đúng
- [ ] Server logs thấy `[RAW]` data
- [ ] Server logs thấy `[DEBUG] Packet start detected`
- [ ] Server logs thấy `[SUCCESS] Parsed JSON`
- [ ] Server logs thấy `Received from KHO_A`
- [ ] Dashboard F12 Console không có lỗi
- [ ] Dashboard có WebSocket connection
- [ ] Hard refresh browser (Ctrl+Shift+R)

---

## 📞 Khi cần hỗ trợ

Gửi cho tôi:

1. **Arduino Serial Monitor output** (copy 5-10 dòng)
2. **Server console output** (copy toàn bộ từ khi start)
3. **File `.env`** (để kiểm tra config)
4. **Browser console log** (F12 → Console, copy lỗi nếu có)
5. **Thông tin hệ thống:**
   - OS: Windows / Linux / Raspberry Pi
   - Node.js version: `node --version`
   - Arduino board: Nano / Uno
   - LoRa module: AS32-TTL-100 hay SX1278

---

**Cập nhật:** 2025-01-15
