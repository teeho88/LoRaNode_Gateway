# LoRa Sensor Gateway

Hệ thống giám sát nhiệt độ, độ ẩm và điều khiển relay qua LoRa, gồm các node Arduino Nano dùng module **AS32-TTL-100 UART** và gateway Node.js chạy tốt trên Raspberry Pi 4 hoặc Windows khi thử nghiệm.

Dashboard hiện tại dùng giao diện dạng tab, WebSocket thời gian thực, cấu hình node/gateway từ UI, cơ chế rollback an toàn khi đổi profile LoRa, phân tích xu hướng, dự báo và chấm điểm sức khỏe node.

## Tính Năng Chính

- Giám sát nhiều node theo thời gian thực qua Socket.IO.
- Mỗi node có UID lưu trong EEPROM để gateway phân biệt dù ID mặc định bị trùng sau lần nạp code đầu.
- Điều khiển relay từ dashboard: bật, tắt, auto.
- Đọc 2 cảm biến DHT11 trên mỗi node, tính trung bình để điều khiển relay.
- Cấu hình ID node, địa chỉ module và profile LoRa ngay trên tab Cấu hình.
- Profile mạng LoRa dùng chung: Gateway Address, Network ID, Channel, Baud code, Air rate, Power.
- Quy trình cấu hình an toàn: stage -> xác nhận gateway sync -> activate -> commit hoặc rollback.
- Node tự rollback về cấu hình cũ nếu activate LoRa nhưng không nhận commit trong 60 giây.
- Tab Phân tích: dự báo nhiệt độ/độ ẩm, xu hướng tăng/giảm, phát hiện bất thường, health score và khuyến nghị kiểm tra.
- Lưu thống kê ngày ra JSON để giảm ghi SD card trên Raspberry Pi.

## Cấu Trúc Dự Án

```text
.
|-- arduino/
|   |-- lora_sensor_node_AS32/
|   |   `-- lora_sensor_node_AS32.ino
|-- public/
|   |-- index.html
|   |-- app.js
|   `-- style.css
|-- src/
|   `-- server.js
|-- data/
|-- .env.example
`-- package.json
```

README này là file tài liệu duy nhất của dự án, dùng cho phát triển, vận hành và cho agent đọc ngữ cảnh. Không tạo thêm file `.md` khác trong repo; mọi cập nhật tài liệu đều gộp vào đây.

## Phần Cứng

### Node Arduino

- Arduino Nano.
- Module LoRa AS32-TTL-100, giao tiếp UART.
- 2 cảm biến DHT11.
- Relay 1 kênh cho quạt hoặc thiết bị điều khiển.
- Nguồn 5V đủ dòng cho Arduino, relay và module LoRa.

### Gateway

- Raspberry Pi 4 hoặc máy Windows để thử nghiệm.
- Module AS32-TTL-100 nối trực tiếp UART/GPIO hoặc qua USB-Serial.
- Nếu dùng Raspberry Pi GPIO UART, bật UART trên Raspberry Pi, nối TX/RX đúng chiều, dùng chung GND, rồi đặt `SERIAL_PORT=/dev/ttyAMA0` hoặc `/dev/serial0` trong `.env`.

## Sơ Đồ Nối Dây

### Arduino Nano + AS32-TTL-100

```text
AS32-TTL-100     Arduino Nano
TX               D2  (SoftwareSerial RX)
RX               D3  (SoftwareSerial TX)
AUX              D5  (tùy chọn)
VCC              5V
GND              GND
```

Chế độ đơn giản, luôn chạy normal:

```text
M0               GND
M1               GND
```

Nếu muốn node tự đổi cấu hình LoRa từ lệnh gateway/UI:

```text
M0               D8
M1               D9
```

Sau đó sửa trong `arduino/lora_sensor_node_AS32/lora_sensor_node_AS32.ino`:

```cpp
#define LORA_M0_PIN 8
#define LORA_M1_PIN 9
```

### DHT11 và Relay

```text
DHT11 #1 DATA    D4
DHT11 #2 DATA    D6
Relay IN         D7
VCC              5V
GND              GND
```

### Raspberry Pi + AS32-TTL-100

Kết nối UART cơ bản:

```text
AS32-TTL-100     Raspberry Pi
TX               GPIO15 / RXD
RX               GPIO14 / TXD
VCC              5V hoặc nguồn riêng phù hợp module
GND              GND chung
```

Khuyến nghị ổn định nhất:

```text
M0               GND
M1               GND
```

Nếu gateway cần điều khiển mode bằng GPIO:

