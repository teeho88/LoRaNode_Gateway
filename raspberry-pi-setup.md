# Cài đặt Gateway trên Raspberry Pi 4

Hướng dẫn cài đặt và cấu hình LoRa Gateway trên Raspberry Pi 4.

## Yêu cầu phần cứng

- Raspberry Pi 4 (khuyến nghị 2GB RAM trở lên)
- Thẻ nhớ microSD (16GB trở lên)
- Module LoRa SX1278 kết nối qua USB-Serial hoặc GPIO
- Nguồn 5V/3A cho Raspberry Pi

## Cài đặt hệ điều hành

### 1. Cài đặt Raspberry Pi OS Lite

Sử dụng Raspberry Pi OS Lite (64-bit) để tiết kiệm tài nguyên:

```bash
# Download Raspberry Pi Imager từ:
# https://www.raspberrypi.com/software/

# Chọn:
# OS: Raspberry Pi OS Lite (64-bit)
# Storage: Your SD card
```

### 2. Cấu hình SSH và Wi-Fi

Sau khi flash xong, tạo file trong phân vùng boot:

**ssh** (file trống để bật SSH)

**wpa_supplicant.conf**:
```
country=VN
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1

network={
    ssid="YOUR_WIFI_NAME"
    psk="YOUR_WIFI_PASSWORD"
}
```

## Cài đặt phần mềm

### 1. Cập nhật hệ thống

```bash
sudo apt update
sudo apt upgrade -y
```

### 2. Cài đặt Node.js

```bash
# Cài đặt Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Kiểm tra version
node -v
npm -v
```

### 3. Cài đặt Git

```bash
sudo apt install -y git
```

### 4. Clone project

```bash
cd ~
git clone <repository-url> lora-gateway
cd lora-gateway
```

### 5. Cài đặt dependencies

```bash
npm install
```

### 6. Cấu hình Serial Port

```bash
# Kiểm tra cổng serial
ls -la /dev/ttyUSB* /dev/ttyAMA*

# Thêm user vào group dialout
sudo usermod -a -G dialout $USER

# Logout và login lại để áp dụng
```

### 7. Cấu hình môi trường

```bash
cp .env.example .env
nano .env
```

Chỉnh sửa:
```
PORT=3000
SERIAL_PORT=/dev/ttyUSB0  # Điều chỉnh theo hệ thống
BAUD_RATE=9600
MAX_HISTORY=500
```

## Chạy Gateway

### Chạy thử nghiệm

```bash
npm start
```

Truy cập dashboard:
```
http://<raspberry-pi-ip>:3000
```

## Tự động chạy khi khởi động (Systemd)

### 1. Tạo systemd service

```bash
sudo nano /etc/systemd/system/lora-gateway.service
```

Nội dung:
```ini
[Unit]
Description=LoRa Gateway Service
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/lora-gateway
Environment="NODE_ENV=production"
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### 2. Kích hoạt service

```bash
# Reload systemd
sudo systemctl daemon-reload

# Bật service
sudo systemctl enable lora-gateway

# Khởi động service
sudo systemctl start lora-gateway

# Kiểm tra trạng thái
sudo systemctl status lora-gateway

# Xem logs
journalctl -u lora-gateway -f
```

### 3. Quản lý service

```bash
# Dừng service
sudo systemctl stop lora-gateway

# Khởi động lại
sudo systemctl restart lora-gateway

# Vô hiệu hóa auto-start
sudo systemctl disable lora-gateway
```

## Tối ưu hiệu suất

### 1. Giảm RAM sử dụng

Trong `.env`:
```
MAX_HISTORY=300  # Giảm nếu cần
```

### 2. Giám sát tài nguyên

```bash
# CPU và RAM
htop

# Theo dõi process
ps aux | grep node

# Kiểm tra nhiệt độ
vcgencmd measure_temp
```

### 3. Swap memory (nếu RAM < 2GB)

```bash
# Tăng swap
sudo dphys-swapfile swapoff
sudo nano /etc/dphys-swapfile
# Đổi CONF_SWAPSIZE=100 thành CONF_SWAPSIZE=1024
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

## Cấu hình Firewall

```bash
# Cài đặt UFW
sudo apt install -y ufw

# Cho phép SSH
sudo ufw allow 22

# Cho phép HTTP (dashboard)
sudo ufw allow 3000

# Bật firewall
sudo ufw enable
```

## Truy cập từ xa

### 1. Cấu hình Static IP

```bash
sudo nano /etc/dhcpcd.conf
```

Thêm:
```
interface wlan0
static ip_address=192.168.1.100/24
static routers=192.168.1.1
static domain_name_servers=8.8.8.8 8.8.4.4
```

### 2. Hoặc sử dụng mDNS

```bash
# Cài đặt Avahi
sudo apt install -y avahi-daemon

# Truy cập qua:
# http://raspberrypi.local:3000
```

## Backup & Update

### Backup cấu hình

```bash
# Backup .env và data
tar -czf backup-$(date +%Y%m%d).tar.gz .env
```

### Cập nhật code

```bash
cd ~/lora-gateway
git pull
npm install
sudo systemctl restart lora-gateway
```

## Khắc phục sự cố

### Gateway không khởi động

```bash
# Kiểm tra logs
journalctl -u lora-gateway -n 50

# Kiểm tra port
netstat -tlnp | grep 3000

# Test serial port
sudo apt install -y minicom
minicom -D /dev/ttyUSB0 -b 9600
```

### Lỗi quyền serial port

```bash
# Kiểm tra group
groups

# Nếu chưa có dialout
sudo usermod -a -G dialout $USER
# Logout và login lại
```

### Mất kết nối Wi-Fi

```bash
# Kiểm tra kết nối
iwconfig

# Khởi động lại Wi-Fi
sudo systemctl restart networking
```

### RAM đầy

```bash
# Kiểm tra RAM
free -h

# Giảm MAX_HISTORY trong .env
nano .env
# Đổi MAX_HISTORY=500 thành MAX_HISTORY=200

# Restart service
sudo systemctl restart lora-gateway
```

## Giám sát & Bảo trì

### Cron job kiểm tra định kỳ

```bash
crontab -e
```

Thêm:
```
# Khởi động lại hàng ngày lúc 3 giờ sáng
0 3 * * * sudo systemctl restart lora-gateway

# Dọn dẹp logs cũ hàng tuần
0 0 * * 0 journalctl --vacuum-time=7d
```

### Script kiểm tra gateway

Tạo `~/check_gateway.sh`:
```bash
#!/bin/bash
if ! systemctl is-active --quiet lora-gateway; then
    echo "Gateway is down! Restarting..."
    sudo systemctl restart lora-gateway
fi
```

Chmod:
```bash
chmod +x ~/check_gateway.sh
```

Thêm vào crontab (chạy mỗi 5 phút):
```
*/5 * * * * ~/check_gateway.sh
```

## Hiệu suất mong đợi

### Raspberry Pi 4 (2GB RAM)
- Có thể xử lý: **20-30 nodes** đồng thời
- Tốc độ phản hồi: < 100ms
- RAM sử dụng: ~150-200MB
- CPU idle: ~5-10%

### Raspberry Pi 4 (4GB RAM)
- Có thể xử lý: **50+ nodes** đồng thời
- Lưu trữ: MAX_HISTORY=1000 vẫn ổn định

## Tài liệu tham khảo

- [Raspberry Pi Documentation](https://www.raspberrypi.com/documentation/)
- [Node.js on ARM](https://nodejs.org/en/download/)
- [Systemd Service Management](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
