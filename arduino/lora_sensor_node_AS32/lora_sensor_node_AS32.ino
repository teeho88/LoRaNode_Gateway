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
 * M0  -> GND (Normal mode)
 * M1  -> GND (Normal mode)
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

// Pin Definitions
#define DHT1_PIN 4     // First DHT11 sensor
#define DHT2_PIN 6     // Second DHT11 sensor
#define DHTTYPE DHT11
#define RELAY_PIN 7

// AS32-TTL-100 LoRa Module Pins
#define LORA_RX 2  // Arduino RX (connect to LoRa TX)
#define LORA_TX 3  // Arduino TX (connect to LoRa RX)
#define LORA_AUX 5 // Optional: AUX pin for transmission status

// Node Configuration
#define NODE_ID "KHO_A"

// Thresholds
#define TEMP_HIGH_THRESHOLD 32.0
#define TEMP_LOW_THRESHOLD 15.0
#define HUM_HIGH_THRESHOLD 75.0
#define HUM_LOW_THRESHOLD 30.0

// Timing
#define SEND_INTERVAL 5000  // Send data every 5 seconds
#define READ_INTERVAL 2000  // Read sensor every 2 seconds

// AS32-TTL-100 Configuration
#define LORA_CHANNEL 23     // Channel 23 = 433MHz
#define LORA_ADDRESS 0x0001 // Module address (0x0000 - 0xFFFF)
#define LORA_NETID 0x00     // Network ID (0x00 - 0xFF)

// Protocol markers
#define START_MARKER '<'
#define END_MARKER '>'

SoftwareSerial loraSerial(LORA_RX, LORA_TX);
DHT dht1(DHT1_PIN, DHTTYPE);  // First sensor
DHT dht2(DHT2_PIN, DHTTYPE);  // Second sensor

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

  // Note: For first-time setup, you may need to configure the module
  // using AT commands. See configureLoRaModule() function below.
  // Uncomment the next line if you need to configure the module:
  // configureLoRaModule();

  Serial.println(F("LoRa Module Initialized!"));
  Serial.print(F("Node ID: "));
  Serial.println(NODE_ID);
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
  bool shouldActivate = false;

  // Check if average temperature or humidity exceeds thresholds
  if (avgTemperature > TEMP_HIGH_THRESHOLD || avgHumidity > HUM_HIGH_THRESHOLD) {
    shouldActivate = true;
  }

  if (shouldActivate != relayState) {
    setRelay(shouldActivate);
    Serial.print(F("Auto control: Fan turned "));
    Serial.println(shouldActivate ? F("ON") : F("OFF"));
  }
}

void setRelay(bool state) {
  relayState = state;
  digitalWrite(RELAY_PIN, state ? HIGH : LOW);
}

void sendSensorData() {
  // Create JSON document (increased size for 2 sensors)
  StaticJsonDocument<300> doc;
  doc["id"] = NODE_ID;

  // Sensor 1 data
  doc["temp1"] = round(temperature1 * 10) / 10.0;  // Round to 1 decimal
  doc["hum1"] = round(humidity1 * 10) / 10.0;

  // Sensor 2 data
  doc["temp2"] = round(temperature2 * 10) / 10.0;
  doc["hum2"] = round(humidity2 * 10) / 10.0;

  // Average values
  doc["temp"] = round(avgTemperature * 10) / 10.0;
  doc["hum"] = round(avgHumidity * 10) / 10.0;

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
      if (receivedData.length() > 200) {
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
  StaticJsonDocument<200> doc;
  DeserializationError error = deserializeJson(doc, received);

  if (error) {
    Serial.print(F("JSON parsing failed: "));
    Serial.println(error.c_str());
    return;
  }

  // Check if command is for this node
  const char* targetId = doc["target"];
  if (strcmp(targetId, NODE_ID) != 0 && strcmp(targetId, "ALL") != 0) {
    return;  // Command not for this node
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
  doc["id"] = NODE_ID;
  doc["ack"] = true;
  doc["relay"] = state;

  String jsonString;
  serializeJson(doc, jsonString);

  delay(100);  // Small delay before sending
  sendLoRaMessage(jsonString);

  Serial.print(F("Sent ACK: "));
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

// Optional: Configure LoRa module with AT commands
// Call this function in setup() if you need to configure the module
void configureLoRaModule() {
  Serial.println(F("Configuring LoRa Module..."));

  // Enter configuration mode by setting M0 and M1 HIGH
  // You need to connect M0 and M1 pins to Arduino and control them
  // or manually set them HIGH during configuration

  // Example AT commands for AS32-TTL-100:
  // AT+ADDRESS=0001     // Set address
  // AT+NETWORKID=00     // Set network ID
  // AT+PARAMETER=9,5,0  // Set baud rate, air rate, power
  // AT+CHANNEL=23       // Set channel (433MHz)

  delay(500);

  // Set address (0x0001)
  loraSerial.println(F("AT+ADDRESS=0001"));
  delay(200);
  readLoRaResponse();

  // Set network ID (0x00)
  loraSerial.println(F("AT+NETWORKID=00"));
  delay(200);
  readLoRaResponse();

  // Set parameters: 9600 baud, 2.4k air rate, 20dBm power
  loraSerial.println(F("AT+PARAMETER=9,5,0"));
  delay(200);
  readLoRaResponse();

  // Set channel 23 (433MHz)
  loraSerial.println(F("AT+CHANNEL=23"));
  delay(200);
  readLoRaResponse();

  // Save and reset
  loraSerial.println(F("AT+SAVE"));
  delay(500);
  readLoRaResponse();

  Serial.println(F("Configuration complete!"));

  // Note: After configuration, set M0 and M1 back to LOW (Normal mode)
}

void readLoRaResponse() {
  delay(100);
  while (loraSerial.available()) {
    char c = loraSerial.read();
    Serial.write(c);
  }
  Serial.println();
}
