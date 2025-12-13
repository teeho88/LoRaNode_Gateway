#!/usr/bin/env python3
"""
Test AS32-TTL-100 với nhiều baud rate khác nhau
Vì module đã phản hồi "ERROR", có thể baud rate không khớp
"""
import RPi.GPIO as GPIO
import serial
import time

# GPIO Pin Definitions
M0_PIN = 23
M1_PIN = 24
AUX_PIN = 18
SERIAL_PORT = '/dev/ttyAMA0'

# Common baud rates for LoRa modules
BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200]

def setup_gpio():
    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)
    GPIO.setup(M0_PIN, GPIO.OUT)
    GPIO.setup(M1_PIN, GPIO.OUT)
    GPIO.setup(AUX_PIN, GPIO.IN)

def set_config_mode():
    """Set to CONFIG mode (M0=0, M1=1)"""
    GPIO.output(M0_PIN, GPIO.LOW)
    GPIO.output(M1_PIN, GPIO.HIGH)
    print("📡 Set to CONFIG mode (M0=0, M1=1)")
    time.sleep(0.5)

def test_baud_rates():
    """Test all common baud rates"""
    setup_gpio()
    set_config_mode()

    print(f"\n🔍 Testing {len(BAUD_RATES)} baud rates on {SERIAL_PORT}...")
    print("=" * 70)

    found_working = False

    for baud in BAUD_RATES:
        print(f"\n⚙️  Testing {baud} baud...")

        try:
            ser = serial.Serial(SERIAL_PORT, baud, timeout=1)
            ser.reset_input_buffer()
            ser.reset_output_buffer()

            # Try simple AT command
            ser.write(b"AT\r\n")
            time.sleep(0.8)

            response = ser.read(200).decode('utf-8', errors='ignore').strip()

            if response:
                print(f"   TX: AT")
                print(f"   RX: {response}")

                if "+OK" in response or "OK" in response:
                    print(f"\n   ✅ SUCCESS! Module responds at {baud} baud with +OK")
                    found_working = True

                    # Try getting more info
                    print(f"\n   📝 Getting module info at {baud} baud...")

                    commands = [
                        ("AT+ADDRESS?", "Address"),
                        ("AT+PARAMETER?", "Parameters (baud, air rate, power)"),
                        ("AT+CHANNEL?", "Channel"),
                        ("AT+NETWORKID?", "Network ID"),
                    ]

                    for cmd, desc in commands:
                        ser.reset_input_buffer()
                        ser.write((cmd + '\r\n').encode())
                        time.sleep(0.5)
                        resp = ser.read(200).decode('utf-8', errors='ignore').strip()
                        print(f"   {desc}: {resp}")

                    ser.close()
                    break

                elif "ERROR" in response:
                    print(f"   ⚠️  Got ERROR response")
                    print(f"   This might be correct baud, but wrong mode or command format")

                else:
                    print(f"   ⚠️  Got unexpected response: {repr(response)}")

            else:
                print(f"   ❌ No response")

            ser.close()

        except Exception as e:
            print(f"   ❌ Error: {e}")

        time.sleep(0.3)

    print("\n" + "=" * 70)

    if not found_working:
        print("\n❌ No working baud rate found")
        print("\nTroubleshooting:")
        print("1. Module may not be in CONFIG mode - check M0, M1 wiring")
        print("2. Try different AT command formats:")
        print("   - Some modules: AT (no \\r\\n)")
        print("   - Some modules: AT\\r\\n")
        print("   - Some modules: +++AT\\r\\n")
        print("3. Check if module needs delay after mode switch")
    else:
        print(f"\n✅ Module is working at the baud rate shown above!")

    GPIO.cleanup()

def test_sleep_mode_all_bauds():
    """
    Vì Sleep mode (M0=1, M1=1) đã phản hồi "ERROR",
    thử tất cả baud rates ở Sleep mode
    """
    setup_gpio()

    # Set SLEEP mode
    GPIO.output(M0_PIN, GPIO.HIGH)
    GPIO.output(M1_PIN, GPIO.HIGH)
    print("📡 Set to SLEEP mode (M0=1, M1=1)")
    time.sleep(0.5)

    print(f"\n🔍 Testing {len(BAUD_RATES)} baud rates in SLEEP mode...")
    print("=" * 70)

    for baud in BAUD_RATES:
        print(f"\n⚙️  Testing {baud} baud...")

        try:
            ser = serial.Serial(SERIAL_PORT, baud, timeout=1)
            ser.reset_input_buffer()
            ser.reset_output_buffer()

            ser.write(b"AT\r\n")
            time.sleep(0.8)

            response = ser.read(200).decode('utf-8', errors='ignore').strip()

            if response:
                print(f"   TX: AT")
                print(f"   RX: {response}")

                if "ERROR" in response:
                    print(f"   ⚠️  Got ERROR at {baud} baud")
                    print(f"   This might be the correct baud rate!")

                    # Try other commands
                    for cmd in ["AT+ADDRESS?", "AT", "+++", "AT+RST"]:
                        ser.reset_input_buffer()
                        ser.write((cmd + '\r\n').encode())
                        time.sleep(0.5)
                        resp = ser.read(200).decode('utf-8', errors='ignore').strip()
                        if resp and resp != "ERROR":
                            print(f"   CMD {cmd}: {resp}")

            ser.close()

        except Exception as e:
            print(f"   ❌ Error: {e}")

        time.sleep(0.3)

    GPIO.cleanup()

if __name__ == '__main__':
    import sys

    print("AS32-TTL-100 Baud Rate Detection Tool\n")

    if len(sys.argv) > 1 and sys.argv[1] == 'sleep':
        print("Testing in SLEEP mode (because it responded with ERROR)...\n")
        test_sleep_mode_all_bauds()
    else:
        print("Testing in CONFIG mode...\n")
        test_baud_rates()
        print("\nIf no success, try:")
        print("  python3 test-as32-baudrates.py sleep")