```text
M0               GPIO23
M1               GPIO24
AUX              GPIO18
```

Trong `.env`, bật:

```env
USE_GPIO_LORA_MODE=true
SERIAL_PORT=/dev/ttyAMA0
```

## Cài Đặt Gateway

```bash
npm install
cp .env.example .env
npm start
```

Trên Windows, tạo `.env` và đặt đúng COM port:

```env
PORT=3000
SERIAL_PORT=COM3
BAUD_RATE=9600
```

Trên Raspberry Pi:

```env
PORT=3000
SERIAL_PORT=/dev/ttyAMA0
BAUD_RATE=9600
USE_GPIO_LORA_MODE=false
MAX_HISTORY=500
```

Nếu port `3000` đang bận:

```powershell
netstat -ano -p tcp | findstr :3000
Stop-Process -Id <PID> -Force
```

Hoặc chạy cổng khác:

```powershell
$env:PORT='3001'
npm start
```

## Cấu Hình `.env`

```env
PORT=3000
SERIAL_PORT=/dev/ttyAMA0
BAUD_RATE=9600
USE_GPIO_LORA_MODE=false
MAX_HISTORY=500
BACKUP_INTERVAL=3600000

ANALYTICS_WINDOW_MINUTES=120
ANALYTICS_FORECAST_MINUTES=30
ANALYTICS_TEMP_HIGH=32
ANALYTICS_HUM_HIGH=75
ANALYTICS_ANOMALY_ZSCORE=2.5
NODE_OFFLINE_SECONDS=150
```

## Upload Firmware Node

1. Mở `arduino/lora_sensor_node_AS32/lora_sensor_node_AS32.ino`.
2. Chọn board Arduino Nano.
3. Cài thư viện Arduino:
   - DHT sensor library by Adafruit.
   - ArduinoJson by Benoit Blanchon.
   - SoftwareSerial có sẵn trong Arduino.
4. Upload firmware.
5. Mở Serial Monitor 9600 baud để kiểm tra Node ID và Node UID.

Firmware gửi dữ liệu theo dạng JSON được bọc bởi marker `<...>`:

```json
{
  "id": "KHO_B",
  "uid": "A1B2C3D4",
  "temp1": 30.2,
  "hum1": 72.5,
  "temp2": 29.8,
  "hum2": 70.1,
  "temp": 30.0,
  "hum": 71.3,
  "relay": false,
  "manual": false
}
```

`temp`/`hum` là trung bình của 2 cảm biến, dùng để điều khiển relay và hiển thị chính trên dashboard. Bản tin xác nhận lệnh (ACK) có thêm `"ack": true` và không chứa dữ liệu cảm biến.

## Cấu Hình Module AS32-TTL-100 Bằng AT Commands

Chỉ cần khi cấu hình thủ công qua Serial Monitor (không qua UI gateway).

1. Nối M0 và M1 về VCC (5V) để vào chế độ Cấu hình (Sleep/Config Mode).
2. Mở Serial Monitor ở baud 9600.
3. Gửi các lệnh AT:

```text
AT+ADDRESS=0001      // Địa chỉ module (0x0001)
AT+NETWORKID=00      // Network ID (0x00)
AT+PARAMETER=9,5,0   // Baud 9600, Air Rate 2.4k, Power 20dBm
AT+CHANNEL=23        // Kênh 23 = 433MHz
AT+SAVE              // Lưu cấu hình
```

4. Nối lại M0 và M1 về GND để trở về Normal Mode.

Bảng chế độ hoạt động (M0, M1):

| M0 | M1 | Chế độ | Mô tả |
|----|----|--------|-------|
| 0  | 0  | Normal Mode | Truyền/nhận dữ liệu bình thường |
| 0  | 1  | Wake-up Mode | Tiết kiệm pin |
| 1  | 0  | Power Saving | Tiết kiệm pin sâu |
| 1  | 1  | Sleep/Config Mode | Cấu hình module bằng AT commands |

Ý nghĩa `AT+PARAMETER=baud,airrate,power`:

- Baud: `0`=1200bps, `9`=9600bps, `19`=19200bps (khuyên dùng `9`).
- Air Rate: `0`=0.3kbps (xa nhất), `5`=2.4kbps (cân bằng, khuyên dùng), `10`=19.2kbps (nhanh, gần).
- Power: `0`=20dBm/100mW (max, khuyên dùng cho tầm xa), `1`=17dBm, `2`=14dBm, `3`=10dBm (min).

`AT+CHANNEL`: kênh 0-80, công thức `Frequency = 410.125 + CH x 0.5 MHz`. Channel 23 = 433MHz, khuyên dùng ở Việt Nam.

