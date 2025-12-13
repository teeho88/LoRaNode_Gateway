#!/usr/bin/env python3
"""
Set AS32-TTL-100 to NORMAL mode (M0=0, M1=0)
Used by systemd service before starting Node.js server
"""
import RPi.GPIO as GPIO
import time

M0_PIN = 23
M1_PIN = 24

try:
    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)
    GPIO.setup(M0_PIN, GPIO.OUT)
    GPIO.setup(M1_PIN, GPIO.OUT)

    # Normal mode: M0=0, M1=0
    GPIO.output(M0_PIN, GPIO.LOW)
    GPIO.output(M1_PIN, GPIO.LOW)

    print("✅ AS32-TTL-100 set to NORMAL mode (M0=0, M1=0)")
    time.sleep(0.2)  # Give module time to switch mode

except Exception as e:
    print(f"⚠️  Failed to set GPIO: {e}")
    print("   Module must be in normal mode manually (M0→GND, M1→GND)")
finally:
    # Don't cleanup - leave pins in LOW state for Node.js to use
    pass
