# Hướng dẫn: Sử dụng AS32-TTL-100 KHÔNG cần AT Config

## 🎯 Kết luận

Module AS32-TTL-100 của bạn **không phản hồi AT commands**, nhưng điều này **KHÔNG phải vấn đề**!

Các module LoRa thường đã được cấu hình sẵn từ nhà máy và có thể giao tiếp với nhau mà không cần thay đổi cấu hình.

---

## ✅ Cấu hình mặc định AS32-TTL-100

Hầu hết AS32-TTL-100 xuất xưởng với:

- **Address**: 0x0000 (broadcast - nhận tất cả)
- **Channel**: 23 (433MHz band)
- **Baud Rate**: 9600
- **Air Rate**: 2.4k
- **Power**: 20dBm (100mW)
- **Network ID**: 0x00

→ Tất cả module dùng cấu hình này sẽ giao tiếp được với nhau!

---

## 🔧 Setup không cần AT Config

### Bước 1: Kết nối phần cứng

```
AS32-TTL-100 (Gateway)    Raspberry Pi GPIO
──────────────────────────────────────────
TXD                   →   GPIO 15 (RXD)  hoặc GPIO 14 (TXD) nếu đã đảo
RXD                   →   GPIO 14 (TXD)  hoặc GPIO 15 (RXD) nếu đã đảo
M0                    →   GND (hoặc GPIO 23)
M1                    →   GND (hoặc GPIO 24)
AUX                   →   GPIO 18 (optional)
VCC                   →   5V
GND                   →   GND
```

**Quan trọng:**
- **M0 → GND** (NORMAL mode để nhận/gửi data)
- **M1 → GND** (NORMAL mode để nhận/gửi data)

### Bước 2: Cập nhật code để không dùng GPIO control M0/M1

Vì M0, M1 nối cố định vào GND (bằng dây), không cần GPIO control.

Sửa file `src/server.js`:

```javascript
// Comment out GPIO initialization
function initGPIO() {
  if (!Gpio) {
    console.log('⚠️  GPIO not available (not running on Raspberry Pi)');
    return;
  }

  // SKIP GPIO control - M0, M1 are hardwired to GND
  console.log('ℹ️  M0 and M1 hardwired to GND (NORMAL mode)');
  console.log('   No GPIO control needed');

  // Don't initialize GPIO for M0, M1
  /*
  try {
    m0 = new Gpio(M0_PIN, 'out');
    m1 = new Gpio(M1_PIN, 'out');
    aux = new Gpio(AUX_PIN, 'in');

    m0.writeSync(0);
    m1.writeSync(0);

    console.log('✅ GPIO initialized: AS32-TTL-100 in NORMAL mode (M0=0, M1=0)');
  } catch (err) {
    console.error('⚠️  GPIO initialization failed:', err.message);
    console.log('   Module must be set to normal mode manually (M0→GND, M1→GND)');
  }
  */
}
```

### Bước 3: Test nhận dữ liệu từ Arduino

Đảm bảo Arduino node đang chạy và gửi dữ liệu:

```bash
# Test nhận dữ liệu
python3 config_as32.py test
```

Hoặc:

```bash
python3 << 'EOF'
import serial
import time

ser = serial.Serial('/dev/ttyAMA0', 9600, timeout=1)
print("✅ Listening for LoRa data on /dev/ttyAMA0 (9600 baud)")
print("📡 Module in NORMAL mode (M0=GND, M1=GND)")
print("⏳ Waiting for data from Arduino nodes...\n")

buffer = ''
packet_count = 0

try:
    while True:
        if ser.in_waiting > 0:
            data = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
            buffer += data

            # Look for packets with < > markers
            while '<' in buffer and '>' in buffer:
                start = buffer.index('<')
                end = buffer.index('>')

                if start < end:
                    packet = buffer[start:end+1]
                    packet_count += 1
                    print(f"📥 Packet #{packet_count}: {packet}")

                    # Try to parse JSON
                    try:
                        import json
                        json_str = packet[1:-1]  # Remove < >
                        data_obj = json.loads(json_str)
                        print(f"   ID: {data_obj.get('id')}")
                        print(f"   Temp: {data_obj.get('temp')}°C, Hum: {data_obj.get('hum')}%")
                        print(f"   Relay: {data_obj.get('relay')}\n")
                    except:
                        pass

                    buffer = buffer[end+1:]
                else:
                    buffer = buffer[end+1:]

        time.sleep(0.1)

except KeyboardInterrupt:
    print(f"\n👋 Stopped. Received {packet_count} packets total.")
    ser.close()
EOF
```

