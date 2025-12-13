# Windows Setup Guide - Testing & Development

Hướng dẫn cài đặt và test hệ thống LoRa Gateway trên Windows trước khi deploy lên Raspberry Pi.

## Yêu cầu hệ thống

- **Windows 10/11** (64-bit)
- **Node.js 18.x** hoặc cao hơn
- **Arduino IDE** (để upload code lên Arduino)
- **USB-to-Serial driver** (thường tự động cài khi cắm Arduino)
- Trình duyệt web hiện đại (Chrome, Firefox, Edge)

## Bước 1: Cài đặt Node.js

### Tải và cài đặt Node.js

1. Truy cập https://nodejs.org/
2. Tải phiên bản **LTS** (Long Term Support) - khuyến nghị 18.x hoặc 20.x
3. Chạy file installer, chọn tùy chọn mặc định
4. Kiểm tra cài đặt thành công:

```cmd
node --version
npm --version
```

Kết quả mong đợi:
```
v18.20.0
10.5.0
```

## Bước 2: Chuẩn bị Project

### Clone hoặc copy project

```cmd
cd D:\Projects
git clone <repo-url> lora-gateway
cd lora-gateway
```

Hoặc nếu đã có source code, copy vào thư mục mong muốn.

### Cài đặt dependencies

```cmd
npm install
```

Quá trình này sẽ cài đặt tất cả packages cần thiết (express, socket.io, serialport, etc.)

## Bước 3: Cấu hình Serial Port

### Xác định COM port của Arduino

1. Kết nối Arduino Nano qua USB
2. Mở **Device Manager** (Quản lý thiết bị):
   - Nhấn `Win + X` → chọn "Device Manager"
3. Mở mục **Ports (COM & LPT)**
4. Tìm "USB-SERIAL CH340" hoặc "Arduino Nano" → ghi nhớ số COM (VD: COM3, COM4)

![Device Manager Example](docs/device-manager.png)

### Cấu hình file .env

Tạo file `.env` từ template:

```cmd
copy .env.example .env
notepad .env
```

Chỉnh sửa nội dung (thay COM3 bằng COM port thực tế của bạn):

```env
# Server Configuration
PORT=3000

# Serial Port Configuration (Windows)
SERIAL_PORT=COM3
BAUD_RATE=9600

# Memory optimization
MAX_HISTORY=500

# Backup configuration (1 hour = 3600000ms)
BACKUP_INTERVAL=3600000
```

**Lưu ý**: Windows sử dụng `COM3`, `COM4`, v.v. thay vì `/dev/ttyUSB0` như Linux.

## Bước 4: Upload Code lên Arduino

### Cài đặt Arduino IDE

1. Tải Arduino IDE từ https://www.arduino.cc/en/software
2. Cài đặt với tùy chọn mặc định

### Cài đặt thư viện cần thiết

Từ Arduino IDE:

1. Mở **Tools > Manage Libraries** (Ctrl+Shift+I)
2. Tìm và cài đặt các thư viện:
   - **LoRa** by Sandeep Mistry
   - **DHT sensor library** by Adafruit
   - **Adafruit Unified Sensor** (dependency của DHT)
   - **ArduinoJson** by Benoit Blanchon (version 6.x)

### Upload Arduino code

1. Mở file `arduino/lora_sensor_node.ino`
2. Chỉnh sửa cấu hình nếu cần:
   ```cpp
   #define NODE_ID "KHO_A"  // Thay đổi ID nếu muốn
   #define TEMP_HIGH_THRESHOLD 32.0
   #define HUM_HIGH_THRESHOLD 75.0
   ```
3. Chọn board: **Tools > Board > Arduino AVR Boards > Arduino Nano**
4. Chọn processor: **Tools > Processor > ATmega328P (Old Bootloader)**
5. Chọn port: **Tools > Port > COM3** (port bạn đã xác định ở Bước 3)
6. Click nút **Upload** (→) hoặc nhấn Ctrl+U
7. Đợi upload hoàn tất (hiển thị "Done uploading")

### Kiểm tra Arduino hoạt động

Mở **Serial Monitor** (Ctrl+Shift+M):
- Đặt baud rate: **9600**
- Bạn sẽ thấy Arduino gửi dữ liệu JSON:

```json
{"id":"KHO_A","temp":28.5,"hum":65.0,"relay":false,"manual":false}
```

Nếu thấy dữ liệu như trên → Arduino hoạt động tốt!

## Bước 5: Chạy Gateway Server

### Khởi động server

```cmd
npm start
```

Hoặc dùng nodemon để tự động reload khi sửa code:

```cmd
npm run dev
```

### Kiểm tra server khởi động thành công

Bạn sẽ thấy log như sau:

```
Created data directory: D:\Projects\lora-gateway\data
LoRa Gateway Server running on port 3000
Web Dashboard: http://localhost:3000
API endpoints:
  GET  /api/nodes           - Get all nodes
  GET  /api/nodes/:id       - Get specific node
  GET  /api/history         - Get data history
  POST /api/control/relay   - Control relay
  GET  /api/status          - Get system status
[Recovery] No previous daily stats found, starting fresh
Serial port COM3 opened at 9600 baud
[Backup] Automatic backup every 60 minutes
```

## Bước 6: Truy cập Web Dashboard

1. Mở trình duyệt
2. Truy cập: **http://localhost:3000**

Bạn sẽ thấy dashboard với:
- **Sensor Nodes**: Hiển thị dữ liệu real-time từ Arduino
- **Thống kê hôm nay**: Nhiệt độ/độ ẩm cao nhất, thấp nhất
- **Lịch sử nhiệt độ & độ ẩm**: Biểu đồ real-time
- **Nhật ký hệ thống**: Log các sự kiện

### Test các chức năng

#### 1. Xem dữ liệu real-time
- Dashboard sẽ tự động cập nhật mỗi 5 giây khi Arduino gửi dữ liệu
- Kiểm tra nhiệt độ, độ ẩm hiển thị đúng

#### 2. Điều khiển relay
- Click nút **BẬT** → relay bật, quạt chạy
- Click nút **TẮT** → relay tắt, quạt dừng
- Click nút **AUTO** → chuyển về chế độ tự động

#### 3. Xem thống kê hàng ngày
- Section "Thống kê hôm nay" hiển thị:
  - Nhiệt độ cao nhất/thấp nhất
  - Độ ẩm cao nhất/thấp nhất
  - Thời gian ghi nhận

#### 4. Lọc dữ liệu theo thời gian
- Chọn ngày trong date picker
- Chọn khoảng thời gian (start time - end time)
- Click **Lọc** → biểu đồ cập nhật
- Click **Xóa lọc** → về dữ liệu mặc định

## Bước 7: Test API Endpoints

### Sử dụng REST Client (VS Code)

Nếu bạn dùng VS Code, cài extension **REST Client**:

1. Mở file `test-api.http`
2. Click vào dòng "Send Request" phía trên mỗi endpoint
3. Xem kết quả trả về

### Sử dụng curl (Command Prompt)

```cmd
# Lấy tất cả nodes
curl http://localhost:3000/api/nodes

# Lấy node cụ thể
curl http://localhost:3000/api/nodes/KHO_A

# Lấy lịch sử
curl http://localhost:3000/api/history?nodeId=KHO_A&limit=50

# Lấy thống kê hàng ngày
curl http://localhost:3000/api/daily-stats

# Điều khiển relay (bật)
curl -X POST http://localhost:3000/api/control/relay ^
  -H "Content-Type: application/json" ^
  -d "{\"target\":\"KHO_A\",\"relay\":true}"

# Điều khiển relay (tắt)
curl -X POST http://localhost:3000/api/control/relay ^
  -H "Content-Type: application/json" ^
  -d "{\"target\":\"KHO_A\",\"relay\":false}"

# Chuyển về chế độ tự động
curl -X POST http://localhost:3000/api/control/relay ^
  -H "Content-Type: application/json" ^
  -d "{\"target\":\"KHO_A\",\"auto\":true}"
```

