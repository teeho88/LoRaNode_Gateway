# Khắc phục lỗi: Không nhận được RX: +OK khi cấu hình AS32-TTL-100

## 🚨 Triệu chứng

Chạy `sudo python3 config_as32.py config` nhưng không thấy `RX: +OK` sau các lệnh AT.

---

## 🔍 Nguyên nhân có thể:

1. **TX/RX bị đảo ngược**
2. **Module chưa vào config mode** (M0, M1 không đúng)
3. **UART chưa hoạt động** (/dev/ttyAMA0 không có)
4. **Module không có nguồn hoặc lỗi**
5. **Baud rate không khớp**

---

## 📋 Debug từng bước

### Bước 1: Kiểm tra kết nối phần cứng

#### 1.1. Kiểm tra sơ đồ kết nối

```
AS32-TTL-100          Raspberry Pi GPIO
─────────────────────────────────────────
TXD (module)    →     GPIO 15 (RXD/Pin 10)  ⚠️ TXD → RXD
RXD (module)    →     GPIO 14 (TXD/Pin 8)   ⚠️ RXD → TXD
M0              →     GPIO 23 (Pin 16)
M1              →     GPIO 24 (Pin 18)
AUX             →     GPIO 18 (Pin 12)
VCC             →     5V (Pin 2 hoặc 4)
GND             →     GND (Pin 6, 9, 14, v.v.)
```

**Quan trọng:**
- AS32 **TXD** nối với RPi **RXD** (GPIO 15)
- AS32 **RXD** nối với RPi **TXD** (GPIO 14)

#### 1.2. Kiểm tra nguồn module

```bash
# Đo điện áp nếu có đồng hồ: VCC phải có 5V
# Hoặc kiểm tra LED trên module (nếu có) có sáng không
```

---

### Bước 2: Kiểm tra GPIO điều khiển M0, M1

```bash
sudo python3 << 'EOF'
import RPi.GPIO as GPIO
import time

M0_PIN = 23
M1_PIN = 24

GPIO.setmode(GPIO.BCM)
GPIO.setup(M0_PIN, GPIO.OUT)
GPIO.setup(M1_PIN, GPIO.OUT)

print("🔧 Testing GPIO control for M0, M1...")
print("Setting M0=LOW, M1=HIGH (Config mode)")
GPIO.output(M0_PIN, GPIO.LOW)
GPIO.output(M1_PIN, GPIO.HIGH)
time.sleep(0.2)

# Đọc lại giá trị để verify
GPIO.setup(M0_PIN, GPIO.IN)
GPIO.setup(M1_PIN, GPIO.IN)
m0_state = GPIO.input(M0_PIN)
m1_state = GPIO.input(M1_PIN)

print(f"M0 = {m0_state} (expected: 0)") 
print(f"M1 = {m1_state} (expected: 1)")

if m0_state == 0 and m1_state == 1:
    print("✅ GPIO control working!")
else:
    print("❌ GPIO control not working - check wiring")

GPIO.cleanup()
EOF
```

**Kết quả mong đợi:**
```
🔧 Testing GPIO control for M0, M1...
Setting M0=LOW, M1=HIGH (Config mode)
M0 = 0 (expected: 0)
M1 = 1 (expected: 1)
✅ GPIO control working!
```

**Nếu không đúng:**
- Kiểm tra lại kết nối dây GPIO 23 (M0) và GPIO 24 (M1)
- Kiểm tra dây không bị đứt

---

### Bước 3: Test UART với loopback

Nối GPIO 14 (TXD) với GPIO 15 (RXD) của Raspberry Pi (tạm thời ngắt AS32):

```bash
sudo python3 << 'EOF'
import serial
import time

ser = serial.Serial('/dev/ttyAMA0', 9600, timeout=1)
print("🔧 UART loopback test")
print("   (Temporarily connect GPIO14 to GPIO15)")
print("")

test_msg = b"HELLO_TEST\r\n"
ser.write(test_msg)
time.sleep(0.2)

response = ser.read(100)
print(f"Sent:     {test_msg}")
print(f"Received: {response}")

if b"HELLO_TEST" in response:
    print("\n✅ UART is working!")
else:
    print("\n❌ UART not working - check UART configuration")
    print("   1. Check /dev/serial0 -> ttyAMA0")
    print("   2. Check enable_uart=1 in /boot/firmware/config.txt")
    print("   3. Check Bluetooth is disabled")

ser.close()
EOF
```

**Nếu UART không hoạt động:**
```bash
# Kiểm tra lại cấu hình
ls -la /dev/serial0
cat /boot/firmware/config.txt | grep -E 'enable_uart|disable-bt'
```

---

### Bước 4: Test AS32 module response (Manual mode)

Thử set M0, M1 **bằng tay** (nối trực tiếp vào GND/3.3V):
- **M0 → GND** (LOW)
- **M1 → 3.3V** (HIGH) - để vào config mode

Sau đó test:

```bash
sudo python3 << 'EOF'
import serial
import time

print("🔧 Testing AS32-TTL-100 response...")
print("   Make sure M0=GND, M1=3.3V manually")
print("")

try:
    ser = serial.Serial('/dev/ttyAMA0', 9600, timeout=2)

    # Clear buffer
    ser.reset_input_buffer()
    ser.reset_output_buffer()

    # Test với lệnh AT đơn giản
    print("TX: AT")
    ser.write(b"AT\r\n")
    time.sleep(1)

    response = ser.read(100).decode('utf-8', errors='ignore').strip()
    print(f"RX: {response}")

    if "+OK" in response or "OK" in response:
        print("\n✅ Module is responding!")
    elif len(response) > 0:
        print(f"\n⚠️  Module sent something: {repr(response)}")
        print("   But not expected +OK response")
    else:
        print("\n❌ No response from module")
        print("\nTroubleshooting:")
        print("  1. ⚠️  TX/RX may be SWAPPED - try reversing them")
        print("  2. Check module power (VCC=5V, GND connected)")
        print("  3. Check M0=LOW, M1=HIGH for config mode")
        print("  4. Try different baud rate (some modules use 115200)")

    ser.close()
except Exception as e:
    print(f"❌ Error: {e}")
EOF
```

---

### Bước 5: Thử đảo ngược TX/RX

Nếu vẫn không có phản hồi, **thử hoán đổi TX và RX**:

**Kết nối cũ (có thể sai):**
- AS32 TXD → GPIO 15 (RXD)
- AS32 RXD → GPIO 14 (TXD)

**Thử kết nối mới:**
- AS32 TXD → GPIO 14 (TXD)  ← **Đảo**
- AS32 RXD → GPIO 15 (RXD)  ← **Đảo**

Sau đó chạy lại test ở Bước 4.

---

### Bước 6: Thử baud rate khác

Một số module AS32 mặc định dùng 115200 thay vì 9600:

```bash
sudo python3 << 'EOF'
import serial
import time

for baud in [9600, 19200, 38400, 57600, 115200]:
    print(f"\n🔧 Testing baud rate: {baud}")
    try:
        ser = serial.Serial('/dev/ttyAMA0', baud, timeout=1)
        ser.write(b"AT\r\n")
        time.sleep(0.5)
        response = ser.read(100).decode('utf-8', errors='ignore').strip()

        if "+OK" in response or "OK" in response:
            print(f"✅ Module responds at {baud} baud!")
            print(f"RX: {response}")
            ser.close()
            break
        else:
            print(f"   No response at {baud}")

        ser.close()
    except Exception as e:
        print(f"   Error at {baud}: {e}")
EOF
```

---

### Bước 7: Kiểm tra AUX pin

```bash
sudo python3 << 'EOF'
import RPi.GPIO as GPIO
import time

AUX_PIN = 18

GPIO.setmode(GPIO.BCM)
GPIO.setup(AUX_PIN, GPIO.IN)

print("🔧 Checking AUX pin state...")
for i in range(10):
    aux_state = GPIO.input(AUX_PIN)
    print(f"  AUX = {aux_state} ({'HIGH' if aux_state else 'LOW'})")
    time.sleep(0.5)

print("\nAUX should be:")
print("  HIGH (1) = Module is idle/ready")
print("  LOW (0)  = Module is busy/transmitting OR powered off")

GPIO.cleanup()
EOF
```

**Nếu AUX luôn ở LOW:** Module không có nguồn hoặc bị lỗi.

---

## ✅ Giải pháp nhanh: Bỏ qua cấu hình AT

Nếu không cần thay đổi cấu hình module (giữ nguyên mặc định), bạn có thể:

1. **Set M0=GND, M1=GND bằng tay** (normal mode)
2. **Bỏ qua bước config** (`config_as32.py config`)
3. **Chạy trực tiếp test** để nhận dữ liệu:

```bash
# Set normal mode bằng GPIO
sudo python3 set_normal_mode.py

# Test nhận dữ liệu
sudo python3 config_as32.py test
```

**Lưu ý:** Module AS32 thường đã được cấu hình sẵn từ nhà sản xuất với:
- Address: 0x0000 (broadcast)
- Channel: 0 (410MHz hoặc 433MHz tùy vùng)
- Baud: 9600
- Power: 20dBm

Nếu tất cả module của bạn dùng cấu hình mặc định giống nhau, chúng vẫn giao tiếp được với nhau.

---

## 📝 Checklist debug

- [ ] Kiểm tra kết nối phần cứng (TXD↔RXD, M0, M1, VCC, GND)
- [ ] GPIO điều khiển M0, M1 hoạt động (Bước 2)
- [ ] UART loopback test thành công (Bước 3)
- [ ] Module có nguồn (AUX pin HIGH - Bước 7)
- [ ] Thử đảo TX/RX (Bước 5)
- [ ] Thử baud rate khác (Bước 6)
- [ ] Module phản hồi AT commands (Bước 4)

---

## 🆘 Nếu tất cả đều thất bại

1. **Thử module khác** (nếu có) - module có thể bị lỗi
2. **Kiểm tra với USB-to-TTL adapter** (FT232, CH340) trên máy tính Windows để xác định module hoạt động
3. **Dùng cấu hình mặc định** - bỏ qua AT config, set M0=M1=GND bằng tay

---

**Cập nhật:** 2025-01-15