Thông số phần cứng module: tần số 410-525MHz, công suất tối đa 100mW (20dBm), dòng tiêu thụ ~120mA khi phát và ~15mA khi nhận, điện áp 5V (hoặc 3.3V tùy phiên bản).

### Xử Lý Lỗi Thường Gặp

- Không nhận được dữ liệu: kiểm tra TX/RX có bị nối ngược không, M0/M1 phải ở GND (Normal mode), Channel và NetworkID phải giống nhau giữa gateway và node.
- Module không phản hồi AT commands: M0/M1 phải ở VCC (Config mode), kiểm tra baud rate 9600, thử ngắt nguồn cấp lại module.
- Tầm xa không đủ: tăng power (`AT+PARAMETER=9,5,0`), giảm air rate (`AT+PARAMETER=9,0,0`), kiểm tra anten 433MHz và vị trí đặt module tránh vật cản kim loại.

## Dashboard

Mở trình duyệt:

```text
http://localhost:3000
```

Các tab hiện có:

- Giám sát: xem node online/offline, nhiệt độ, độ ẩm, relay, UID và điều khiển relay.
- Cấu hình: đổi ID node, địa chỉ module, profile LoRa dùng chung, xác nhận gateway sync, activate, commit, rollback.
- Thống kê: max/min nhiệt độ và độ ẩm trong ngày.
- Phân tích: forecast, xu hướng, anomaly, health score, nhịp gói tin, khuyến nghị kiểm tra.
- Biểu đồ: xem lịch sử theo node, ngày và khoảng giờ.
- Nhật ký: log sự kiện gateway và lệnh điều khiển.

## Quy Trình Đổi Cấu Hình LoRa An Toàn

Các thông số mạng như Network ID, Channel, Baud code, Air rate và Power phải đồng nhất giữa gateway và tất cả node cần liên lạc.

Quy trình khuyến nghị:

1. Vào tab Cấu hình, chọn node.
2. Nhập ID mới hoặc Node Address nếu cần.
3. Nhập profile mạng LoRa dùng chung.
4. Bấm Gửi cấu hình để stage cấu hình trên node.
5. Cấu hình module LoRa phía gateway sang đúng profile mới.
6. Bấm Tôi đã cấu hình gateway để xác nhận gateway sync.
7. Bấm Kích hoạt LoRa.
8. Nếu node vẫn xuất hiện và ACK ổn, bấm Commit.
9. Nếu có lỗi, bấm Rollback hoặc chờ node tự rollback sau 60 giây.

Gateway cũng chặn activate nếu profile gateway chưa được xác nhận sync, giúp giảm nguy cơ node đổi sóng trước rồi mất liên lạc.

## API

### Node và lịch sử

```http
GET /api/nodes
GET /api/nodes/:id
GET /api/history?nodeId=<id|uid|nodeKey>&limit=100
GET /api/history?nodeId=<id|uid|nodeKey>&date=2026-06-02&startTime=08:00:00&endTime=18:00:00
```

### Điều khiển relay

```http
POST /api/control/relay
Content-Type: application/json

{
  "target": "KHO_B",
  "targetUid": "A1B2C3D4",
  "relay": true
}
```

Chuyển về auto:

```json
{
  "target": "KHO_B",
  "targetUid": "A1B2C3D4",
  "auto": true
}
```

### Cấu hình gateway và node

```http
GET  /api/config/network
POST /api/config/network
GET  /api/config/gateway/sync
POST /api/config/gateway/confirm
GET  /api/config/nodes
POST /api/config/node
POST /api/config/node/activate
POST /api/config/node/commit
POST /api/config/node/rollback
```

Ví dụ cấu hình node:

```json
{
  "target": "KHO_B",
  "targetUid": "A1B2C3D4",
  "nodeId": "KHO_A",
  "address": 1
}
```

### Phân tích và sức khỏe node

```http
GET /api/analytics/overview?windowMinutes=120&forecastMinutes=30
GET /api/analytics/alerts?windowMinutes=120&forecastMinutes=30
GET /api/analytics/health?windowMinutes=120&forecastMinutes=30
```

`/api/analytics/health` trả về:

- `healthScore`: điểm sức khỏe 0-100.
- `healthLevel`: `good`, `warning`, `critical`.
- `online`: node còn gửi dữ liệu trong ngưỡng `NODE_OFFLINE_SECONDS`.
- `expectedInterval`: nhịp gói tin gần đây.
- `recommendations`: khuyến nghị kiểm tra nguồn, anten, cảm biến hoặc chế độ relay.

