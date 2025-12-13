#!/usr/bin/env python3
"""
Verify GPIO control của M0, M1 có thực sự thay đổi trạng thái module không
"""
import RPi.GPIO as GPIO
import serial
import time

M0_PIN = 23
M1_PIN = 24
AUX_PIN = 18
SERIAL_PORT = '/dev/ttyAMA0'
BAUD_RATE = 9600

def setup_gpio():
    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)
    GPIO.setup(M0_PIN, GPIO.OUT)
    GPIO.setup(M1_PIN, GPIO.OUT)
    GPIO.setup(AUX_PIN, GPIO.IN)
    print("✅ GPIO initialized\n")

def read_gpio_state():
    """Đọc trạng thái hiện tại của GPIO"""
    # Tạm thời chuyển sang input để đọc
    GPIO.setup(M0_PIN, GPIO.IN)
    GPIO.setup(M1_PIN, GPIO.IN)

    m0 = GPIO.input(M0_PIN)
    m1 = GPIO.input(M1_PIN)
    aux = GPIO.input(AUX_PIN)

    # Chuyển lại thành output
    GPIO.setup(M0_PIN, GPIO.OUT)
    GPIO.setup(M1_PIN, GPIO.OUT)

    return m0, m1, aux

def test_gpio_control_with_serial():
    """Test GPIO control và xem module có phản hồi khác nhau không"""
    setup_gpio()

    modes = [
        ("NORMAL", 0, 0),
        ("WOR", 1, 0),
        ("CONFIG", 0, 1),
        ("SLEEP", 1, 1),
    ]

    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1.5)
        print(f"✅ Serial port {SERIAL_PORT} opened at {BAUD_RATE} baud\n")
        print("=" * 70)

        for mode_name, m0_target, m1_target in modes:
            print(f"\n🔧 Setting {mode_name} mode (M0={m0_target}, M1={m1_target})")

            # Set GPIO
            GPIO.output(M0_PIN, GPIO.HIGH if m0_target else GPIO.LOW)
            GPIO.output(M1_PIN, GPIO.HIGH if m1_target else GPIO.LOW)
            print(f"   GPIO set: M0={m0_target}, M1={m1_target}")

            time.sleep(0.2)

            # Verify GPIO state
            m0_actual, m1_actual, aux = read_gpio_state()
            print(f"   GPIO read back: M0={m0_actual}, M1={m1_actual}, AUX={aux}")

            if m0_actual != m0_target or m1_actual != m1_target:
                print(f"   ⚠️  WARNING: GPIO readback doesn't match!")
                print(f"   Expected M0={m0_target}, M1={m1_target}")
                print(f"   Got M0={m0_actual}, M1={m1_actual}")

            # Wait for mode switch
            time.sleep(2)
            aux_after = GPIO.input(AUX_PIN)
            print(f"   AUX after 2s: {aux_after}")

            # Try sending AT command
            ser.reset_input_buffer()
            ser.reset_output_buffer()
            ser.write(b"AT\r\n")
            time.sleep(1)

            response = ser.read(200).decode('utf-8', errors='ignore').strip()
            print(f"   TX: AT\\r\\n")
            print(f"   RX: {repr(response) if response else '(no response)'}")

            if response:
                print(f"   📥 Got response in {mode_name} mode!")

            print("-" * 70)
            time.sleep(0.5)

        ser.close()

    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        GPIO.cleanup()

def test_manual_mode_switch():
    """Hướng dẫn test bằng tay (nối dây trực tiếp)"""
    print("📝 Manual GPIO Test Instructions")
    print("=" * 70)
    print("\nĐể kiểm tra xem GPIO có điều khiển được module không:")
    print("\n1. NGẮT KẾT NỐI M0, M1 khỏi GPIO 23, 24")
    print("2. NỐI BẰNG TAY:")
    print("   - M0 → GND")
    print("   - M1 → 3.3V")
    print("   (Đây là CONFIG mode)")
    print("\n3. Chờ 2 giây, rồi chạy:")
    print("   python3 -c \"import serial, time; s=serial.Serial('/dev/ttyAMA0',9600);")
    print("   s.write(b'AT\\\\r\\\\n'); time.sleep(1); print(s.read(100)); s.close()\"")
    print("\n4. Nếu thấy +OK → Module hoạt động, vấn đề là GPIO control")
    print("   Nếu không thấy gì → Module có vấn đề hoặc kết nối TX/RX sai")
    print("\n" + "=" * 70)

def test_alternative_pins():
    """Thử dùng các GPIO pin khác để loại trừ lỗi hardware"""
    print("\n🔧 Testing alternative GPIO pins for M0, M1")
    print("=" * 70)

    # Thử các GPIO pin khác
    test_pins = [
        (23, 24, "Original pins"),
        (17, 27, "Alternative pins GPIO17, GPIO27"),
        (22, 10, "Alternative pins GPIO22, GPIO10"),
    ]

    for m0_pin, m1_pin, desc in test_pins:
        print(f"\n📍 Testing {desc}: M0=GPIO{m0_pin}, M1=GPIO{m1_pin}")

        try:
            GPIO.setmode(GPIO.BCM)
            GPIO.setwarnings(False)
            GPIO.setup(m0_pin, GPIO.OUT)
            GPIO.setup(m1_pin, GPIO.OUT)

            # Set config mode
            GPIO.output(m0_pin, GPIO.LOW)
            GPIO.output(m1_pin, GPIO.HIGH)
            print(f"   Set: M0=LOW, M1=HIGH")
            time.sleep(0.2)

            # Read back
            GPIO.setup(m0_pin, GPIO.IN)
            GPIO.setup(m1_pin, GPIO.IN)
            m0_read = GPIO.input(m0_pin)
            m1_read = GPIO.input(m1_pin)
            print(f"   Read: M0={m0_read}, M1={m1_read}")

            if m0_read == 0 and m1_read == 1:
                print(f"   ✅ GPIO control working on {desc}")
            else:
                print(f"   ❌ GPIO control NOT working on {desc}")

            GPIO.cleanup()
            time.sleep(0.5)

        except Exception as e:
            print(f"   ❌ Error: {e}")
            GPIO.cleanup()

if __name__ == '__main__':
    import sys

    print("AS32-TTL-100 GPIO Control Verification\n")

    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 verify-gpio-control.py test      # Test GPIO with serial")
        print("  python3 verify-gpio-control.py manual    # Manual test instructions")
        print("  python3 verify-gpio-control.py pins      # Test alternative GPIO pins")
        sys.exit(1)

    mode = sys.argv[1]

    if mode == 'test':
        test_gpio_control_with_serial()
    elif mode == 'manual':
        test_manual_mode_switch()
    elif mode == 'pins':
        test_alternative_pins()
    else:
        print(f"Unknown mode: {mode}")
