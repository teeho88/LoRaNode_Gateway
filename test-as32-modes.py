#!/usr/bin/env python3
"""
Test AS32-TTL-100 với các mode khác nhau
"""
import RPi.GPIO as GPIO
import serial
import time

# GPIO Pin Definitions
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

def set_mode(mode_name, m0, m1):
    """Set module mode"""
    GPIO.output(M0_PIN, GPIO.HIGH if m0 else GPIO.LOW)
    GPIO.output(M1_PIN, GPIO.HIGH if m1 else GPIO.LOW)
    print(f"\n📡 Mode: {mode_name} (M0={m0}, M1={m1})")
    time.sleep(0.5)  # Wait for mode switch

def check_aux():
    """Check AUX pin state"""
    aux_state = GPIO.input(AUX_PIN)
    print(f"   AUX = {aux_state} ({'HIGH/Ready' if aux_state else 'LOW/Busy'})")
    return aux_state

def send_at_command(ser, command):
    """Send AT command and read response"""
    print(f"   TX: {command}")
    ser.reset_input_buffer()
    ser.write((command + '\r\n').encode())
    time.sleep(1)

    response = ser.read(200).decode('utf-8', errors='ignore').strip()
    print(f"   RX: {response if response else '(no response)'}")
    return response

def test_all_modes():
    """Test all AS32-TTL-100 modes"""
    setup_gpio()

    modes = [
        ("NORMAL (Transmit/Receive)", 0, 0),
        ("WOR (Wake on Radio)", 1, 0),
        ("CONFIG (AT Commands)", 0, 1),
        ("SLEEP (Deep Sleep)", 1, 1),
    ]

    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=2)
        print(f"✅ Serial port {SERIAL_PORT} opened at {BAUD_RATE} baud\n")
        print("=" * 60)

        for mode_name, m0, m1 in modes:
            set_mode(mode_name, m0, m1)
            check_aux()

            # Try AT command in each mode
            response = send_at_command(ser, "AT")

            if "+OK" in response or "OK" in response:
                print(f"   ✅ Module responds in {mode_name}!")
            elif response:
                print(f"   ⚠️  Got response: {repr(response)}")
            else:
                print(f"   ❌ No response in {mode_name}")

            print("-" * 60)

        ser.close()

    except serial.SerialException as e:
        print(f"❌ Serial error: {e}")
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        GPIO.cleanup()

def test_specific_mode(m0, m1):
    """Test a specific mode combination"""
    setup_gpio()

    mode_names = {
        (0, 0): "NORMAL",
        (1, 0): "WOR",
        (0, 1): "CONFIG",
        (1, 1): "SLEEP"
    }

    mode_name = mode_names.get((m0, m1), "UNKNOWN")

    try:
        set_mode(mode_name, m0, m1)
        check_aux()

        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=2)
        print(f"\n✅ Serial port opened\n")

        # Try multiple AT commands
        commands = ["AT", "AT+ADDRESS?", "AT+PARAMETER?", "AT+CHANNEL?"]

        for cmd in commands:
            response = send_at_command(ser, cmd)
            if "+OK" in response or "OK" in response:
                print(f"   ✅ Command successful!")
            time.sleep(0.5)

        ser.close()

    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        GPIO.cleanup()

if __name__ == '__main__':
    import sys

    print("AS32-TTL-100 Mode Testing Tool\n")

    if len(sys.argv) == 1:
        print("Testing all modes...\n")
        test_all_modes()
    elif len(sys.argv) == 3:
        m0 = int(sys.argv[1])
        m1 = int(sys.argv[2])
        print(f"Testing specific mode: M0={m0}, M1={m1}\n")
        test_specific_mode(m0, m1)
    else:
        print("Usage:")
        print("  python3 test-as32-modes.py           # Test all modes")
        print("  python3 test-as32-modes.py <M0> <M1> # Test specific mode")
        print("")
        print("Examples:")
        print("  python3 test-as32-modes.py 0 0  # Normal mode")
        print("  python3 test-as32-modes.py 0 1  # Config mode")
        print("  python3 test-as32-modes.py 1 1  # Sleep mode")
