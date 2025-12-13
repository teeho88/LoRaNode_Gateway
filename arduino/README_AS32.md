# Arduino Code cho Module AS32-TTL-100

## Tổng quan

Code này được viết cho Arduino Nano với module LoRa **AS32-TTL-100** (giao tiếp UART), thay thế cho module SX1278 (giao tiếp SPI).

## Khác biệt giữa AS32-TTL-100 và SX1278

| Đặc điểm | SX1278 | AS32-TTL-100 |
|----------|--------|--------------|
| **Giao tiếp** | SPI (6 pins) | UART/Serial (2 pins) |
| **Thư viện** | LoRa by Sandeep Mistry | Không cần (dùng SoftwareSerial) |
| **Cấu hình** | Qua code | AT Commands hoặc qua code |
| **Pins** | NSS, MOSI, MISO, SCK, RST, DIO0 | TX, RX, M0, M1, AUX |
| **Độ phức tạp** | Cao hơn | Đơn giản hơn |
| **Tầm xa** | ~2km | ~3km (với 100mW) |

## Sơ đồ kết nối

### AS32-TTL-100 → Arduino Nano

```
AS32-TTL-100    Arduino Nano
─────────────────────────────
TX          →   D2 (Software Serial RX)
RX          →   D3 (Software Serial TX)
M0          →   GND (hoặc D6 nếu cần config)
M1          →   GND (hoặc D8 nếu cần config)
AUX         →   D5 (tùy chọn, kiểm tra trạng thái)
VCC         →   5V
GND         →   GND
```

### DHT11 và Relay

```
DHT11 Data  →   D4
Relay IN    →   D7
```

## Chế độ hoạt động của AS32-TTL-100

Module AS32-TTL-100 có 4 chế độ hoạt động được điều khiển bởi M0 và M1:

| M0 | M1 | Chế độ | Mô tả |
|----|-------|--------|-------|
| 0  | 0     | **Normal Mode** | Truyền/nhận dữ liệu bình thường |
| 0  | 1     | Wake-up Mode | Chế độ tiết kiệm pin |
| 1  | 0     | Power Saving | Chế độ tiết kiệm pin sâu |
| 1  | 1     | **Sleep/Config Mode** | Cấu hình module bằng AT commands |

### Chế độ Normal (M0=0, M1=0)
- Dùng cho hoạt động truyền/nhận dữ liệu
- Nối M0 và M1 về GND

### Chế độ Configuration (M0=1, M1=1)
- Dùng để cấu hình module bằng AT commands
- Nối M0 và M1 về VCC (5V) khi cần config
- Sau khi config xong, nối lại về GND

## Cấu hình Module AS32-TTL-100

### Cách 1: Cấu hình thủ công (khuyên dùng)

1. **Nối M0 và M1 về VCC (5V)** để vào chế độ cấu hình
2. Mở Serial Monitor (9600 baud)
3. Gửi các AT commands:

```
AT+ADDRESS=0001      // Địa chỉ module (0x0001)
AT+NETWORKID=00      // Network ID (0x00)
AT+PARAMETER=9,5,0   // Baud 9600, Air Rate 2.4k, Power 20dBm
AT+CHANNEL=23        // Kênh 23 = 433MHz
AT+SAVE              // Lưu cấu hình
```

4. **Nối M0 và M1 về GND** để trở về chế độ Normal

### Cách 2: Cấu hình qua code

Nếu bạn kết nối M0 và M1 vào Arduino (ví dụ: M0→D6, M1→D8), bạn có thể sử dụng hàm `configureLoRaModule()` trong code.

Uncomment dòng này trong `setup()`:
```cpp
// configureLoRaModule();
```

## Thông số kỹ thuật

- **Tần số**: 410-525MHz (mặc định 433MHz, Channel 23)
- **Công suất phát**: 100mW (20dBm) - max
- **Tốc độ baud**: 9600 bps (mặc định)
- **Air Data Rate**: 0.3~19.2 kbps (khuyên dùng 2.4k cho tầm xa)
- **Tầm xa**:
  - Line of sight: ~3000m (100mW)
  - Urban: ~800m - 1200m
- **Điện áp**: 5V (hoặc 3.3V tùy phiên bản)
- **Dòng tiêu thụ**:
  - Transmit: ~120mA
  - Receive: ~15mA
  - Sleep: <5uA

## Tham số cấu hình quan trọng

### AT+PARAMETER=baud,airrate,power

**Baud Rate** (9600 khuyên dùng):
- 0: 1200 bps
- 9: 9600 bps
- 19: 19200 bps

**Air Rate** (2.4k khuyên dùng cho tầm xa):
- 0: 0.3 kbps (xa nhất, chậm nhất)
- 5: 2.4 kbps (cân bằng)
- 10: 19.2 kbps (nhanh nhất, gần nhất)

