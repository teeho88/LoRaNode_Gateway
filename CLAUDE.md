# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LoRa-based IoT sensor monitoring and control system with Arduino sensor nodes and a Node.js gateway server optimized for **Raspberry Pi 4**. The system monitors temperature and humidity (DHT11), automatically controls relays (ventilation fans), and supports remote control via LoRa communication (SX1278). Features real-time web dashboard with WebSocket support.

## Project Structure

```
.
├── arduino/                    # Arduino sensor node code
│   ├── lora_sensor_node.ino   # Main Arduino sketch
│   └── README.md              # Arduino setup guide
├── src/
│   └── server.js              # Gateway server (Express + SerialPort + Socket.IO)
├── public/                    # Web dashboard (static files)
│   ├── index.html             # Dashboard HTML
│   ├── style.css              # Dashboard styles
│   └── app.js                 # Dashboard client JS (WebSocket)
├── data/                      # Persistent storage directory
│   └── daily-stats.json       # Daily statistics backup
├── .env                       # Environment configuration (not in git)
├── .env.example              # Environment template
├── package.json              # Node.js dependencies
├── README.md                 # Full documentation
├── windows-setup.md          # Windows testing guide
└── raspberry-pi-setup.md     # RPi installation guide
```

## Commands

### Development
```bash
npm start              # Start gateway server
npm run dev           # Start with nodemon (auto-reload)
```

### Setup
```bash
npm install           # Install dependencies
cp .env.example .env  # Create environment config
```

### Testing API
Use [test-api.http](test-api.http) with REST Client extension in VS Code, or use curl/Postman to test all endpoints.

## Architecture

### Data Flow
1. **Arduino Node** (sensor) → reads DHT11 → packs JSON → transmits via LoRa SX1278
2. **LoRa Gateway** (hardware) → receives LoRa → forwards to Raspberry Pi via serial USB
3. **Node.js Server (RPi)** → parses serial data → stores in memory → broadcasts via WebSocket → exposes REST API
4. **Web Dashboard** → connects via WebSocket → receives real-time updates → sends control commands
5. **Control Flow**: Dashboard/API → Node.js → serial → LoRa Gateway → Arduino Node → relay action

### Key Components

**Arduino Node** ([arduino/lora_sensor_node.ino](arduino/lora_sensor_node.ino)):
- SPI communication with LoRa module (433MHz, SF7, BW125kHz)
- DHT11 sensor reading (2s interval)
- Auto relay control based on thresholds (temp > 32°C or hum > 75%)
- Bi-directional LoRa communication (JSON packets)
- Manual/Auto mode switching

**Gateway Server** ([src/server.js](src/server.js)):
- SerialPort listener for LoRa gateway data
- In-memory storage optimized for Raspberry Pi (configurable MAX_HISTORY)
- Socket.IO WebSocket server for real-time updates
- REST API endpoints for monitoring and control
- Command transmission via serial port
- System monitoring (memory usage, uptime, connected clients)

**Web Dashboard** ([public/](public/)):
- Vanilla JS + Socket.IO client (no frameworks for lightweight performance)
- Real-time sensor data display with auto-refresh
- Interactive relay control buttons (ON/OFF/AUTO)
- Canvas-based charts for temperature/humidity history
- System logs viewer
- Responsive design for mobile access

### Data Formats

**Sensor Data** (Node → Gateway):
```json
{
  "id": "KHO_A",
  "temp": 32.5,
  "hum": 70.0,
  "relay": true,
  "manual": false
}
```

**Control Command** (Gateway → Node):
```json
{
  "target": "KHO_A",
  "relay": true,
  "auto": false
}
```

**Acknowledgment**:
```json
{
  "id": "KHO_A",
  "ack": true,
  "relay": true
}
```

## Hardware Configuration

### Arduino Nano Pinout
- **LoRa SX1278**: NSS(D10), MOSI(D11), MISO(D12), SCK(D13), RST(D9), DIO0(D2)
- **DHT11**: DATA(D4), VCC(5V), GND
- **Relay**: IN(D7), VCC(5V), GND

### Serial Port Configuration
Configure in `.env`:
- **Raspberry Pi**: `SERIAL_PORT=/dev/ttyUSB0` or `/dev/ttyAMA0`
- Windows (testing): `SERIAL_PORT=COM3`
- Linux: `SERIAL_PORT=/dev/ttyUSB0`
- Mac: `SERIAL_PORT=/dev/cu.usbserial-*`

### Raspberry Pi Deployment
- Default serial port: `/dev/ttyUSB0`
- Memory optimization: `MAX_HISTORY=500` (adjustable based on RAM)
- Server listens on `0.0.0.0:3000` for network access
- Systemd service for auto-start on boot
- See [raspberry-pi-setup.md](raspberry-pi-setup.md) for complete setup

## API Endpoints

