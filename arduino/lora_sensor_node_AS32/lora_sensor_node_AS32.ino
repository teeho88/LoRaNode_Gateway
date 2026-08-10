/*
 * LoRa Sensor Node - Arduino Nano with AS32-TTL-100
 *
 * Hardware:
 * - Arduino Nano
 * - AS32-TTL-100 LoRa Module (UART based)
 * - DHT11 Temperature & Humidity Sensor
 * - Relay Module for Fan Control
 *
 * AS32-TTL-100 Connections (UART):
 * TX  -> D2 (Software Serial RX)
 * RX  -> D3 (Software Serial TX)
 * M0  -> GND (Normal mode, hardwired)
 * M1  -> GND (Normal mode, hardwired)
 *
 * Because M0/M1 are tied to GND the module can never be put into AT
 * configuration mode, so the radio profile below is fixed in hardware and the
 * gateway can only rename the node - it cannot retune the radio.
 * AUX -> D5 (optional, for status check)
 * VCC -> 5V
 * GND -> GND
 *
 * DHT11_1 -> D4 (Sensor 1)
 * DHT11_2 -> D6 (Sensor 2)
 * Relay -> D7
 *
 * Module Configuration:
 * - Frequency: 433MHz (Channel 23)
 * - Baud Rate: 9600 (default)
 * - Air Rate: 2.4kbps (for longer range)
 * - Transmission Power: 100mW (20dBm)
 * - UART Parity: 8N1
 */

#include <SoftwareSerial.h>
#include <DHT.h>
#include <ArduinoJson.h>
#include <EEPROM.h>

// Pin Definitions
#define DHT1_PIN 4     // First DHT11 sensor
#define DHT2_PIN 6     // Second DHT11 sensor
#define DHTTYPE DHT11
#define RELAY_PIN 7

// AS32-TTL-100 LoRa Module Pins
#define LORA_RX 2  // Arduino RX (connect to LoRa TX)
#define LORA_TX 3  // Arduino TX (connect to LoRa RX)
#define LORA_AUX 5 // Optional: AUX pin for transmission status

// M0/M1 are hardwired to GND on this board, so the module is permanently in
// normal mode and its radio parameters cannot be changed from the firmware.
// Set them with the vendor tool if the RF profile ever has to change.

// Node Configuration
#define DEFAULT_NODE_ID "KHO_B"
#define NODE_ID_MAX_LEN 15
#define NODE_UID_LEN 8
#define CONFIG_MAGIC 0x48544733UL // "HTG3"

// Thresholds
#define TEMP_HIGH_THRESHOLD 32.0
#define TEMP_LOW_THRESHOLD 15.0
#define HUM_HIGH_THRESHOLD 75.0
#define HUM_LOW_THRESHOLD 30.0

// Timing
#define SEND_INTERVAL 5000  // Send data every 5 seconds
#define READ_INTERVAL 2000  // Read sensor every 2 seconds

// Protocol markers
#define START_MARKER '<'
#define END_MARKER '>'

SoftwareSerial loraSerial(LORA_RX, LORA_TX);
DHT dht1(DHT1_PIN, DHTTYPE);  // First sensor
DHT dht2(DHT2_PIN, DHTTYPE);  // Second sensor

struct NodeConfig {
  uint32_t magic;
  char nodeId[NODE_ID_MAX_LEN + 1];
  char uid[NODE_UID_LEN + 1];
};

NodeConfig nodeConfig;
char nodeId[NODE_ID_MAX_LEN + 1] = DEFAULT_NODE_ID;
char nodeUid[NODE_UID_LEN + 1] = "";

unsigned long lastSendTime = 0;
unsigned long lastReadTime = 0;

// Sensor 1 data
float temperature1 = 0.0;
float humidity1 = 0.0;

// Sensor 2 data
float temperature2 = 0.0;
float humidity2 = 0.0;

// Average values (for relay control)
float avgTemperature = 0.0;
float avgHumidity = 0.0;

bool relayState = false;
bool manualControl = false;