**Lưu ý**: Trên Windows CMD, dùng `^` để xuống dòng. Nếu dùng PowerShell, dùng ``` ` ``` thay vì `^`.

### Sử dụng Postman

1. Tải Postman từ https://www.postman.com/downloads/
2. Import collection từ file `test-api.http` (hoặc tạo request thủ công)
3. Test các endpoints

## Bước 8: Kiểm tra Persistent Storage

### Test backup tự động

1. Để server chạy ít nhất 1 giờ (hoặc thay `BACKUP_INTERVAL=60000` trong .env để test nhanh hơn - 1 phút)
2. Kiểm tra file backup được tạo:
   ```cmd
   dir data\daily-stats.json
   ```
3. Xem nội dung file:
   ```cmd
   type data\daily-stats.json
   ```

### Test recovery sau khi restart

1. Dừng server: Nhấn `Ctrl + C`
2. Kiểm tra log "Saving daily stats..." xuất hiện
3. Khởi động lại server: `npm start`
4. Kiểm tra log "[Recovery] Loaded X daily stats records from SD card"
5. Mở dashboard → thống kê hôm nay vẫn còn đầy đủ

## Bước 9: Test với nhiều Arduino nodes

Nếu bạn có nhiều Arduino:

1. Upload code lên Arduino thứ 2, thay đổi `NODE_ID`:
   ```cpp
   #define NODE_ID "KHO_B"  // Node thứ 2
   ```
2. Kết nối qua COM port khác (VD: COM4)
3. Gateway sẽ tự động nhận diện node mới
4. Dashboard hiển thị cả 2 nodes

**Lưu ý**: Mỗi Arduino cần kết nối qua USB riêng. Nếu test chỉ với 1 Arduino, có thể giả lập nhiều nodes bằng cách thay đổi NODE_ID và upload lại.

## Khắc phục sự cố trên Windows

### Lỗi "Access denied" khi mở serial port

**Nguyên nhân**: Arduino IDE hoặc Serial Monitor đang mở port.

**Giải pháp**:
1. Đóng Arduino IDE Serial Monitor
2. Rút USB ra, cắm lại
3. Khởi động lại server

### Lỗi "Port COM3 not found"

**Nguyên nhân**: COM port không đúng hoặc driver chưa cài.

**Giải pháp**:
1. Kiểm tra lại Device Manager
2. Cài driver CH340 nếu cần: https://sparks.gogo.co.nz/ch340.html
3. Thử các COM port khác (COM3, COM4, COM5...)

### Lỗi "Cannot find module 'serialport'"

**Nguyên nhân**: Dependencies chưa cài đặt hoặc bị lỗi.

**Giải pháp**:
```cmd
# Xóa node_modules và reinstall
rmdir /s /q node_modules
del package-lock.json
npm install
```

### Server không nhận dữ liệu từ Arduino

**Kiểm tra**:
1. Arduino có gửi dữ liệu không? (Xem Serial Monitor)
2. COM port đúng chưa? (Xem Device Manager)
3. Baud rate đúng 9600 chưa? (Kiểm tra .env và Arduino code)
4. Format dữ liệu có đúng JSON không?

**Debug**:
```cmd
# Xem log chi tiết của serialport
set DEBUG=serialport*
npm start
```

### Dashboard không hiển thị dữ liệu

**Kiểm tra**:
1. Mở Console của trình duyệt (F12)
2. Xem có lỗi WebSocket không?
3. Kiểm tra server có log "Client connected" không?
4. Thử refresh trang (Ctrl+F5)

### Firewall chặn port 3000

**Giải pháp**:
1. Mở **Windows Defender Firewall**
2. Chọn "Allow an app through firewall"
3. Thêm Node.js vào danh sách được phép
4. Hoặc tạm thời tắt firewall để test

## Truy cập từ thiết bị khác trong mạng LAN

### Tìm IP của máy Windows

```cmd
ipconfig
```

Tìm dòng "IPv4 Address" (VD: `192.168.1.100`)

### Truy cập từ điện thoại/máy tính khác

Trên trình duyệt thiết bị khác, truy cập:
```
http://192.168.1.100:3000
```

**Lưu ý**: Đảm bảo firewall cho phép kết nối từ mạng LAN.

## Performance Monitoring trên Windows

### Kiểm tra RAM usage

Mở **Task Manager** (Ctrl+Shift+Esc):
- Tìm process "node.exe"
- Xem Memory usage (~50-100MB là bình thường)

### Kiểm tra CPU usage

- CPU usage nên < 5% khi idle
- Tăng lên khi có nhiều WebSocket clients kết nối

### Xem log chi tiết

Server log được hiển thị trong Command Prompt. Để lưu log ra file:

```cmd
npm start > server.log 2>&1
```

## So sánh Windows vs Raspberry Pi

| Tiêu chí | Windows (Test) | Raspberry Pi (Production) |
|----------|----------------|---------------------------|
| Serial Port | COM3, COM4 | /dev/ttyUSB0, /dev/ttyAMA0 |
| Performance | High (desktop CPU) | Medium (ARM CPU) |
| RAM | Dư thừa (>4GB) | Giới hạn (2-4GB) |
| Auto-start | Manual (user login) | systemd service |
| Điện | Desktop/Laptop | 5V/3A adapter |
| Độ ổn định | Phụ thuộc OS | Cao (headless) |

## Sau khi test xong

Khi đã test đầy đủ trên Windows, bạn có thể deploy lên Raspberry Pi:

1. Copy toàn bộ project folder sang RPi
2. Làm theo hướng dẫn trong **[raspberry-pi-setup.md](raspberry-pi-setup.md)**
3. Chỉnh sửa `.env` để dùng `/dev/ttyUSB0` thay vì COM port

## Tài liệu tham khảo

- [README.md](README.md) - Tài liệu chính
- [raspberry-pi-setup.md](raspberry-pi-setup.md) - Deploy production
- [arduino/README.md](arduino/README.md) - Hướng dẫn Arduino
- [test-api.http](test-api.http) - Test API endpoints

## Tips & Best Practices

1. **Luôn test trên Windows trước** → tiết kiệm thời gian debug trên RPi
2. **Sử dụng nodemon** (`npm run dev`) khi develop để tự động reload
3. **Kiểm tra Serial Monitor** trước để đảm bảo Arduino hoạt động
4. **Backup file .env** trước khi thay đổi cấu hình
5. **Xem Console log** (F12) để debug các vấn đề về WebSocket

## Hỗ trợ

Nếu gặp vấn đề, kiểm tra:
1. Log của server (Command Prompt)
2. Console của trình duyệt (F12)
3. Serial Monitor của Arduino
4. Device Manager (COM port status)

Hoặc tạo issue trên GitHub repository của project.
