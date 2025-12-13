# LoRa Sensor Gateway System

Hệ thống giám sát cảm biến và điều khiển từ xa sử dụng giao thức LoRa, gồm node cảm biến (Arduino Nano) và gateway (Node.js server chạy trên Raspberry Pi 4).

## Tính năng

### Node Cảm biến (Arduino)
- Đọc nhiệt độ và độ ẩm từ cảm biến DHT11
- Gửi dữ liệu về gateway qua LoRa (SX1278)
- Tự động bật/tắt relay quạt khi vượt ngưỡng
- Nhận lệnh điều khiển relay từ gateway
- Chế độ điều khiển: Auto/Manual

### Gateway (Node.js trên Raspberry Pi 4)
- Nhận dữ liệu từ các node qua serial port
- Lưu trữ dữ liệu và lịch sử (tối ưu cho RPi)
- **Web Dashboard** thời gian thực với WebSocket
- REST API để truy vấn và điều khiển
- Gửi lệnh điều khiển đến các node
- Hỗ trợ nhiều node đồng thời (20-30 nodes trên RPi 2GB)

## Yêu cầu phần cứng

### Node Cảm biến
- Arduino Nano
- Module LoRa SX1278 (433MHz)
- Cảm biến DHT11
- Module Relay 1 kênh
- Nguồn 5V

### Gateway
- **Raspberry Pi 4** (khuyến nghị 2GB RAM trở lên)
- Module LoRa SX1278 kết nối qua USB-Serial
- Thẻ nhớ microSD 16GB+
- Nguồn 5V/3A
- (Tùy chọn) Arduino làm bridge giữa LoRa và Raspberry Pi

## Kết nối phần cứng

### Arduino Nano + LoRa SX1278
```
LoRa SX1278:
  NSS   -> D10
  MOSI  -> D11
  MISO  -> D12
  SCK   -> D13
  RST   -> D9
  DIO0  -> D2

DHT11:
  DATA  -> D4
  VCC   -> 5V
  GND   -> GND

Relay:
  IN    -> D7
  VCC   -> 5V
  GND   -> GND
```

## Cài đặt

### 1. Arduino (Node cảm biến)

#### Cài đặt thư viện Arduino:
- LoRa by Sandeep Mistry
- DHT sensor library by Adafruit
- ArduinoJson by Benoit Blanchon

Từ Arduino IDE:
1. Mở `Sketch > Include Library > Manage Libraries`
2. Tìm và cài đặt các thư viện trên
3. Mở file `arduino/lora_sensor_node.ino`
4. Chỉnh sửa cấu hình (NODE_ID, ngưỡng, tần số LoRa)
5. Upload lên Arduino Nano

### 2. Gateway (Node.js trên Raspberry Pi)

#### Test trên Windows trước (Khuyến nghị)

**Nên test đầy đủ trên Windows trước khi deploy lên Raspberry Pi!**

Xem hướng dẫn chi tiết: **[windows-setup.md](windows-setup.md)**

Tóm tắt nhanh:
```cmd
# 1. Cài Node.js từ https://nodejs.org/
# 2. Clone project và cài dependencies
npm install

# 3. Tạo file .env
copy .env.example .env
notepad .env
# Sửa SERIAL_PORT=COM3 (thay bằng COM port thực tế)

# 4. Upload Arduino code qua Arduino IDE
# 5. Chạy server
npm start

# 6. Truy cập http://localhost:3000
```

#### Cài đặt nhanh (Development/Testing trên Linux/RPi)
```bash
# Cài đặt dependencies
npm install

# Sao chép file cấu hình
cp .env.example .env

# Chỉnh sửa .env để cấu hình cổng serial
nano .env
# Raspberry Pi: /dev/ttyUSB0 hoặc /dev/ttyAMA0
# Windows (test): COM3, COM4

# Cấp quyền serial port (Raspberry Pi/Linux)
sudo usermod -a -G dialout $USER
# Logout và login lại

# Chạy server
npm start
```

#### Cài đặt Production trên Raspberry Pi 4

Xem hướng dẫn chi tiết: **[raspberry-pi-setup.md](raspberry-pi-setup.md)**

Tóm tắt:
```bash
# 1. Cài đặt Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 2. Clone và cài đặt
git clone <repo-url> lora-gateway
cd lora-gateway
npm install

# 3. Cấu hình
cp .env.example .env
nano .env

# 4. Tạo systemd service (tự động chạy khi khởi động)
sudo nano /etc/systemd/system/lora-gateway.service
sudo systemctl enable lora-gateway
sudo systemctl start lora-gateway

# 5. Kiểm tra trạng thái
sudo systemctl status lora-gateway
```