void setup() {
  Serial.begin(9600);
  while (!Serial);

  Serial.println(F("LoRa Sensor Node (AS32-TTL-100) Initializing..."));

  // Initialize Relay
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);

  // Initialize AUX pin (optional)
  pinMode(LORA_AUX, INPUT);

  // Initialize DHT Sensors
  dht1.begin();
  dht2.begin();

  Serial.println(F("DHT11 Sensors initialized (2 sensors)"));

  // Initialize LoRa Module (9600 baud is default for AS32-TTL-100)
  loraSerial.begin(9600);
  delay(100);

  loadNodeConfig();

  Serial.println(F("LoRa Module Initialized!"));
  Serial.print(F("Node ID: "));
  Serial.println(nodeId);
  Serial.print(F("Node UID: "));
  Serial.println(nodeUid);
  Serial.println(F("Ready to send data..."));
}

void loop() {
  // Read sensor periodically
  if (millis() - lastReadTime >= READ_INTERVAL) {
    readSensors();

    // Auto control relay based on thresholds (only if not in manual mode)
    if (!manualControl) {
      autoControlRelay();
    }

    lastReadTime = millis();
  }

  // Send data periodically
  if (millis() - lastSendTime >= SEND_INTERVAL) {
    sendSensorData();
    lastSendTime = millis();
  }

  // Check for incoming commands
  receiveCommand();
}

void readSensors() {
  // Read from DHT11 Sensor 1
  humidity1 = dht1.readHumidity();
  temperature1 = dht1.readTemperature();

  // Read from DHT11 Sensor 2
  humidity2 = dht2.readHumidity();
  temperature2 = dht2.readTemperature();

  // Check if readings are valid
  bool sensor1Valid = !isnan(humidity1) && !isnan(temperature1);
  bool sensor2Valid = !isnan(humidity2) && !isnan(temperature2);

  if (!sensor1Valid && !sensor2Valid) {
    // Do not keep the previous average around: it would be reported as if it
    // were a fresh reading.
    avgTemperature = NAN;
    avgHumidity = NAN;
    Serial.println(F("Failed to read from both DHT sensors!"));
    return;
  }

  // Calculate average values (for relay control)
  if (sensor1Valid && sensor2Valid) {
    avgTemperature = (temperature1 + temperature2) / 2.0;
    avgHumidity = (humidity1 + humidity2) / 2.0;
  } else if (sensor1Valid) {
    avgTemperature = temperature1;
    avgHumidity = humidity1;
    Serial.println(F("Warning: Sensor 2 failed, using Sensor 1 only"));
  } else {
    avgTemperature = temperature2;
    avgHumidity = humidity2;
    Serial.println(F("Warning: Sensor 1 failed, using Sensor 2 only"));
  }

  // Print sensor readings
  Serial.println(F("--- Sensor Readings ---"));

  if (sensor1Valid) {
    Serial.print(F("Sensor 1 - Temp: "));
    Serial.print(temperature1);
    Serial.print(F("°C, Hum: "));
    Serial.print(humidity1);
    Serial.println(F("%"));
  } else {
    Serial.println(F("Sensor 1 - FAILED"));
  }

  if (sensor2Valid) {
    Serial.print(F("Sensor 2 - Temp: "));
    Serial.print(temperature2);
    Serial.print(F("°C, Hum: "));
    Serial.print(humidity2);
    Serial.println(F("%"));
  } else {
    Serial.println(F("Sensor 2 - FAILED"));
  }

  if (sensor1Valid && sensor2Valid) {
    Serial.print(F("Average - Temp: "));
    Serial.print(avgTemperature);
    Serial.print(F("°C, Hum: "));
    Serial.print(avgHumidity);
    Serial.println(F("%"));
  }
  Serial.println(F("---------------------"));
}

void autoControlRelay() {
  // Ensure both sensors are valid for this logic
  if (isnan(temperature1) || isnan(humidity1) || isnan(temperature2) || isnan(humidity2)) {
    Serial.println(F("Auto control: Cannot proceed - Sensor data missing"));
    return;
  }

  // Calculate Dew Points
  float td1 = calculateDewPoint(temperature1, humidity1);
  float td2 = calculateDewPoint(temperature2, humidity2);

  bool shouldActivate = false;

  // Logic Condition:
  // ( (Td1 < Td2 < t1) || (Td2 < Td1 < t2) ) && t2 <= 32 && h1 > h2
  
  bool condition1 = (td1 < td2 && td2 < temperature1);
  bool condition2 = (td2 < td1 && td1 < temperature2);
  bool tempCondition = (temperature2 <= 32);
  bool humCondition = (humidity1 > humidity2);

  if ((condition1 || condition2) && tempCondition && humCondition) {
    shouldActivate = true;
  }

  // Debug logging
  Serial.print(F("Auto Check | Td1: ")); Serial.print(td1);
  Serial.print(F(", Td2: ")); Serial.print(td2);
  Serial.print(F(" | Cond: ")); Serial.println(shouldActivate ? F("PASS") : F("FAIL"));

  if (shouldActivate != relayState) {
    setRelay(shouldActivate);
    Serial.print(F("Auto control: Fan turned "));
    Serial.println(shouldActivate ? F("ON") : F("OFF"));
  }
}

