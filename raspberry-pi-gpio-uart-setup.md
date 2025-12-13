# Kết nối AS32-TTL-100 trực tiếp với Raspberry Pi qua GPIO UART

## 📌 Sơ đồ kết nối

```
AS32-TTL-100          Raspberry Pi GPIO
─────────────────────────────────────────
TXD (module)    →     GPIO 15 (RXD/Pin 10)
RXD (module)    →     GPIO 14 (TXD/Pin 8)
M0              →     GPIO 23 (Pin 16)
M1              →     GPIO 24 (Pin 18)
AUX             →     GPIO 18 (Pin 12)
VCC             →     5V (Pin 2 hoặc Pin 4)
GND             →     GND (Pin 6, 9, 14, 20, 25, 30, 34, 39)
```

## 🔧 Bước 1: Cấu hình UART trên Raspberry Pi

### 1.1. Disable Serial Console (quan trọng!)

Raspberry Pi mặc định sử dụng UART cho console login. Cần tắt tính năng này:

```bash
sudo raspi-config
```

Chọn:
1. **3 Interface Options**
2. **I6 Serial Port**
3. "Would you like a login shell to be accessible over serial?" → **No**
4. "Would you like the serial port hardware to be enabled?" → **Yes**
5. **Finish** → **Yes** (reboot)

### 1.2. Kiểm tra UART sau khi reboot

```bash
# Kiểm tra UART có được enable không
ls -la /dev/serial*
ls -la /dev/ttyAMA0

# Nên thấy:
# /dev/serial0 -> ttyAMA0 (hoặc ttyS0 trên Pi 3/4 với Bluetooth enabled)
# /dev/ttyAMA0
```

### 1.3. Disable Bluetooth (nếu dùng Raspberry Pi 3/4)

Raspberry Pi 3/4 mặc định dùng hardware UART (`ttyAMA0`) cho Bluetooth. Để giải phóng cho LoRa module:

**Lưu ý:** Trên Raspberry Pi OS Bookworm (2023+), file config nằm ở `/boot/firmware/config.txt`. Trên phiên bản cũ hơn, file nằm ở `/boot/config.txt`.

Kiểm tra file nào tồn tại:
```bash
ls -la /boot/firmware/config.txt /boot/config.txt
```

**Nếu thấy `/boot/firmware/config.txt`** (Raspberry Pi OS mới):
```bash
sudo nano /boot/firmware/config.txt
```

**Nếu thấy `/boot/config.txt`** (Raspberry Pi OS cũ):
```bash
sudo nano /boot/config.txt
```

Thêm vào cuối file:
```
# Disable Bluetooth to free up ttyAMA0
dtoverlay=disable-bt

# Enable UART
enable_uart=1
```

Lưu file: **Ctrl+O**, **Enter**, **Ctrl+X**

Sau đó disable Bluetooth service:
```bash
# Thử disable hciuart (có thể không tồn tại trên một số phiên bản)
sudo systemctl disable hciuart 2>/dev/null || echo "hciuart service not found (this is OK)"

# Disable bluetooth service (tên mới hơn)
sudo systemctl disable bluetooth 2>/dev/null || echo "bluetooth service not found"

# Kiểm tra service nào đang chạy liên quan đến Bluetooth
systemctl list-units | grep -i blue
```

**Lưu ý:** Nếu tất cả lệnh trên đều báo "not found", đó là điều bình thường. Miễn là bạn đã thêm `dtoverlay=disable-bt` vào `/boot/config.txt`, Bluetooth đã bị tắt ở mức hardware.

Reboot:
```bash
sudo reboot
```

### 1.4. Kiểm tra lại sau khi disable Bluetooth

```bash
ls -la /dev/serial0
# Phải thấy: /dev/serial0 -> ttyAMA0
```

---

## 🔧 Bước 2: Cài đặt Python GPIO libraries (để điều khiển M0, M1, AUX)

```bash
# Cài đặt thư viện GPIO
sudo apt-get update
sudo apt-get install -y python3-rpi.gpio python3-serial

# Kiểm tra
python3 -c "import RPi.GPIO as GPIO; import serial; print('GPIO libraries OK')"
```

---

## 🔧 Bước 3: Tạo script Python để cấu hình AS32-TTL-100

Tạo file `config_as32.py`:

```python
#!/usr/bin/env python3
"""
Configure AS32-TTL-100 LoRa module via Raspberry Pi GPIO UART
"""
import RPi.GPIO as GPIO
import serial
import time

# GPIO Pin Definitions (BCM numbering)
M0_PIN = 23
M1_PIN = 24
AUX_PIN = 18

# UART Configuration
SERIAL_PORT = '/dev/ttyAMA0'  # or /dev/serial0
BAUD_RATE = 9600

def setup_gpio():
    """Initialize GPIO pins for AS32-TTL-100 control"""
    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)

    # M0, M1 as outputs (for mode selection)
    GPIO.setup(M0_PIN, GPIO.OUT)
    GPIO.setup(M1_PIN, GPIO.OUT)

    # AUX as input (module status indicator)
    GPIO.setup(AUX_PIN, GPIO.IN)

    print("✅ GPIO initialized")

def set_mode(mode):
    """
    Set AS32-TTL-100 operating mode:
    - 0: Normal mode (M0=0, M1=0) - Transmit/Receive
    - 1: WOR mode (M0=1, M1=0) - Wake on Radio
    - 2: Config mode (M0=0, M1=1) - AT Commands
    - 3: Sleep mode (M0=1, M1=1) - Deep sleep
    """
    modes = {
        0: (GPIO.LOW, GPIO.LOW),   # Normal
        1: (GPIO.HIGH, GPIO.LOW),  # WOR
        2: (GPIO.LOW, GPIO.HIGH),  # Config
        3: (GPIO.HIGH, GPIO.HIGH)  # Sleep
    }

    if mode not in modes:
        print(f"❌ Invalid mode: {mode}")
        return False

    m0, m1 = modes[mode]
    GPIO.output(M0_PIN, m0)
    GPIO.output(M1_PIN, m1)

    mode_names = {0: "Normal", 1: "WOR", 2: "Config", 3: "Sleep"}
    print(f"📡 Mode set to: {mode_names[mode]} (M0={m0}, M1={m1})")

    # Wait for module to switch mode
    time.sleep(0.1)
    return True

def wait_for_aux(timeout=2):
    """Wait for AUX pin to go HIGH (module ready)"""
    start = time.time()
    while GPIO.input(AUX_PIN) == GPIO.LOW:
        if time.time() - start > timeout:
            print(f"⚠️  AUX timeout after {timeout}s")
            return False
        time.sleep(0.01)
    return True

def send_at_command(ser, command, wait_time=0.5):
    """Send AT command and read response"""
    ser.write((command + '\r\n').encode())
    time.sleep(wait_time)

    response = b''
    while ser.in_waiting > 0:
        response += ser.read(ser.in_waiting)
        time.sleep(0.1)

    response_str = response.decode('utf-8', errors='ignore').strip()
    print(f"  TX: {command}")
    print(f"  RX: {response_str}")
    return response_str

def configure_module():
    """Configure AS32-TTL-100 with AT commands"""
    setup_gpio()

    # Enter config mode (M0=0, M1=1)
    print("\n🔧 Entering CONFIG mode...")
    set_mode(2)  # Config mode
    time.sleep(0.5)

    try:
        # Open serial port
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        print(f"✅ Serial port {SERIAL_PORT} opened at {BAUD_RATE} baud\n")

        # Clear buffer
        ser.reset_input_buffer()
        ser.reset_output_buffer()

        # Send configuration commands
        print("📝 Configuring module...")

        # 1. Set address to 0x0001
        send_at_command(ser, "AT+ADDRESS=0001")

        # 2. Set network ID to 0x00
        send_at_command(ser, "AT+NETWORKID=00")

        # 3. Set parameters: 9600 baud, 2.4k air rate, 20dBm power
        # Format: AT+PARAMETER=<baud>,<air_rate>,<power>
        # Baud: 9=9600, Air rate: 5=2.4k, Power: 0=20dBm (100mW)
        send_at_command(ser, "AT+PARAMETER=9,5,0")

        # 4. Set channel 23 (433MHz)
        send_at_command(ser, "AT+CHANNEL=23")

        # 5. Save configuration
        print("\n💾 Saving configuration...")
        send_at_command(ser, "AT+SAVE", wait_time=1)

        # 6. Reset module
        print("🔄 Resetting module...")
        send_at_command(ser, "AT+RESET", wait_time=1)

        ser.close()
        print("\n✅ Configuration complete!")

    except serial.SerialException as e:
        print(f"❌ Serial error: {e}")
        return False
    finally:
        # Return to normal mode
        print("\n📡 Switching to NORMAL mode...")
        set_mode(0)  # Normal mode
        GPIO.cleanup()

    return True

def test_communication():
    """Test UART communication in normal mode"""
    setup_gpio()
    set_mode(0)  # Normal mode

    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        print(f"✅ Opened {SERIAL_PORT} at {BAUD_RATE} baud")
        print("📡 Listening for LoRa data... (Ctrl+C to exit)\n")

        while True:
            if ser.in_waiting > 0:
                data = ser.readline().decode('utf-8', errors='ignore').strip()
                if data:
                    print(f"📥 Received: {data}")
            time.sleep(0.1)

    except KeyboardInterrupt:
        print("\n👋 Stopped")
    except serial.SerialException as e:
        print(f"❌ Serial error: {e}")
    finally:
        if 'ser' in locals():
            ser.close()
        GPIO.cleanup()

if __name__ == '__main__':
    import sys

    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 config_as32.py config   # Configure module")
        print("  python3 config_as32.py test     # Test communication")
        sys.exit(1)

    command = sys.argv[1]

    if command == 'config':
        configure_module()
    elif command == 'test':
        test_communication()
    else:
        print(f"Unknown command: {command}")
```

