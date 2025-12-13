#!/bin/bash
# Install dependencies for Raspberry Pi with GPIO UART connection

echo "========================================"
echo "Installing Raspberry Pi Dependencies"
echo "========================================"

# Update package list
echo ""
echo "📦 Updating package list..."
sudo apt-get update

# Install Node.js dependencies
echo ""
echo "📦 Installing Node.js project dependencies..."
npm install

# Install GPIO library for Node.js
echo ""
echo "📦 Installing onoff (GPIO control library)..."
npm install onoff

# Install Python GPIO libraries (for configuration scripts)
echo ""
echo "📦 Installing Python GPIO libraries..."
sudo apt-get install -y python3-rpi.gpio python3-serial

# Install minicom for serial port testing (optional)
echo ""
echo "📦 Installing minicom (serial port testing tool)..."
sudo apt-get install -y minicom

# Add user to dialout and gpio groups
echo ""
echo "👤 Adding user to dialout and gpio groups..."
sudo usermod -a -G dialout $USER
sudo usermod -a -G gpio $USER

echo ""
echo "✅ Installation complete!"
echo ""
echo "⚠️  IMPORTANT: You must LOGOUT and LOGIN again for group changes to take effect!"
echo ""
echo "Next steps:"
echo "1. Logout and login again (or reboot)"
echo "2. Run: python3 config_as32.py config    # Configure AS32-TTL-100 module"
echo "3. Run: python3 config_as32.py test      # Test serial communication"
echo "4. Run: npm start                        # Start the gateway server"
echo ""
echo "For systemd service setup, see: raspberry-pi-gpio-uart-setup.md"