## Sử dụng

### Web Dashboard

Sau khi khởi động gateway, truy cập dashboard qua trình duyệt:

```
http://<raspberry-pi-ip>:3000
```

**Tính năng Dashboard:**
- 📊 Hiển thị real-time nhiệt độ, độ ẩm từ tất cả nodes
- 🎛️ Điều khiển relay (BẬT/TẮT/AUTO) trực tiếp trên giao diện
- 📈 Biểu đồ lịch sử nhiệt độ & độ ẩm
- 📅 **Thống kê hàng ngày**: nhiệt độ/độ ẩm cao nhất, thấp nhất trong ngày
- 🔍 **Lọc dữ liệu theo ngày và giờ**: chọn khoảng thời gian để xem dữ liệu
- 🔔 Nhật ký hệ thống real-time
- 📱 Responsive - hỗ trợ mobile

**Demo:**
![Dashboard Preview](docs/dashboard-preview.png)

### API Endpoints

#### Lấy dữ liệu tất cả các node
```bash
GET http://localhost:3000/api/nodes
```

#### Lấy dữ liệu node cụ thể
```bash
GET http://localhost:3000/api/nodes/KHO_A
```

#### Lấy lịch sử dữ liệu
```bash
# Lấy 100 bản ghi gần nhất
GET http://localhost:3000/api/history?nodeId=KHO_A&limit=100

# Lọc theo ngày
GET http://localhost:3000/api/history?nodeId=KHO_A&date=2025-12-09

# Lọc theo ngày và khoảng thời gian
GET http://localhost:3000/api/history?nodeId=KHO_A&date=2025-12-09&startTime=08:00:00&endTime=18:00:00
```

#### Lấy thống kê hàng ngày
```bash
# Thống kê hôm nay của tất cả nodes
GET http://localhost:3000/api/daily-stats

# Tất cả thống kê của một node
GET http://localhost:3000/api/daily-stats/KHO_A

# Thống kê ngày cụ thể
GET http://localhost:3000/api/daily-stats/KHO_A?date=2025-12-09
```

Dữ liệu trả về bao gồm:
- `tempMax`, `tempMin`: Nhiệt độ cao nhất/thấp nhất (°C)
- `humMax`, `humMin`: Độ ẩm cao nhất/thấp nhất (%)
- `tempMaxTime`, `tempMinTime`: Thời gian ghi nhận nhiệt độ max/min
- `humMaxTime`, `humMinTime`: Thời gian ghi nhận độ ẩm max/min
- `count`: Tổng số lần đo trong ngày

#### Điều khiển relay
```bash
POST http://localhost:3000/api/control/relay
Content-Type: application/json

{
  "target": "KHO_A",
  "relay": true
}
```

#### Chuyển về chế độ tự động
```bash
POST http://localhost:3000/api/control/relay
Content-Type: application/json

{
  "target": "KHO_A",
  "auto": true
}
```

#### Kiểm tra trạng thái hệ thống
```bash
GET http://localhost:3000/api/status
```

### Ví dụ curl

```bash
# Bật relay của node KHO_A
curl -X POST http://localhost:3000/api/control/relay \
  -H "Content-Type: application/json" \
  -d '{"target": "KHO_A", "relay": true}'

# Tắt relay
curl -X POST http://localhost:3000/api/control/relay \
  -H "Content-Type: application/json" \
  -d '{"target": "KHO_A", "relay": false}'

# Chuyển về chế độ tự động
curl -X POST http://localhost:3000/api/control/relay \
  -H "Content-Type: application/json" \
  -d '{"target": "KHO_A", "auto": true}'

# Điều khiển tất cả các node
curl -X POST http://localhost:3000/api/control/relay \
  -H "Content-Type: application/json" \
  -d '{"target": "ALL", "relay": true}'
```

## Cấu trúc dữ liệu

### Dữ liệu từ Node đến Gateway
```json
{
  "id": "KHO_A",
  "temp": 32.5,
  "hum": 70.0,
  "relay": true,
  "manual": false
}
```

### Lệnh từ Gateway đến Node
```json
{
  "target": "KHO_A",
  "relay": true,
  "auto": false
}
```

