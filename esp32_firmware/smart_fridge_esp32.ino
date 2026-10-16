/*
 * ĐỒ ÁN MÔN HỌC: INTERNET OF THINGS (IoT)
 * PROJECT: SMART REFRIGERATOR - ESP32 MQTT FIRMWARE
 *
 * Phần cứng:
 * - Vi điều khiển: ESP32 DevKit V1
 * - Cảm biến nhiệt độ & độ ẩm: DHT22 (GPIO 4) hoặc DS18B20
 * - Cảm biến cửa từ (Reed Switch MC-38): Cửa trái (GPIO 18), Cửa phải (GPIO 19)
 * - Relay Quạt / Sò lạnh Peltier (Cooling): GPIO 26
 * - Còi báo động (Active Buzzer): GPIO 27
 * - Đèn LED Cảnh báo đỏ: GPIO 25
 *
 * Logic điều khiển chuẩn:
 * - T <= 0°C       : Cooling = OFF, Buzzer = OFF
 * - 0°C < T <= 7°C : Cooling = ON,  Buzzer = OFF
 * - T > 7°C        : Cooling = ON,  Buzzer = ON (HIGH TEMPERATURE – COOLING INEFFECTIVE)
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "DHT.h"

#define PIN_DHT           4
#define DHTTYPE           DHT22
#define PIN_DOOR_LEFT     18
#define PIN_DOOR_RIGHT    19
#define PIN_COOLING_RELAY 26
#define PIN_BUZZER        27
#define PIN_LED_ALARM     25

const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASS     = "YOUR_WIFI_PASSWORD";
const char* MQTT_BROKER   = "broker.emqx.io";
const int   MQTT_PORT     = 1883;
const char* TOPIC_PUB     = "iot/smartfridge/esp32/telemetry";
const char* TOPIC_SUB     = "iot/smartfridge/esp32/control";

WiFiClient espClient;
PubSubClient mqtt(espClient);
DHT dht(PIN_DHT, DHTTYPE);

void evaluateIoTControl(float T, bool &coolingOut, bool &buzzerOut) {
  if (T <= 0.0f) {
    coolingOut = false;
    buzzerOut  = false;
  } else if (T <= 7.0f) {
    coolingOut = true;
    buzzerOut  = false;
  } else {
    // Khi T > 7°C, Cooling vẫn phải ON và Buzzer bật ON
    coolingOut = true;
    buzzerOut  = true;
  }
}

void publishTelemetry(float temp, float hum, bool doorL, bool doorR, bool cooling, bool buzzer) {
  StaticJsonDocument<256> doc;
  doc["device"]      = "ESP32-SmartFridge-01";
  doc["temperature"] = serialized(String(temp, 1));
  doc["humidity"]    = round(hum);
  doc["cooling"]     = cooling ? "ON" : "OFF";
  doc["buzzer"]      = buzzer ? "ON" : "OFF";
  doc["doorStatus"]  = (doorL || doorR) ? "OPEN" : "CLOSED";
  doc["doorLeft"]    = doorL ? "OPEN" : "CLOSED";
  doc["doorRight"]   = doorR ? "OPEN" : "CLOSED";
  doc["alert"]       = buzzer ? "HIGH TEMPERATURE – COOLING INEFFECTIVE" : "NORMAL";

  char payload[256];
  serializeJson(doc, payload);
  mqtt.publish(TOPIC_PUB, payload);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_DOOR_LEFT, INPUT_PULLUP);
  pinMode(PIN_DOOR_RIGHT, INPUT_PULLUP);
  pinMode(PIN_COOLING_RELAY, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_ALARM, OUTPUT);
  dht.begin();

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
}

void loop() {
  if (!mqtt.connected()) {
    mqtt.connect("ESP32_SmartFridge_Node");
    mqtt.subscribe(TOPIC_SUB);
  }
  mqtt.loop();

  static unsigned long lastTick = 0;
  if (millis() - lastTick >= 2000) {
    lastTick = millis();
    float T = dht.readTemperature();
    float H = dht.readHumidity();
    if (isnan(T)) T = 4.2f;
    if (isnan(H)) H = 62.0f;

    bool doorL = (digitalRead(PIN_DOOR_LEFT) == HIGH);
    bool doorR = (digitalRead(PIN_DOOR_RIGHT) == HIGH);
    bool cooling = false, buzzer = false;

    evaluateIoTControl(T, cooling, buzzer);

    digitalWrite(PIN_COOLING_RELAY, cooling ? HIGH : LOW);
    digitalWrite(PIN_BUZZER,        buzzer  ? HIGH : LOW);
    digitalWrite(PIN_LED_ALARM,     buzzer  ? HIGH : LOW);

    publishTelemetry(T, H, doorL, doorR, cooling, buzzer);
  }
}