// Calculate Dew Point: Td = t - (100 - h)/5
float calculateDewPoint(float t, float h) {
  return t - (100.0 - h) / 5.0;
}

void setRelay(bool state) {
  relayState = state;
  digitalWrite(RELAY_PIN, state ? HIGH : LOW);
}

// Writes a rounded reading, or JSON null when the sensor did not answer.
// Never pass NAN to round(): on AVR it yields LONG_MIN, which serializes as
// -2.147484e8 and both corrupts the value and bloats the packet.
void putReading(JsonDocument &doc, const char* key, float value) {
  if (isnan(value)) {
    doc[key] = nullptr;
  } else {
    doc[key] = round(value * 10) / 10.0;  // Round to 1 decimal
  }
}

void sendSensorData() {
  // Keep transmitting even when the sensors are dead: the packet is what tells
  // the gateway this node is still alive, and null marks the broken readings.
  StaticJsonDocument<360> doc;
  doc["id"] = nodeId;
  doc["uid"] = nodeUid;

  // Sensor 1 data
  putReading(doc, "temp1", temperature1);
  putReading(doc, "hum1", humidity1);

  // Sensor 2 data
  putReading(doc, "temp2", temperature2);
  putReading(doc, "hum2", humidity2);

  // Average values
  putReading(doc, "temp", avgTemperature);
  putReading(doc, "hum", avgHumidity);

  doc["relay"] = relayState;
  doc["manual"] = manualControl;

  // Serialize to string
  String jsonString;
  serializeJson(doc, jsonString);

  // Send via LoRa with markers for packet framing
  sendLoRaMessage(jsonString);

  Serial.print(F("Sent: "));
  Serial.println(jsonString);
}

void sendLoRaMessage(String message) {
  // Wait for AUX to be HIGH (module ready)
  waitForAux();

  // Send message with start and end markers
  loraSerial.print(START_MARKER);
  loraSerial.print(message);
  loraSerial.print(END_MARKER);

  // Wait for transmission to complete
  delay(50);
}

void receiveCommand() {
  static String receivedData = "";
  static bool receiving = false;

  while (loraSerial.available() > 0) {
    char c = loraSerial.read();

    if (c == START_MARKER) {
      receiving = true;
      receivedData = "";
    }
    else if (c == END_MARKER && receiving) {
      receiving = false;
      processCommand(receivedData);
      receivedData = "";
    }
    else if (receiving) {
      receivedData += c;

      // Prevent buffer overflow
      if (receivedData.length() > 320) {
        receiving = false;
        receivedData = "";
      }
    }
  }
}

void processCommand(String received) {
  Serial.print(F("Received command: "));
  Serial.println(received);

  // Parse JSON command
  StaticJsonDocument<384> doc;
  DeserializationError error = deserializeJson(doc, received);

  if (error) {
    Serial.print(F("JSON parsing failed: "));
    Serial.println(error.c_str());
    return;
  }

  // Check if command is for this node
  const char* targetId = doc["target"];
  const char* targetUid = doc["targetUid"];
  bool uidMatches = targetUid && strcmp(targetUid, nodeUid) == 0;
  bool idMatches = !targetUid && targetId && (strcmp(targetId, nodeId) == 0 || strcmp(targetId, "ALL") == 0);

  if (!uidMatches && !idMatches) {
    return;  // Command not for this node
  }

  if (doc.containsKey("config")) {
    processConfigCommand(doc["config"].as<JsonObject>());
    return;
  }

  // Process command
  if (doc.containsKey("relay")) {
    bool newState = doc["relay"];
    setRelay(newState);
    manualControl = true;
    Serial.print(F("Manual control: Fan turned "));
    Serial.println(newState ? F("ON") : F("OFF"));

    // Send acknowledgment
    sendAcknowledgment(newState);
  }

  if (doc.containsKey("auto")) {
    manualControl = !doc["auto"].as<bool>();
    Serial.print(F("Control mode: "));
    Serial.println(manualControl ? F("Manual") : F("Auto"));
  }
}