```
GET  /                       # Web Dashboard (static HTML)
GET  /api/nodes              # All nodes latest data
GET  /api/nodes/:id          # Specific node data
GET  /api/history            # Historical data (query: nodeId, limit)
POST /api/control/relay      # Control relay (body: target, relay, auto)
GET  /api/status             # System status (includes memory, uptime, clients)
GET  /health                 # Health check
WS   /socket.io              # WebSocket connection for real-time updates
```

### WebSocket Events
```javascript
// Client → Server
socket.emit('controlRelay', { target: 'KHO_A', relay: true })

// Server → Client
socket.on('initialData', { nodes: [...], history: [...] })
socket.on('sensorData', { id, temp, hum, relay, ... })
socket.on('commandAck', { nodeId, relay })
socket.on('commandSent', { success, command })
socket.on('commandError', { success, message })
```

## Development Workflow

### Adding New Node
1. Clone Arduino code, change `NODE_ID` (e.g., "KHO_B")
2. Adjust thresholds if needed (`TEMP_HIGH_THRESHOLD`, `HUM_HIGH_THRESHOLD`)
3. Upload to new Arduino Nano
4. Gateway automatically recognizes new node ID

### Modifying Thresholds
Edit Arduino code constants:
```cpp
#define TEMP_HIGH_THRESHOLD 32.0
#define HUM_HIGH_THRESHOLD 75.0
```

### Changing LoRa Frequency
Match frequency across all nodes and gateway:
```cpp
#define LORA_FREQUENCY 433E6  // 433MHz (Asia)
// 868E6 (Europe), 915E6 (Americas)
```

### Testing Serial Communication
Use Serial Monitor (9600 baud) to verify Arduino is sending data, then check Node.js server logs for reception.

## Key Dependencies

**Node.js (Gateway)**:
- **serialport**: USB serial communication with LoRa gateway
- **express**: REST API server
- **socket.io**: WebSocket server for real-time updates
- **cors**: Cross-origin resource sharing
- **dotenv**: Environment configuration

**Arduino Libraries** (install via Library Manager):
- LoRa (Sandeep Mistry)
- DHT sensor library (Adafruit)
- ArduinoJson (Benoit Blanchon)

## Performance & Optimization

### Raspberry Pi 4 Capacity
- **2GB RAM**: 20-30 nodes, MAX_HISTORY=500, ~150-200MB RAM
- **4GB RAM**: 50+ nodes, MAX_HISTORY=1000, stable performance
- CPU idle: ~5-10%, response time: <100ms

### Memory Optimization
- History limited by `MAX_HISTORY` env variable (default 500)
- Only latest 50 records sent to new WebSocket clients
- Dashboard chart limited to 100 data points
- Hybrid storage: in-memory for speed + JSON file for persistence

### Data Persistence (Hybrid Storage)
- **In-memory**: sensorData (latest), dataHistory (recent 500), for real-time performance
- **SD card/Disk**: dailyStats persisted to `data/daily-stats.json`
- **Backup schedule**: Hourly automatic + on shutdown (SIGINT/SIGTERM)
- **Data retention**: 30 days auto-cleanup at midnight
- **Recovery**: Auto-load from JSON on server startup
- **Why JSON not SQLite**: Small data size (~1MB), simple queries, SD card friendly (less writes)

### Network Optimization
- WebSocket for real-time data (no polling)
- Static file serving with Express
- CORS enabled for API access from external clients

## Development Workflow

### Testing on Windows (Recommended First Step)
Before deploying to Raspberry Pi, test everything on Windows for faster debugging:
1. Install Node.js from https://nodejs.org/
2. Connect Arduino via USB → check Device Manager for COM port (COM3, COM4, etc.)
3. Create `.env` with `SERIAL_PORT=COM3` (replace with your port)
4. Upload Arduino code via Arduino IDE
5. Run `npm start` and access http://localhost:3000
6. Test all features: real-time data, relay control, charts, filters, persistence
7. See **[windows-setup.md](windows-setup.md)** for detailed guide

### Deploying to Raspberry Pi
After successful Windows testing:
1. Copy project to RPi via SCP/git
2. Update `.env` to use `/dev/ttyUSB0` instead of COM port
3. Setup systemd service for auto-start
4. See **[raspberry-pi-setup.md](raspberry-pi-setup.md)** for complete guide

## Notes

- **Windows COM ports**: COM3, COM4, etc. (check Device Manager)
- **Linux/RPi serial ports**: /dev/ttyUSB0, /dev/ttyAMA0, /dev/ttyACM0
- Serial port permissions on Linux/RPi: `sudo usermod -a -G dialout $USER` (logout required)
- LoRa range: ~2km line-of-sight (depends on environment)
- Data transmission interval: 5 seconds (configurable in Arduino code)
- Dashboard accessible from any device on same network
- No authentication implemented - add auth middleware for production use
- For Raspberry Pi deployment, use systemd service for auto-start (see raspberry-pi-setup.md)
- **Persistent data location**: `data/daily-stats.json` (auto-created on first run)