### Bước 4: Start Gateway Server

```bash
# Cập nhật .env
nano .env
```

Đảm bảo:
```env
SERIAL_PORT=/dev/ttyAMA0
BAUD_RATE=9600
```

Start server:
```bash
npm start
```

**Kết quả mong đợi:**
```
============================================================
🚀 LoRa Gateway Server Started
============================================================
📍 Port: 3000
🌐 Dashboard: http://localhost:3000
...
============================================================

ℹ️  M0 and M1 hardwired to GND (NORMAL mode)
   No GPIO control needed

🔌 Serial Port: /dev/ttyAMA0 @ 9600 baud
📡 Packet framing: < > markers enabled
⏳ Waiting for sensor data...

📥 <{"id":"KHO_A","temp1":25.5,"hum1":65.0,...}>
📊 KHO_A | S1: 25.5°C 65.0% | S2: 26.0°C 66.0% | ...
```

---

## 🔧 Arduino Node Configuration

Đảm bảo Arduino nodes cũng dùng cấu hình tương thích:

File `arduino/lora_sensor_node_AS32/lora_sensor_node_AS32.ino`:

```cpp
// AS32-TTL-100 connections
// TXD (D2) → AS32 RXD
// RXD (D3) → AS32 TXD
// M0 → GND (hardwired - NORMAL mode)
// M1 → GND (hardwired - NORMAL mode)

// Module mặc định:
// - Address: 0x0000 (broadcast)
// - Channel: 23 (433MHz)
// - Baud: 9600
// - Air rate: 2.4k
// - Power: 20dBm
```

**Quan trọng:** Arduino nodes cũng phải có **M0 → GND, M1 → GND** để ở NORMAL mode.

---

## 📊 Workflow hoàn chỉnh

```
Arduino Node (Sensor)
  ↓ DHT11 reading
  ↓ JSON: <{"id":"KHO_A",...}>
  ↓ SoftwareSerial (D2, D3) @ 9600
  ↓
AS32-TTL-100 (Node) - NORMAL mode (M0=GND, M1=GND)
  ↓ LoRa transmission (433MHz)
  ↓
AS32-TTL-100 (Gateway) - NORMAL mode (M0=GND, M1=GND)
  ↓ UART @ 9600
  ↓ /dev/ttyAMA0
  ↓
Node.js Server (Raspberry Pi)
  ↓ Parse JSON
  ↓ WebSocket broadcast
  ↓
Web Dashboard
  ↓ Display data
```

---

## ✅ Advantages của cách này

1. **Đơn giản hơn** - không cần GPIO control cho M0, M1
2. **Ổn định hơn** - module luôn ở NORMAL mode
3. **Không cần AT config** - dùng cấu hình mặc định
4. **Tương thích** - tất cả module AS32 mặc định đều giao tiếp được

---

## 🆘 Nếu vẫn không nhận được data

### 1. Kiểm tra Arduino đang gửi

Kết nối Arduino qua USB, mở Serial Monitor (9600 baud):
- Bạn phải thấy data được in ra: `<{"id":"KHO_A",...}>`

### 2. Kiểm tra AS32 gateway có nhận không

Chạy test Python ở Bước 3 phía trên.

### 3. Kiểm tra TX/RX đúng chưa

- Nếu đã đảo: AS32 TXD → GPIO 14, AS32 RXD → GPIO 15
- Nếu chưa đảo: AS32 TXD → GPIO 15, AS32 RXD → GPIO 14

Thử cả 2 cách!

### 4. Kiểm tra khoảng cách

- LoRa range: ~2km line-of-sight
- Indoor: ~200-500m
- Thử đặt Arduino node gần gateway (~1-5m) để test

---

## 📝 Summary

✅ **KHÔNG cần AT config**
✅ **M0 → GND, M1 → GND (cố định bằng dây)**
✅ **Baud rate: 9600**
✅ **Cấu hình mặc định nhà máy**
✅ **Gateway chỉ cần đọc /dev/ttyAMA0**

**Cập nhật:** 2025-01-15