### Thống kê và trạng thái

```http
GET /api/daily-stats
GET /api/daily-stats/:nodeId
GET /api/status
GET /health
```

## WebSocket Events

Client gửi:

```javascript
socket.emit('controlRelay', { target: 'KHO_B', targetUid: 'A1B2C3D4', relay: true });
socket.emit('configureNode', { target: 'KHO_B', targetUid: 'A1B2C3D4', nodeId: 'KHO_A', address: 1 });
socket.emit('saveLoraNetwork', { networkId: 0, channel: 23, baudCode: 9, airRate: 5, power: 0 });
socket.emit('activateNodeConfig', { target: 'KHO_A', targetUid: 'A1B2C3D4' });
socket.emit('commitNodeConfig', { target: 'KHO_A', targetUid: 'A1B2C3D4' });
socket.emit('rollbackNodeConfig', { target: 'KHO_A', targetUid: 'A1B2C3D4' });
```

Server gửi:

```javascript
socket.on('initialData', handler);
socket.on('sensorData', handler);
socket.on('commandAck', handler);
socket.on('commandSent', handler);
socket.on('commandError', handler);
socket.on('configAck', handler);
socket.on('configSent', handler);
socket.on('configError', handler);
socket.on('configActionSent', handler);
socket.on('loraNetworkUpdated', handler);
socket.on('gatewaySyncUpdated', handler);
```

## Dữ Liệu Lưu Trữ

Trong thư mục `data/`:

- `daily-stats.json`: thống kê ngày.
- `node-configs.json`: cấu hình node đã stage/lưu.
- `lora-network.json`: profile LoRa dùng chung.
- `gateway-lora-sync.json`: trạng thái gateway đã đồng bộ profile hay chưa.

Dữ liệu lịch sử gần được giữ trong RAM theo `MAX_HISTORY` để giảm ghi thẻ SD.

## Ghi Chú Kỹ Thuật Server

- Gateway ghép dữ liệu UART thành JSON hoàn chỉnh bằng buffer thủ công (`serialBuffer`) dựa trên marker `<` và `>`; nếu sửa firmware, phải giữ nguyên cách đóng gói này. Có fallback parse JSON thô cho dữ liệu không có marker.
- Nếu không mở được cổng serial (không có module LoRa thật hoặc sai `SERIAL_PORT`), server vẫn chạy ở chế độ demo (không crash, không có dữ liệu thật) thay vì thoát tiến trình.
- Module `onoff` (điều khiển GPIO) tự động bị vô hiệu hóa khi chạy ngoài Linux/Raspberry Pi (ví dụ Windows/Mac khi phát triển).
- `daily-stats.json` được ghi mỗi `BACKUP_INTERVAL` và khi tắt server; bản ghi cũ hơn 30 ngày bị dọn tự động để bảo vệ thẻ SD.

## Lưu Ý Vận Hành

- Network ID, Channel, Baud code, Air rate và Power phải giống nhau giữa gateway và node.
- Address nên khác nhau cho từng module; gateway thường dùng `0`, node dùng `1`, `2`, ...
- Khi nhiều node mới nạp firmware có cùng ID mặc định, dashboard vẫn hiển thị nhờ UID. Sau đó đổi ID từng node trong tab Cấu hình.
- Nếu dùng M0/M1 nối GND cố định, module luôn normal mode và không thể tự đổi AT config bằng firmware.
- Với Raspberry Pi, cần bật UART và cấp quyền serial cho user chạy service.
- Nếu deploy production, nên chạy qua systemd và thêm xác thực nếu dashboard mở ra mạng rộng.

## Kiểm Tra Nhanh

```bash
npm start
```

Sau đó thử:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/status
curl http://localhost:3000/api/analytics/health
```

### Kiểm Tra UI Tự Động

`scripts/check-ui.js` dùng Playwright để tự khởi động gateway (chế độ demo, không cần phần cứng LoRa), mở dashboard bằng Chromium thật và kiểm tra: trang tải đúng, đủ 6 tab và chuyển tab đúng panel, Socket.IO kết nối thành công, `#nodes-container` thoát trạng thái loading, `/health` trả 200, và không có lỗi console JS.

```bash
npx playwright install chromium   # chỉ cần chạy 1 lần
npm run check:ui
```

Script tự chọn cổng `3999` (đổi bằng biến môi trường `CHECK_UI_PORT`), tự tắt server sau khi kiểm tra xong, và trả exit code khác 0 nếu có kiểm tra thất bại.

## License

ISC
