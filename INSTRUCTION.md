# 📘 HTGSNDDA - Hệ thống Giám sát Nhiệt độ Độ ẩm qua LoRa

## 1. Tổng quan
Hệ thống giám sát môi trường (Nhiệt độ, Độ ẩm) sử dụng công nghệ LoRa để truyền tin khoảng cách xa. Hệ thống bao gồm:
*   **Gateway (Server)**: Chạy trên Raspberry Pi (Node.js), thu thập dữ liệu, lưu trữ và hiển thị Web Dashboard.
*   **Nodes (Client)**: Các trạm cảm biến sử dụng Arduino kết nối module LoRa.

## 2. Cấu trúc thư mục dự án

```text
HTGSNDDA/
├── arduino/           # Source code cho các Node cảm biến (Arduino IDE)
│   └── Node_Sensor/   # Code nạp cho Arduino + LoRa + Sensor
├── data/              # Lưu trữ dữ liệu lịch sử (JSON)
│   └── daily-stats.json
├── public/            # Giao diện Web (Frontend: HTML/CSS/JS)
├── src/               # Mã nguồn Server Gateway
│   └── server.js      # File chính khởi chạy hệ thống
├── .env               # Cấu hình môi trường (Port, Serial, v.v.)
├── package.json       # Khai báo thư viện Node.js
└── INSTRUCTION.md     # Tài liệu hướng dẫn này
```

## 3. Thiết lập phần cứng

### 3.1. Gateway (Raspberry Pi + AS32-TTL-100)
Kết nối module LoRa AS32-TTL-100 với Raspberry Pi qua GPIO và USB-to-TTL (hoặc UART):

| Chân Module LoRa | Raspberry Pi (BCM) | Chức năng |
| :--- | :--- | :--- |
| **VCC** | 5V | Nguồn |
| **GND** | GND | Mass |
| **TX** | USB RX (hoặc RXD0) | Truyền dữ liệu |
| **RX** | USB TX (hoặc TXD0) | Nhận dữ liệu |
| **M0** | GPIO 23 (Pin 16) | Điều khiển Mode |
| **M1** | GPIO 24 (Pin 18) | Điều khiển Mode |
| **AUX** | GPIO 18 (Pin 12) | Trạng thái module |

*Lưu ý: Nếu không dùng GPIO để điều khiển Mode, nối cứng M0 và M1 xuống GND để module hoạt động ở chế độ Normal.*

### 3.2. Node Cảm biến (Arduino + LoRa)
Source code nằm trong thư mục `arduino/`.
*   **Phần cứng**: Arduino Uno/Nano/Pro Mini + Module LoRa AS32-TTL-100 + Cảm biến (DHT11/DHT22/SHT30).
*   **Kết nối**: Tương tự Gateway, nhưng thường dùng SoftwareSerial trên Arduino.

## 4. Giao thức truyền thông (Protocol)

Hệ thống sử dụng giao thức JSON được đóng gói trong cặp ký tự `<` và `>` để đảm bảo toàn vẹn dữ liệu khi truyền qua UART.

### 4.1. Bản tin từ Node gửi về Gateway (Sensor Data)
Format: `<JSON>`

**Ví dụ:**
```json
<{"id":"N1", "temp":30.5, "hum":70, "relay":false, "manual":true}>
```

*   `id`: Mã định danh của Node (Ví dụ: N1, N2).
*   `temp`: Nhiệt độ trung bình.
*   `hum`: Độ ẩm trung bình.
*   `temp1`, `temp2`: (Tùy chọn) Nhiệt độ từng cảm biến thành phần.
*   `relay`: Trạng thái Relay (true=ON, false=OFF).
*   `manual`: Chế độ điều khiển (true=Thủ công, false=Tự động).
*   `ack`: (Tùy chọn) Gửi kèm `true` nếu đây là bản tin xác nhận thực hiện lệnh.

### 4.2. Lệnh từ Gateway gửi xuống Node (Control Command)
Format: `<JSON>`