void sendAcknowledgment(bool state) {
  StaticJsonDocument<200> doc;
  doc["id"] = nodeId;
  doc["uid"] = nodeUid;
  doc["ack"] = true;
  doc["relay"] = state;

  String jsonString;
  serializeJson(doc, jsonString);

  delay(100);  // Small delay before sending
  sendLoRaMessage(jsonString);

  Serial.print(F("Sent ACK: "));
  Serial.println(jsonString);
}

void loadNodeConfig() {
  EEPROM.get(0, nodeConfig);

  if (nodeConfig.magic != CONFIG_MAGIC || nodeConfig.nodeId[0] == '\0') {
    nodeConfig.magic = CONFIG_MAGIC;
    strncpy(nodeConfig.nodeId, DEFAULT_NODE_ID, NODE_ID_MAX_LEN);
    nodeConfig.nodeId[NODE_ID_MAX_LEN] = '\0';
    generateNodeUid(nodeConfig.uid);
    saveNodeConfig();
  }

  strncpy(nodeId, nodeConfig.nodeId, NODE_ID_MAX_LEN);
  nodeId[NODE_ID_MAX_LEN] = '\0';
  strncpy(nodeUid, nodeConfig.uid, NODE_UID_LEN);
  nodeUid[NODE_UID_LEN] = '\0';
}

void saveNodeConfig() {
  EEPROM.put(0, nodeConfig);
}

void generateNodeUid(char* buffer) {
  randomSeed(analogRead(A0) ^ micros());

  for (int i = 0; i < NODE_UID_LEN; i++) {
    byte value = random(0, 16);
    buffer[i] = value < 10 ? char('0' + value) : char('A' + value - 10);
  }

  buffer[NODE_UID_LEN] = '\0';
}

void processConfigCommand(JsonObject config) {
  char oldId[NODE_ID_MAX_LEN + 1];
  strncpy(oldId, nodeId, NODE_ID_MAX_LEN);
  oldId[NODE_ID_MAX_LEN] = '\0';

  if (!config.containsKey("id")) {
    sendConfigAcknowledgment(oldId, "No node ID supplied");
    return;
  }

  const char* newId = config["id"];
  if (!newId || strlen(newId) == 0 || strlen(newId) > NODE_ID_MAX_LEN) {
    sendConfigAcknowledgment(oldId, "Node ID must be 1-15 characters");
    return;
  }

  strncpy(nodeConfig.nodeId, newId, NODE_ID_MAX_LEN);
  nodeConfig.nodeId[NODE_ID_MAX_LEN] = '\0';
  strncpy(nodeId, nodeConfig.nodeId, NODE_ID_MAX_LEN);
  nodeId[NODE_ID_MAX_LEN] = '\0';

  saveNodeConfig();

  Serial.print(F("Config updated. Old ID: "));
  Serial.print(oldId);
  Serial.print(F(", New ID: "));
  Serial.println(nodeId);

  sendConfigAcknowledgment(oldId, "Node ID saved");
}

void sendConfigAcknowledgment(const char* oldId, const char* message) {
  StaticJsonDocument<200> doc;
  doc["id"] = nodeId;
  doc["uid"] = nodeUid;
  doc["oldId"] = oldId;
  doc["ack"] = true;
  doc["configAck"] = true;
  doc["message"] = message;

  String jsonString;
  serializeJson(doc, jsonString);

  delay(100);
  sendLoRaMessage(jsonString);

  Serial.print(F("Sent CONFIG ACK: "));
  Serial.println(jsonString);
}

void waitForAux() {
  // Wait for AUX pin to go HIGH (module ready to send)
  unsigned long startTime = millis();
  while (digitalRead(LORA_AUX) == LOW) {
    if (millis() - startTime > 1000) {
      // Timeout after 1 second
      break;
    }
    delay(10);
  }
}