### Acknowledgment từ Node
```json
{
  "id": "KHO_A",
  "ack": true,
  "relay": true
}
```

## Cấu hình

### Ngưỡng cảm biến (trong Arduino code)
```cpp
#define TEMP_HIGH_THRESHOLD 32.0   // Nhiệt độ cao (°C)
#define TEMP_LOW_THRESHOLD 15.0    // Nhiệt độ thấp (°C)
#define HUM_HIGH_THRESHOLD 75.0    // Độ ẩm cao (%)
#define HUM_LOW_THRESHOLD 30.0     // Độ ẩm thấp (%)
```

### Tần số LoRa
```cpp
#define LORA_FREQUENCY 433E6  // 433MHz
// Các tần số khác: 868E6 (868MHz), 915E6 (915MHz)
```

### Khoảng thời gian gửi dữ liệu
```cpp
#define SEND_INTERVAL 5000   // 5 giây
#define READ_INTERVAL 2000   // 2 giây
```

### Lưu trữ dữ liệu

Hệ thống sử dụng **hybrid storage** kết hợp in-memory và SD card:

- **In-memory**: Dữ liệu real-time (sensorData, dataHistory) cho hiệu suất cao
- **SD card**: Thống kê hàng ngày (dailyStats) cho độ bền
- **Backup tự động**: Mỗi giờ (cấu hình được) + khi tắt server
- **Lưu trữ**: 30 ngày dữ liệu thống kê (tự động xóa dữ liệu cũ)

File dữ liệu: `data/daily-stats.json`

Khi khởi động lại server, dữ liệu thống kê được khôi phục tự động.

**Cấu hình backup** (trong file `.env`):
```bash
BACKUP_INTERVAL=3600000  # 1 giờ (3600000ms)
```

## Hiệu suất

### Raspberry Pi 4 (2GB RAM)
- Xử lý đồng thời: **20-30 sensor nodes**
- Thời gian phản hồi: < 100ms
- RAM sử dụng: ~150-200MB
- CPU idle: ~5-10%

### Raspberry Pi 4 (4GB RAM)
- Xử lý đồng thời: **50+ sensor nodes**
- MAX_HISTORY có thể tăng lên 1000

## Khắc phục sự cố

### Node không gửi dữ liệu
- Kiểm tra kết nối LoRa module
- Kiểm tra tần số LoRa (433/868/915 MHz)
- Kiểm tra Serial Monitor của Arduino

### Gateway không nhận dữ liệu
- Kiểm tra cổng serial trong file `.env`
- Raspberry Pi: `ls -la /dev/ttyUSB* /dev/ttyAMA*`
- Windows: Device Manager > Ports (COM & LPT)
- Kiểm tra quyền truy cập serial port (Linux/RPi):
  ```bash
  sudo usermod -a -G dialout $USER
  # Logout và login lại
  ```

### Gateway không khởi động trên Raspberry Pi
```bash
# Kiểm tra logs
journalctl -u lora-gateway -n 50

# Kiểm tra port đã được sử dụng chưa
netstat -tlnp | grep 3000

# Test serial port
sudo apt install -y minicom
minicom -D /dev/ttyUSB0 -b 9600
```

### Dashboard không hiển thị dữ liệu
- Kiểm tra console của trình duyệt (F12)
- Kiểm tra WebSocket connection
- Xóa cache trình duyệt
- Kiểm tra firewall: `sudo ufw status`

### RAM đầy trên Raspberry Pi
```bash
# Kiểm tra RAM
free -h

# Giảm MAX_HISTORY trong .env
nano .env
# Đổi MAX_HISTORY=500 -> MAX_HISTORY=200

# Restart service
sudo systemctl restart lora-gateway
```

### Cảm biến DHT11 lỗi
- Kiểm tra kết nối 3 chân (VCC, GND, DATA)
- Thêm điện trở kéo lên 10kΩ giữa DATA và VCC nếu cần

## Tài liệu bổ sung

- **[windows-setup.md](windows-setup.md)** - 🪟 Hướng dẫn cài đặt và test trên Windows (khuyến nghị đọc trước)
- **[raspberry-pi-setup.md](raspberry-pi-setup.md)** - 🍓 Hướng dẫn chi tiết cài đặt trên Raspberry Pi (production)
- **[arduino/README.md](arduino/README.md)** - 🔌 Hướng dẫn Arduino chi tiết
- **[test-api.http](test-api.http)** - 🧪 Test API với REST Client

## License

ISC
