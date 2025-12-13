#!/usr/bin/env python3
"""
Test AS32-TTL-100 chi tiết với nhiều delay và format lệnh AT khác nhau
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

def set_config_mode(wait_time=2):
    """Set to CONFIG mode with configurable delay"""
    GPIO.output(M0_PIN, GPIO.LOW)
    GPIO.output(M1_PIN, GPIO.HIGH)
    print(f"📡 Set CONFIG mode (M0=0, M1=1), waiting {wait_time}s...")
    time.sleep(wait_time)

    aux = GPIO.input(AUX_PIN)
    print(f"   AUX = {aux} ({'Ready' if aux else 'Busy'})")

def test_at_commands():
    """Test với nhiều format AT command khác nhau"""
    setup_gpio()
    set_config_mode(wait_time=2)

    # Test với nhiều format AT command
    at_formats = [
        (b"AT\r\n", "AT with \\r\\n"),
        (b"AT\n", "AT with \\n"),
        (b"AT\r", "AT with \\r"),
        (b"AT", "AT plain"),
        (b"at\r\n", "at lowercase with \\r\\n"),
        (b"+++\r\n", "+++ (enter command mode)"),
        (b"AT+\r\n", "AT+ with \\r\\n"),
    ]

    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=2)
        print(f"✅ Serial port {SERIAL_PORT} opened at {BAUD_RATE} baud\n")
        print("=" * 70)

        for cmd_bytes, desc in at_formats:
            print(f"\n🔍 Testing: {desc}")
            print(f"   Bytes: {cmd_bytes}")

            # Clear buffers
            ser.reset_input_buffer()
            ser.reset_output_buffer()

            # Send command
            ser.write(cmd_bytes)

            # Wait and read response
            time.sleep(1)
            response = ser.read(200).decode('utf-8', errors='ignore').strip()

            print(f"   RX: {repr(response) if response else '(no response)'}")

            if "+OK" in response or "OK" in response:
                print(f"   ✅ SUCCESS with {desc}!")

                # Try to get module info
                print("\n📝 Getting module configuration...")
                for info_cmd in [b"AT+ADDRESS?\r\n", b"AT+PARAMETER?\r\n", b"AT+CHANNEL?\r\n"]:
                    ser.reset_input_buffer()
                    ser.write(info_cmd)
                    time.sleep(0.5)
                    resp = ser.read(200).decode('utf-8', errors='ignore').strip()
                    print(f"   {info_cmd.decode('utf-8').strip()}: {resp}")

                break

            time.sleep(0.5)

        print("\n" + "=" * 70)
        ser.close()

    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        GPIO.cleanup()

def test_with_multiple_delays():
    """Test với nhiều khoảng delay khác nhau sau khi switch mode"""
    setup_gpio()

    delays = [0.5, 1.0, 2.0, 3.0, 5.0]

    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=2)
        print(f"✅ Serial port opened at {BAUD_RATE} baud\n")
        print("Testing with different delays after mode switch...")
        print("=" * 70)

        for delay in delays:
            print(f"\n🔍 Testing with {delay}s delay...")

            # Set config mode
            GPIO.output(M0_PIN, GPIO.LOW)
            GPIO.output(M1_PIN, GPIO.HIGH)
            time.sleep(delay)

            aux = GPIO.input(AUX_PIN)
            print(f"   AUX = {aux} after {delay}s")

            # Try AT command
            ser.reset_input_buffer()
            ser.reset_output_buffer()
            ser.write(b"AT\r\n")
            time.sleep(1)

            response = ser.read(200).decode('utf-8', errors='ignore').strip()
            print(f"   TX: AT\\r\\n")
            print(f"   RX: {repr(response) if response else '(no response)'}")

            if "+OK" in response:
                print(f"   ✅ SUCCESS with {delay}s delay!")
                break

        print("\n" + "=" * 70)
        ser.close()

    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        GPIO.cleanup()

def interactive_test():
    """Interactive test - manually send commands"""
    setup_gpio()
    set_config_mode(wait_time=2)

    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=2)
        print(f"✅ Serial port opened\n")
        print("Interactive mode - type AT commands (Ctrl+C to exit)")
        print("Examples: AT, AT+ADDRESS?, AT+PARAMETER?")
        print("=" * 70 + "\n")

        while True:
            cmd = input("Enter command: ").strip()
            if not cmd:
                continue

            ser.reset_input_buffer()
            ser.write((cmd + '\r\n').encode())
            time.sleep(1)

            response = ser.read(200).decode('utf-8', errors='ignore').strip()
            print(f"Response: {response if response else '(no response)'}\n")

    except KeyboardInterrupt:
        print("\n👋 Stopped")
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        ser.close()
        GPIO.cleanup()

if __name__ == '__main__':
    import sys

    print("AS32-TTL-100 Detailed Testing Tool\n")

    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 test-as32-detailed.py formats   # Test different AT formats")
        print("  python3 test-as32-detailed.py delays    # Test different delays")
        print("  python3 test-as32-detailed.py manual    # Interactive mode")
        print("\nRecommended: Start with 'formats'")
        sys.exit(1)

    mode = sys.argv[1]

    if mode == 'formats':
        test_at_commands()
    elif mode == 'delays':
        test_with_multiple_delays()
    elif mode == 'manual':
        interactive_test()
    else:
        print(f"Unknown mode: {mode}")