Lưu file và cấp quyền thực thi:
```bash
chmod +x config_as32.py
```

---

## 🔧 Bước 4: Cấu hình module AS32-TTL-100

```bash
# Chạy script cấu hình
sudo python3 config_as32.py config
```

**Output mong đợi:**
```
✅ GPIO initialized
🔧 Entering CONFIG mode...
📡 Mode set to: Config (M0=0, M1=1)
✅ Serial port /dev/ttyAMA0 opened at 9600 baud

📝 Configuring module...
  TX: AT+ADDRESS=0001
  RX: +OK
  TX: AT+NETWORKID=00
  RX: +OK
  TX: AT+PARAMETER=9,5,0
  RX: +OK
  TX: AT+CHANNEL=23
  RX: +OK

💾 Saving configuration...
  TX: AT+SAVE
  RX: +OK

🔄 Resetting module...
  TX: AT+RESET
  RX: +OK

✅ Configuration complete!
📡 Switching to NORMAL mode...
```

---

## 🔧 Bước 5: Test UART communication

```bash
# Test nhận dữ liệu từ LoRa module
sudo python3 config_as32.py test
```

**Nếu Arduino node đang gửi dữ liệu, bạn sẽ thấy:**
```
✅ Opened /dev/ttyAMA0 at 9600 baud
📡 Listening for LoRa data... (Ctrl+C to exit)

📥 Received: <{"id":"KHO_A","temp1":25.5,"hum1":65.0,...}>
📥 Received: <{"id":"KHO_A","temp1":25.6,"hum1":65.2,...}>
```

---

## 🔧 Bước 6: Cập nhật Node.js Gateway Server

### 6.1. Cập nhật file `.env`

```bash
nano .env
```

Sửa `SERIAL_PORT`:
```env
# Raspberry Pi GPIO UART
SERIAL_PORT=/dev/ttyAMA0

# Hoặc dùng alias (cũng trỏ đến ttyAMA0)
# SERIAL_PORT=/dev/serial0

BAUD_RATE=9600
PORT=3000
MAX_HISTORY=500
```

### 6.2. Thêm GPIO control vào `src/server.js`

Cài đặt thư viện GPIO cho Node.js:
```bash
npm install onoff
```

Cập nhật `src/server.js` để điều khiển M0, M1:

```javascript
// Thêm vào đầu file
const { Gpio } = require('onoff');

// GPIO Pin Definitions (BCM numbering)
const M0_PIN = 23;
const M1_PIN = 24;
const AUX_PIN = 18;

let m0, m1, aux;

// Initialize GPIO
function initGPIO() {
  try {
    m0 = new Gpio(M0_PIN, 'out');
    m1 = new Gpio(M1_PIN, 'out');
    aux = new Gpio(AUX_PIN, 'in');

    // Set normal mode (M0=0, M1=0)
    m0.writeSync(0);
    m1.writeSync(0);

    console.log('✅ GPIO initialized: AS32-TTL-100 in NORMAL mode');
  } catch (err) {
    console.error('⚠️  GPIO initialization failed:', err.message);
    console.log('   Running without GPIO control (module must be in normal mode)');
  }
}

// Cleanup GPIO on exit
function cleanupGPIO() {
  if (m0) m0.unexport();
  if (m1) m1.unexport();
  if (aux) aux.unexport();
}

// Trong hàm khởi động server, thêm:
// initGPIO();

// Trong graceful shutdown, thêm:
// cleanupGPIO();
```

