# Khắc phục lỗi: Serial Port không được phát hiện trên Raspberry Pi

## 🚨 Lỗi hiện tại
```bash
ls: cannot access '/dev/ttyUSB*': No such file or directory
ls: cannot access '/dev/ttyAMA*': No such file or directory
```

## 🔍 Các bước kiểm tra

### Bước 1: Kiểm tra thiết bị USB được kết nối

```bash
lsusb
```

**Kết quả mong đợi:**
Bạn sẽ thấy một trong các dòng sau:
- `QinHeng Electronics HL-340 USB-Serial adapter` (CH340/CH341)
- `FTDI FT232 USB-Serial`
- `Prolific PL2303 USB-Serial`
- `Silicon Labs CP210x UART Bridge`

**Nếu KHÔNG thấy thiết bị USB-Serial:**
- Thử cắm lại module LoRa vào cổng USB khác
- Kiểm tra cable USB có hoạt động không
- Thử cắm vào máy tính Windows/Linux khác để test

---

### Bước 2: Kiểm tra kernel log

```bash
dmesg | tail -30
```

**Sau đó rút và cắm lại module USB**, chờ 2 giây rồi chạy:

```bash
dmesg | tail -30
```

**Kết quả mong đợi:**
```
[ 1234.567890] usb 1-1.3: new full-speed USB device number 5 using xhci_hcd
[ 1234.678901] usb 1-1.3: New USB device found, idVendor=1a86, idProduct=7523
[ 1234.789012] ch341 1-1.3:1.0: ch341-uart converter detected
[ 1234.890123] usb 1-1.3: ch341-uart converter now attached to ttyUSB0
```

**Nếu thấy lỗi:**
- `device not accepting address`: Cable USB lỗi hoặc nguồn không đủ
- `device descriptor read/64, error -71`: Driver chưa được cài hoặc module bị lỗi

---

### Bước 3: Kiểm tra kernel modules (drivers)

```bash
lsmod | grep -E 'usbserial|ch341|ftdi|pl2303|cp210x'
```

**Kết quả mong đợi (một trong các dòng sau):**
```
ch341                  16384  0
usbserial              49152  1 ch341
```

**Nếu KHÔNG thấy gì:**
Cài đặt driver thủ công:

```bash
# Đối với CH340/CH341 (module LoRa phổ biến)
sudo modprobe ch341
sudo modprobe usbserial

# Đối với FTDI
sudo modprobe ftdi_sio

# Đối với PL2303
sudo modprobe pl2303
```

Sau đó rút và cắm lại module USB.

---

### Bước 4: Kiểm tra tất cả serial ports có sẵn

```bash
ls -la /dev/tty* | grep -E 'USB|ACM|AMA|S[0-9]'
```

**Kết quả có thể có:**
- `/dev/ttyUSB0` - USB-to-Serial adapter (CH340, FTDI, PL2303)
- `/dev/ttyACM0` - USB CDC devices (Arduino Uno, Mega)
- `/dev/ttyAMA0` - Raspberry Pi GPIO UART (không dùng được cho USB module)
- `/dev/ttyS0` - Hardware UART (thường là Bluetooth)

**Nếu thấy `/dev/ttyUSB0`:**
✅ Module đã được phát hiện! Chuyển sang Bước 5.

**Nếu thấy `/dev/ttyACM0`:**
✅ Module được nhận dạng là Arduino-compatible device. Sửa file `.env`:
```env
SERIAL_PORT=/dev/ttyACM0
```

**Nếu KHÔNG thấy gì:**
⚠️ Module không được phát hiện, kiểm tra lại phần cứng.

---

### Bước 5: Kiểm tra quyền truy cập serial port

Giả sử tìm thấy `/dev/ttyUSB0`:

```bash
ls -la /dev/ttyUSB0
```

**Kết quả mong đợi:**
```
crw-rw---- 1 root dialout 188, 0 Jan 15 10:30 /dev/ttyUSB0
```

Kiểm tra user hiện tại có trong group `dialout`:

```bash
groups
```

**Nếu KHÔNG thấy `dialout` trong danh sách:**

```bash
sudo usermod -a -G dialout $USER
```

**Sau đó LOGOUT và LOGIN lại** (hoặc reboot Raspberry Pi).

Kiểm tra lại:
```bash
groups
# Phải thấy: pi adm dialout cdrom sudo audio video plugdev games users input render netdev gpio i2c spi
```

---

### Bước 6: Test serial port với minicom

```bash
# Cài minicom nếu chưa có
sudo apt-get install minicom

# Test kết nối (thay ttyUSB0 bằng port bạn tìm thấy)
minicom -b 9600 -D /dev/ttyUSB0
```

**Trong minicom:**
- Nhấn `Ctrl+A` rồi `Z` để xem menu
- Nhấn `Ctrl+A` rồi `X` để thoát