**Ví dụ:**
```json
<{"target":"N1", "relay":true, "auto":false}>
```

*   `target`: ID của Node cần điều khiển.
*   `relay`: Bật/Tắt thiết bị (true/false).
*   `auto`: Chuyển chế độ Tự động/Thủ công.

## 5. Hướng dẫn cài đặt & Chạy Server

### Yêu cầu
*   Node.js (v14 trở lên)
*   Raspberry Pi (đã cài OS)

### Các bước cài đặt
1.  **Cài đặt thư viện**:
    ```bash
    npm install
    ```

2.  **Cấu hình**:
    Tạo file `.env` (nếu chưa có) và chỉnh sửa:
    ```env
    PORT=3000
    SERIAL_PORT=/dev/ttyUSB0
    BAUD_RATE=9600
    MAX_HISTORY=500
    ```

3.  **Chạy Server**:
    ```bash
    # Chạy trực tiếp
    node src/server.js
    
    # Hoặc dùng npm
    npm start
    ```

## 6. API Documentation

Server cung cấp REST API để truy xuất dữ liệu:

| Method | Endpoint | Mô tả |
| :--- | :--- | :--- |
| `GET` | `/api/nodes` | Lấy danh sách tất cả các node và dữ liệu mới nhất. |
| `GET` | `/api/nodes/:id` | Lấy dữ liệu chi tiết của một node cụ thể. |
| `GET` | `/api/history` | Lấy lịch sử dữ liệu (bắt buộc `nodeId`, hỗ trợ lọc theo `date`). |
| `GET` | `/api/daily-stats/:id` | Lấy thống kê Min/Max theo ngày của một node. |
| `GET` | `/api/status` | Xem trạng thái hệ thống (RAM, Uptime, Serial). |
| `POST` | `/api/control/relay` | Gửi lệnh điều khiển. Body: `{ "target": "N1", "relay": true }` |

## 7. WebSocket Events (Socket.io)

Dành cho phát triển giao diện Real-time (Frontend trong thư mục `public/`).

### Client lắng nghe (Listen):
*   `initialData`: Nhận danh sách node và lịch sử ngay khi kết nối.
*   `sensorData`: Nhận dữ liệu mới mỗi khi có bản tin từ cảm biến.
*   `commandAck`: Nhận xác nhận khi Node đã thực hiện lệnh thành công.

### Client gửi đi (Emit):
*   `controlRelay`: Gửi yêu cầu điều khiển.
    *   Data: `{ target: "N1", relay: true, auto: false }`

## 8. Lưu ý cho Lập trình viên (Developer Notes)

1.  **Xử lý Serial**:
    *   Code trong `server.js` sử dụng cơ chế buffer thủ công (`serialBuffer`) để ghép các mảnh dữ liệu UART thành chuỗi JSON hoàn chỉnh dựa trên ký tự `<` và `>`.
    *   Nếu thay đổi code Arduino, hãy đảm bảo giữ nguyên định dạng đóng gói này.

2.  **Lưu trữ dữ liệu**:
    *   Dữ liệu thời gian thực được lưu trên RAM (`sensorData`, `dataHistory`).
    *   Thống kê ngày (Min/Max) được lưu xuống file `data/daily-stats.json` mỗi 1 giờ và khi tắt server.
    *   Cơ chế tự động dọn dẹp (`cleanupOldStats`) sẽ xóa dữ liệu cũ hơn 30 ngày để bảo vệ thẻ nhớ SD của Raspberry Pi.

3.  **Môi trường Dev (Windows/Mac)**:
    *   Server có thể chạy trên Windows/Mac để phát triển Web.
    *   Module `onoff` (GPIO) sẽ tự động bị vô hiệu hóa nếu không chạy trên Linux/RPi.
    *   Nếu không có module LoRa thật, server sẽ chạy ở chế độ "Demo" (không crash, nhưng không có dữ liệu thật).

---
*Dự án Sáng kiến 2025 - Hệ thống Giám sát Nhiệt độ Độ ẩm*