---

## 🔧 Bước 7: Cấu hình systemd service (auto-start)

Tạo service file:

```bash
sudo nano /etc/systemd/system/lora-gateway.service
```

Nội dung:
```ini
[Unit]
Description=LoRa Gateway Server with GPIO Control
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/lora-gateway
Environment=NODE_ENV=production
ExecStartPre=/usr/bin/python3 /home/pi/lora-gateway/set_normal_mode.py
ExecStart=/usr/bin/node /home/pi/lora-gateway/src/server.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Tạo script `set_normal_mode.py`:
```python
#!/usr/bin/env python3
import RPi.GPIO as GPIO

M0_PIN = 23
M1_PIN = 24

GPIO.setmode(GPIO.BCM)
GPIO.setwarnings(False)
GPIO.setup(M0_PIN, GPIO.OUT)
GPIO.setup(M1_PIN, GPIO.OUT)

# Normal mode: M0=0, M1=0
GPIO.output(M0_PIN, GPIO.LOW)
GPIO.output(M1_PIN, GPIO.LOW)

print("AS32-TTL-100 set to NORMAL mode")
```

Cấp quyền và enable service:
```bash
chmod +x set_normal_mode.py
sudo systemctl daemon-reload
sudo systemctl enable lora-gateway
sudo systemctl start lora-gateway
```

Kiểm tra status:
```bash
sudo systemctl status lora-gateway
sudo journalctl -u lora-gateway -f
```

---

## ✅ Checklist kiểm tra

- [ ] UART enabled trong `raspi-config`
- [ ] Bluetooth disabled (nếu dùng Pi 3/4)
- [ ] `/dev/ttyAMA0` hoặc `/dev/serial0` tồn tại
- [ ] Kết nối đúng chân: TXD→GPIO15, RXD→GPIO14
- [ ] M0, M1, AUX kết nối đúng (GPIO 23, 24, 18)
- [ ] Module AS32 đã cấu hình (channel 23, 9600 baud)
- [ ] Python script test thấy dữ liệu từ Arduino
- [ ] File `.env` có `SERIAL_PORT=/dev/ttyAMA0`
- [ ] Node.js server khởi động không lỗi
- [ ] Dashboard thấy dữ liệu từ sensor node

---

## 🆘 Troubleshooting

### Lỗi: Permission denied on /dev/ttyAMA0

```bash
sudo usermod -a -G dialout pi
sudo usermod -a -G gpio pi
# Logout và login lại
```

### Lỗi: /dev/ttyAMA0 not found

```bash
# Kiểm tra config
cat /boot/config.txt | grep uart
# Phải thấy: enable_uart=1

# Kiểm tra Bluetooth
cat /boot/config.txt | grep bluetooth
# Nên thấy: dtoverlay=disable-bt

# Reboot
sudo reboot
```

### Module không phản hồi AT commands

- Kiểm tra kết nối TX/RX (có thể bị đảo ngược)
- Đảm bảo M0=LOW, M1=HIGH (config mode)
- Thử tăng `wait_time` trong `send_at_command()`
- Kiểm tra nguồn 5V ổn định (dùng đồng hồ đo)

### AUX pin luôn ở LOW

- Module đang bận transmit/receive
- Module chưa khởi động xong (đợi thêm 500ms)
- AUX không được kết nối đúng

---

## 📊 Ưu điểm của kết nối GPIO UART

✅ **Không cần USB adapter**: Giảm thiết bị, giảm điểm lỗi
✅ **Kết nối trực tiếp**: Tốc độ nhanh hơn, độ trễ thấp hơn
✅ **Điều khiển M0/M1**: Có thể switch mode từ code
✅ **Đọc AUX**: Biết module có sẵn sàng không
✅ **Ổn định hơn**: Không bị lỗi driver USB

---

**Cập nhật:** 2025-01-15