**Nếu thấy dữ liệu từ module LoRa:**
✅ Serial port hoạt động! Vấn đề có thể ở code Node.js.

**Nếu bị lỗi "cannot open /dev/ttyUSB0":**
⚠️ Vấn đề quyền truy cập, quay lại Bước 5.

---

### Bước 7: Cập nhật file `.env`

Sau khi xác định được serial port (ví dụ: `/dev/ttyUSB0`):

```bash
# Mở file .env
nano .env
```

Sửa dòng:
```env
SERIAL_PORT=/dev/ttyUSB0
```

Lưu file: `Ctrl+O`, `Enter`, `Ctrl+X`

---

### Bước 8: Restart server và kiểm tra

```bash
# Nếu chạy bằng npm start
npm start

# Nếu chạy bằng systemd service
sudo systemctl restart lora-gateway
sudo journalctl -u lora-gateway -f
```

**Log mong đợi:**
```
╔════════════════════════════════════════╗
║   🚀 LoRa Gateway Server Started       ║
╚════════════════════════════════════════╝
📡 Serial port /dev/ttyUSB0 opened at 9600 baud
🔄 Using packet framing with < > markers
⏳ Waiting for sensor data...
```

**Nếu thấy lỗi:**
```
Error: Error: No such file or directory, cannot open /dev/ttyUSB0
```
→ Quay lại Bước 4, kiểm tra lại port name.

---

## 🛠️ Công cụ Debug bổ sung

### Kiểm tra thông tin module USB chi tiết

```bash
# Lấy vendor ID và product ID
lsusb -v | grep -A 5 "CH340\|FTDI\|PL2303\|CP210x"
```

### Kiểm tra dmesg realtime khi cắm USB

```bash
# Terminal 1: Theo dõi kernel log
sudo dmesg -w

# Terminal 2: Rút và cắm lại USB module
# Quan sát Terminal 1 xem có log gì không
```

### Force reload USB subsystem

```bash
sudo modprobe -r usbserial ch341 ftdi_sio pl2303 cp210x
sudo modprobe usbserial
sudo modprobe ch341
```

Sau đó rút và cắm lại module.

---

## 📋 Checklist Troubleshooting

- [ ] `lsusb` thấy USB-Serial device
- [ ] `dmesg` thấy driver attach thành công
- [ ] `lsmod` thấy kernel module đã load
- [ ] `ls -la /dev/tty*` thấy `/dev/ttyUSB0` hoặc `/dev/ttyACM0`
- [ ] `groups` thấy user trong group `dialout`
- [ ] `minicom` kết nối được và thấy dữ liệu
- [ ] File `.env` có `SERIAL_PORT=/dev/ttyUSB0` đúng
- [ ] `npm start` hoặc `systemctl status lora-gateway` không lỗi

---

## 🆘 Nếu vẫn không hoạt động

### Test với Python (bypass Node.js)

Tạo file `test-serial.py`:

```python
#!/usr/bin/env python3
import serial
import time

port = '/dev/ttyUSB0'  # Thay bằng port của bạn
baud = 9600

try:
    ser = serial.Serial(port, baud, timeout=1)
    print(f"✅ Opened {port} at {baud} baud")
    print("📡 Listening for data... (Ctrl+C to exit)")

    while True:
        if ser.in_waiting > 0:
            data = ser.readline().decode('utf-8', errors='ignore').strip()
            print(f"📥 Received: {data}")
        time.sleep(0.1)

except serial.SerialException as e:
    print(f"❌ Error: {e}")
except KeyboardInterrupt:
    print("\n👋 Stopped")
finally:
    if 'ser' in locals():
        ser.close()
```

Chạy:
```bash
python3 test-serial.py
```

**Nếu Python script hoạt động nhưng Node.js không:**
→ Vấn đề ở code Node.js, không phải hardware.

---

## 📞 Thông tin cần gửi nếu cần hỗ trợ

Chạy script này và gửi kết quả:

```bash
#!/bin/bash
echo "=== USB Devices ==="
lsusb

echo -e "\n=== Kernel Modules ==="
lsmod | grep -E 'usbserial|ch341|ftdi|pl2303|cp210x'

echo -e "\n=== Serial Ports ==="
ls -la /dev/tty* | grep -E 'USB|ACM|AMA'

echo -e "\n=== User Groups ==="
groups

echo -e "\n=== Recent dmesg (USB related) ==="
dmesg | grep -i 'usb\|tty\|serial' | tail -20

echo -e "\n=== .env Configuration ==="
cat .env | grep SERIAL_PORT
```

Lưu output vào file:
```bash
bash debug-serial.sh > serial-debug-info.txt
```

---

**Cập nhật:** 2025-01-15
