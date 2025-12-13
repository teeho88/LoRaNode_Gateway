#!/usr/bin/env python3
"""
Configure AS32-TTL-100 LoRa module via Raspberry Pi GPIO UART

Hardware connections:
- AS32 TXD → RPi GPIO 15 (RXD/Pin 10)
- AS32 RXD → RPi GPIO 14 (TXD/Pin 8)
- AS32 M0  → RPi GPIO 23 (Pin 16)
- AS32 M1  → RPi GPIO 24 (Pin 18)
- AS32 AUX → RPi GPIO 18 (Pin 12)
- AS32 VCC → RPi 5V (Pin 2 or 4)
- AS32 GND → RPi GND (Pin 6, 9, 14, etc.)
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
    print(f"📡 Mode set to: {mode_names[mode]} (M0={'HIGH' if m0 else 'LOW'}, M1={'HIGH' if m1 else 'LOW'})")

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
        print("\nTroubleshooting:")
        print("1. Check UART is enabled: ls -la /dev/ttyAMA0")
        print("2. Check Bluetooth is disabled: cat /boot/config.txt | grep disable-bt")
        print("3. Check permissions: sudo usermod -a -G dialout $USER")
        print("4. Check wiring: TXD→GPIO15, RXD→GPIO14, M0→GPIO23, M1→GPIO24")
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

        buffer = ''
        while True:
            if ser.in_waiting > 0:
                data = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
                buffer += data

                # Look for complete packets with < > markers
                while '<' in buffer and '>' in buffer:
                    start = buffer.index('<')
                    end = buffer.index('>')
                    if start < end:
                        packet = buffer[start:end+1]
                        print(f"📥 Received: {packet}")
                        buffer = buffer[end+1:]
                    else:
                        buffer = buffer[end+1:]

            time.sleep(0.1)

    except KeyboardInterrupt:
        print("\n👋 Stopped")
    except serial.SerialException as e:
        print(f"❌ Serial error: {e}")
        print("\nTroubleshooting:")
        print("1. Check UART is enabled: ls -la /dev/ttyAMA0")
        print("2. Check Bluetooth is disabled: cat /boot/config.txt | grep disable-bt")
        print("3. Check permissions: groups (should include 'dialout')")
        print("4. If not in dialout group: sudo usermod -a -G dialout $USER, then logout/login")
    finally:
        if 'ser' in locals():
            ser.close()
        GPIO.cleanup()

def check_system():
    """Check system configuration for UART"""
    print("🔍 Checking Raspberry Pi UART configuration...\n")

    import os
    import subprocess

    # Check if /dev/ttyAMA0 exists
    if os.path.exists('/dev/ttyAMA0'):
        print("✅ /dev/ttyAMA0 exists")
    else:
        print("❌ /dev/ttyAMA0 not found")
        print("   Run: sudo raspi-config → Interface Options → Serial Port")

    # Check if user is in dialout group
    try:
        result = subprocess.run(['groups'], capture_output=True, text=True)
        if 'dialout' in result.stdout:
            print("✅ User is in 'dialout' group")
        else:
            print("❌ User NOT in 'dialout' group")
            print("   Run: sudo usermod -a -G dialout $USER")
            print("   Then logout and login again")
    except:
        pass

    # Check if enable_uart is set
    try:
        with open('/boot/config.txt', 'r') as f:
            config = f.read()
            if 'enable_uart=1' in config:
                print("✅ UART enabled in /boot/config.txt")
            else:
                print("⚠️  UART may not be enabled")
                print("   Add 'enable_uart=1' to /boot/config.txt")
    except:
        print("⚠️  Cannot read /boot/config.txt")

    # Check if Bluetooth is disabled
    try:
        with open('/boot/config.txt', 'r') as f:
            config = f.read()
            if 'dtoverlay=disable-bt' in config:
                print("✅ Bluetooth disabled (UART available)")
            else:
                print("⚠️  Bluetooth may be using UART")
                print("   Add 'dtoverlay=disable-bt' to /boot/config.txt")
    except:
        pass

    print("\n📋 If any checks failed, see: raspberry-pi-gpio-uart-setup.md")

if __name__ == '__main__':
    import sys

    if len(sys.argv) < 2:
        print("AS32-TTL-100 Configuration Tool")
        print("\nUsage:")
        print("  python3 config_as32.py config   # Configure module with AT commands")
        print("  python3 config_as32.py test     # Test serial communication")
        print("  python3 config_as32.py check    # Check system configuration")
        print("\nExample:")
        print("  python3 config_as32.py check    # Check UART setup first")
        print("  python3 config_as32.py config   # Configure the module")
        print("  python3 config_as32.py test     # Test receiving data")
        sys.exit(1)

    command = sys.argv[1]

    if command == 'config':
        configure_module()
    elif command == 'test':
        test_communication()
    elif command == 'check':
        check_system()
    else:
        print(f"Unknown command: {command}")
        print("Use: config, test, or check")