**Power** (20dBm = 100mW cho tầm xa):
- 0: 20dBm (100mW) - Max power
- 1: 17dBm (50mW)
- 2: 14dBm (25mW)
- 3: 10dBm (10mW) - Min power

### AT+CHANNEL=XX

Kênh tần số (0-80):
- Channel 23 = 433MHz (khuyên dùng ở Việt Nam)
- Công thức: Frequency = 410.125 + CH × 0.5 MHz

## Upload Code

1. Mở file `lora_sensor_node_AS32.ino` trong Arduino IDE
2. Chọn board: **Arduino Nano**
3. Chọn Processor: **ATmega328P (Old Bootloader)** nếu dùng Nano clone
4. Chọn Port tương ứng
5. Upload code

## Thư viện cần thiết

- **SoftwareSerial** (built-in)
- **DHT sensor library** by Adafruit
- **ArduinoJson** by Benoit Blanchon

Cài đặt qua Library Manager (Sketch → Include Library → Manage Libraries)

## Kiểm tra hoạt động

1. Mở Serial Monitor (9600 baud)
2. Bạn sẽ thấy:
   ```
   LoRa Sensor Node (AS32-TTL-100) Initializing...
   LoRa Module Initialized!
   Node ID: KHO_A
   Ready to send data...
   Temperature: 25.5°C, Humidity: 65.0%
   Sent: {"id":"KHO_A","temp":25.5,"hum":65.0,"relay":false,"manual":false}
   ```

## Xử lý lỗi thường gặp

### 1. Không nhận được dữ liệu
- Kiểm tra kết nối TX/RX (có thể bị ngược)
- Kiểm tra M0, M1 phải ở GND (Normal mode)
- Kiểm tra cấu hình Channel và NetworkID trên cả 2 module phải giống nhau

### 2. Module không phản hồi AT commands
- Kiểm tra M0, M1 phải ở HIGH (Config mode)
- Kiểm tra baud rate (mặc định 9600)
- Thử reset module (ngắt nguồn rồi cấp lại)

### 3. Tầm xa không đủ
- Tăng công suất phát: `AT+PARAMETER=9,5,0` (20dBm)
- Giảm Air Rate: `AT+PARAMETER=9,0,0` (0.3kbps)
- Kiểm tra anten (phải 433MHz)
- Kiểm tra vị trí đặt module (tránh vật cản kim loại)

### 4. Dữ liệu bị mất
- Thêm checksums vào JSON
- Tăng delay giữa các gói tin
- Sử dụng START_MARKER và END_MARKER (đã có trong code)

## So sánh với code SX1278 cũ

| Tính năng | SX1278 | AS32-TTL-100 |
|-----------|--------|--------------|
| Thư viện | `#include <LoRa.h>` | `#include <SoftwareSerial.h>` |
| Khởi tạo | `LoRa.begin(433E6)` | `loraSerial.begin(9600)` |
| Gửi | `LoRa.beginPacket()` | `loraSerial.print()` |
| Nhận | `LoRa.parsePacket()` | `loraSerial.available()` |
| Cấu hình | Qua code | AT Commands |

## Lưu ý quan trọng

1. **SoftwareSerial giới hạn**: Không nên dùng baud rate cao hơn 9600 với SoftwareSerial
2. **Packet framing**: Code sử dụng `<` và `>` để đánh dấu đầu/cuối gói tin
3. **AUX pin**: Kiểm tra trạng thái module trước khi gửi (tránh mất dữ liệu)
4. **Power**: Module tiêu thụ ~120mA khi phát, đảm bảo nguồn đủ mạnh
5. **Cùng cấu hình**: Tất cả các node và gateway phải có cùng Channel, NetworkID, và Address

## Cấu hình cho nhiều node

### Node 1 (KHO_A):
```cpp
#define NODE_ID "KHO_A"
```
AT Commands:
```
AT+ADDRESS=0001
AT+NETWORKID=00
```

### Node 2 (KHO_B):
```cpp
#define NODE_ID "KHO_B"
```
AT Commands:
```
AT+ADDRESS=0002
AT+NETWORKID=00
```

**Lưu ý**: Gateway nên dùng Address=0x0000 và NetworkID=0x00 để nhận tất cả các node trong cùng mạng.

## Tài liệu tham khảo

- [AS32-TTL-100 Datasheet](https://www.aliexpress.com/item/32823513039.html)
- [AT Commands Manual](https://github.com/CongducPham/LowCostLoRaGw)
- DHT11 Sensor: https://www.adafruit.com/product/386

## Hỗ trợ

Nếu gặp vấn đề, kiểm tra:
1. Serial Monitor có log gì không
2. Module có LED chớp khi truyền không
3. Điện áp nguồn có đủ 5V không
4. Cấu hình M0, M1 đúng chưa
5. AT commands có phản hồi không (ở Config mode)
