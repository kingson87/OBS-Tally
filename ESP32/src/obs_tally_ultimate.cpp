/*
 * ESP32 OBS Tally Light System - Ultimate Edition v2.0.0
 * 
 * CLEAN UPLOAD VERSION - Ready for deployment
 * 
 * Features:
 * - WiFi configuration portal with auto-discovery
 * - Built-in web server for device management
 * - Real-time tally status display with smooth animations
 * - Automatic device registration and heartbeat
 * - OTA (Over-The-Air) firmware updates
 * - Comprehensive error handling and diagnostics
 * - mDNS support for network discovery
 * - UDP device announcement system
 * - Persistent configuration storage
 * - Advanced firmware management and partition handling
 * 
 * Hardware: ESP32-1732S019 (ESP32-S3, 1.9" 170x320 Display)
 * 
 * Upload Instructions:
 * 1. Set Board: "ESP32S3 Dev Module" 
 * 2. Set Partition Scheme: "Default 4MB with spiffs (1.2MB APP/1.5MB SPIFFS)"
 * 3. Set Upload Speed: 921600
 * 4. Install required libraries via Library Manager:
 *    - TFT_eSPI by Bodmer (v2.5.34+)
 *    - ArduinoJson by Benoit Blanchon (v7.0.3+)
 *    - WiFiManager by tzapu (v2.0.17+)
 *    - NTPClient by Fabrice Weinberg (v3.2.1+)
 * 5. Configure TFT_eSPI User_Setup.h for ESP32-1732S019
 * 6. Upload this firmware
 * 7. Monitor Serial at 115200 baud for first boot
 * 8. Connect to "OBS-Tally-XXXX" WiFi network for setup
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <TFT_eSPI.h>
#include <DNSServer.h>
#include <WiFiManager.h>
#include <ArduinoOTA.h>
#include <Update.h>
#include <ESPmDNS.h>
#include <WiFiUdp.h>
#include <NTPClient.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>

// Firmware version and model information
#define FIRMWARE_VERSION "2.0.0"
#define DEVICE_MODEL "ESP32-1732S019"
#define BUILD_DATE __DATE__ " " __TIME__

// Display configuration
#define SCREEN_WIDTH 320
#define SCREEN_HEIGHT 170
#define TFT_ROTATION 3

// Server and networking configuration  
#define DEFAULT_SERVER_URL "http://192.168.1.100:3000"
#define CONFIG_PORTAL_TIMEOUT 300
#define HEARTBEAT_INTERVAL 30000
#define RECONNECT_INTERVAL 5000
#define HEALTH_CHECK_INTERVAL 60000

// Device and display settings
#define DEFAULT_DEVICE_NAME "OBS-Tally"
#define STATUS_UPDATE_INTERVAL 100
#define PULSE_SPEED 3

// Pin definitions (for ESP32-1732S019)
#define BACKLIGHT_PIN 14
#define BOOT_BUTTON_PIN 0

// Color definitions - Updated to match web interface
#define COLOR_BLACK     0x0000
#define COLOR_WHITE     0xFFFF
#define COLOR_RED       0xF800
#define COLOR_GREEN     0x07E0
#define COLOR_BLUE      0x001F
#define COLOR_YELLOW    0xFFE0
#define COLOR_ORANGE    0xFD20    // #ff9500 - Preview color matching web
#define COLOR_PURPLE    0x780F
#define COLOR_CYAN      0x07FF
#define COLOR_MAGENTA   0xF81F
#define COLOR_GRAY      0x8410    // #8e8e93 - Idle color matching web
#define COLOR_DARK_GRAY 0x4208
#define COLOR_LIVE_RED  0xF800    // #ff3b30 - Live color matching web
#define COLOR_PREVIEW_ORANGE 0xFD20  // #ff9500 - Preview orange
#define COLOR_IDLE_GRAY 0x8410    // #8e8e93 - Idle gray

// Global objects
TFT_eSPI tft = TFT_eSPI();
WebServer server(80);
HTTPClient http;
Preferences preferences;
WiFiManager wifiManager;
WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "pool.ntp.org", 0, 60000);

// Global variables
String deviceName = DEFAULT_DEVICE_NAME;
String serverURL = DEFAULT_SERVER_URL;
String deviceID = "";
String macAddress = "";
String ipAddress = "";
String currentStatus = "OFFLINE";
String assignedSource = "";
String lastError = "";
String lastHeartbeat = "Never";
int32_t wifiSignalStrength = 0;

// Status tracking
bool isConnected = false;
bool isRegistered = false;
bool webServerRunning = false;
bool ntpInitialized = false;
unsigned long lastHeartbeatTime = 0;
unsigned long lastStatusUpdate = 0;
unsigned long lastHealthCheck = 0;
unsigned long bootTime = 0;
unsigned long connectionAttempts = 0;
unsigned long successfulHeartbeats = 0;
unsigned long failedHeartbeats = 0;
unsigned long displayUpdates = 0;

// Animation variables
float pulsePhase = 0;
int brightness = 255;
bool lastDisplayState = false;
unsigned long lastFullRedraw = 0;
#define FULL_REDRAW_INTERVAL 5000  // Full redraw every 5 seconds

// Forward declarations
void setup();
void loop();
void setupDisplay();
void setupWiFi();
void setupWebServer();
void setupOTA();
void setupNTP();
void setupMDNS();
void loadConfiguration();
void saveConfiguration();
void registerDevice();
void sendHeartbeat();
void updateDisplay();
void updateStatus(const String& status);
void showStatus(const String& status, uint16_t color, bool pulse = false);
void showError(const String& error);
void showBootScreen();
void showConfigScreen();
void performHealthCheck();
void handleRoot();
void handleConfig();
void handleConfigSave();
void handleRestart();
void handleFactoryReset();
void handleDeviceInfo();
void handleTallyUpdate();
void announceDevice();
void checkServerConnection();
String formatUptime();
String formatTime();
uint16_t interpolateColor(uint16_t color1, uint16_t color2, float factor);
int getWiFiSignalQuality(int32_t rssi);
void updateWiFiSignalStrength();

// Firmware Management Class
class FirmwareManager {
public:
  static void printPartitionInfo() {
    const esp_partition_t *running = esp_ota_get_running_partition();
    const esp_partition_t *next = esp_ota_get_next_update_partition(NULL);
    
    Serial.println("=== ESP32 Partition Information ===");
    if (running) {
      Serial.printf("Running: addr=0x%08x, size=%d, label=%s\n", 
                   running->address, running->size, running->label);
    }
    if (next) {
      Serial.printf("Next update: addr=0x%08x, size=%d, label=%s\n", 
                   next->address, next->size, next->label);
    }
    Serial.printf("Free heap: %d bytes\n", ESP.getFreeHeap());
    Serial.println("====================================");
  }

  static bool eraseOldFirmware() {
    const esp_partition_t *running = esp_ota_get_running_partition();
    const esp_partition_t *update_partition = esp_ota_get_next_update_partition(NULL);
    
    if (!update_partition || update_partition == running) {
      Serial.println("ERROR: Cannot identify safe partition to erase");
      return false;
    }
    
    Serial.printf("Erasing old firmware in partition: %s\n", update_partition->label);
    esp_err_t err = esp_partition_erase_range(update_partition, 0, update_partition->size);
    
    if (err == ESP_OK) {
      Serial.println("✓ Old firmware erased successfully");
      return true;
    } else {
      Serial.printf("✗ Failed to erase: %s\n", esp_err_to_name(err));
      return false;
    }
  }

  static void getFirmwareInfo(JsonObject& info) {
    info["firmware_version"] = FIRMWARE_VERSION;
    info["build_date"] = BUILD_DATE;
    info["device_model"] = DEVICE_MODEL;
    info["esp_chip_model"] = ESP.getChipModel();
    info["esp_chip_revision"] = ESP.getChipRevision();
    info["cpu_freq_mhz"] = ESP.getCpuFreqMHz();
    info["flash_size"] = ESP.getFlashChipSize();
    info["free_heap"] = ESP.getFreeHeap();
    info["uptime_ms"] = millis();
    
    const esp_partition_t *running = esp_ota_get_running_partition();
    if (running) {
      info["running_partition"] = running->label;
    }
  }
};

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n=== ESP32 OBS Tally Light - Ultimate Edition v" + String(FIRMWARE_VERSION) + " ===");
  Serial.println("Build Date: " + String(BUILD_DATE));
  Serial.println("Device Model: " + String(DEVICE_MODEL));
  Serial.println("Starting clean boot...\n");
  
  bootTime = millis();
  
  // Initialize display first
  setupDisplay();
  showBootScreen();
  
  // Generate device ID from MAC address
  macAddress = WiFi.macAddress();
  deviceID = "tally-" + macAddress;
  deviceID.replace(":", "");
  deviceID.toLowerCase();
  
  Serial.println("Device ID: " + deviceID);
  Serial.println("MAC Address: " + macAddress);
  
  // Print partition information
  FirmwareManager::printPartitionInfo();
  
  // Load saved configuration
  loadConfiguration();
  
  // Setup WiFi connection
  setupWiFi();
  
  // Setup network services
  if (WiFi.status() == WL_CONNECTED) {
    ipAddress = WiFi.localIP().toString();
    Serial.println("IP Address: " + ipAddress);
    
    setupWebServer();
    setupOTA();
    setupNTP();
    setupMDNS();
    
    registerDevice();
    announceDevice();
    updateStatus("READY");
  } else {
    updateStatus("NO_WIFI");
  }
  
  Serial.println("=== Setup complete! ===\n");
}

void loop() {
  unsigned long currentTime = millis();
  
  // Handle OTA updates
  ArduinoOTA.handle();
  
  // Handle web server requests
  if (webServerRunning) {
    server.handleClient();
  }
  
  // Update NTP time
  if (ntpInitialized) {
    timeClient.update();
  }
  
  // Check WiFi connection
  if (WiFi.status() != WL_CONNECTED) {
    if (isConnected) {
      Serial.println("WiFi connection lost!");
      isConnected = false;
      updateStatus("NO_WIFI");
    }
  } else {
    if (!isConnected) {
      Serial.println("WiFi connection restored!");
      isConnected = true;
      ipAddress = WiFi.localIP().toString();
      
      if (!webServerRunning) setupWebServer();
      if (!ntpInitialized) setupNTP();
      
      registerDevice();
      updateStatus("READY");
    }
  }
  
  // Send heartbeat
  if (isConnected && currentTime - lastHeartbeatTime > HEARTBEAT_INTERVAL) {
    sendHeartbeat();
    lastHeartbeatTime = currentTime;
  }
  
  // Perform health check
  if (currentTime - lastHealthCheck > HEALTH_CHECK_INTERVAL) {
    performHealthCheck();
    lastHealthCheck = currentTime;
  }
  
  // Update display animation
  if (currentTime - lastStatusUpdate > STATUS_UPDATE_INTERVAL) {
    updateDisplay();
    lastStatusUpdate = currentTime;
    displayUpdates++;
  }
  
  // Handle factory reset button (hold BOOT button for 5 seconds)
  static unsigned long buttonPressStart = 0;
  static bool buttonPressed = false;
  
  if (digitalRead(BOOT_BUTTON_PIN) == LOW) {
    if (!buttonPressed) {
      buttonPressed = true;
      buttonPressStart = currentTime;
    } else if (currentTime - buttonPressStart > 5000) {
      Serial.println("Factory reset triggered!");
      showStatus("FACTORY RESET", COLOR_MAGENTA);
      delay(1000);
      
      preferences.clear();
      wifiManager.resetSettings();
      ESP.restart();
    }
  } else {
    buttonPressed = false;
  }
  
  delay(10);
}

void setupDisplay() {
  tft.init();
  tft.setRotation(TFT_ROTATION);
  tft.fillScreen(COLOR_BLACK);
  
  pinMode(BACKLIGHT_PIN, OUTPUT);
  digitalWrite(BACKLIGHT_PIN, HIGH);
  pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);
  
  Serial.println("Display initialized");
}

void setupWiFi() {
  wifiManager.setAPCallback([](WiFiManager *myWiFiManager) {
    Serial.println("Entered config mode");
    showConfigScreen();
  });
  
  wifiManager.setSaveConfigCallback([]() {
    Serial.println("Should save config");
  });
  
  wifiManager.setConfigPortalTimeout(CONFIG_PORTAL_TIMEOUT);
  
  WiFiManagerParameter custom_server_url("server", "Server URL", serverURL.c_str(), 100);
  WiFiManagerParameter custom_device_name("device", "Device Name", deviceName.c_str(), 50);
  
  wifiManager.addParameter(&custom_server_url);
  wifiManager.addParameter(&custom_device_name);
  
  String apName = "OBS-Tally-" + String(random(1000, 9999));
  
  if (!wifiManager.autoConnect(apName.c_str())) {
    Serial.println("Failed to connect and hit timeout");
    showError("WiFi Config Failed");
    delay(3000);
    ESP.restart();
  }
  
  if (String(custom_server_url.getValue()) != serverURL) {
    serverURL = custom_server_url.getValue();
    saveConfiguration();
  }
  
  if (String(custom_device_name.getValue()) != deviceName) {
    deviceName = custom_device_name.getValue();
    saveConfiguration();
  }
  
  isConnected = true;
  Serial.println("WiFi connected!");
  Serial.println("IP address: " + WiFi.localIP().toString());
}

void setupWebServer() {
  server.on("/", handleRoot);
  server.on("/config", handleConfig);
  server.on("/config-save", HTTP_POST, handleConfigSave);
  server.on("/restart", handleRestart);
  server.on("/factory-reset", handleFactoryReset);
  server.on("/api/device-info", handleDeviceInfo);
  server.on("/api/tally", HTTP_POST, handleTallyUpdate);
  
  // Firmware management endpoints
  server.on("/api/firmware/info", HTTP_GET, []() {
    JsonDocument doc;
    JsonObject info = doc.to<JsonObject>();
    FirmwareManager::getFirmwareInfo(info);
    
    String output;
    serializeJson(doc, output);
    server.send(200, "application/json", output);
  });

  server.on("/api/firmware/erase-old", HTTP_POST, []() {
    JsonDocument doc;
    JsonObject response = doc.to<JsonObject>();
    
    bool success = FirmwareManager::eraseOldFirmware();
    response["success"] = success;
    response["message"] = success ? "Old firmware erased successfully" : "Failed to erase old firmware";
    
    String output;
    serializeJson(doc, output);
    server.send(success ? 200 : 500, "application/json", output);
  });
  
  server.begin();
  webServerRunning = true;
  Serial.println("Web server started on port 80");
}

void setupOTA() {
  ArduinoOTA.setHostname(deviceID.c_str());
  ArduinoOTA.setPassword("tally123");
  
  ArduinoOTA.onStart([]() {
    String type = (ArduinoOTA.getCommand() == U_FLASH) ? "sketch" : "filesystem";
    Serial.println("Start updating " + type);
    showStatus("OTA UPDATE", COLOR_CYAN);
  });
  
  ArduinoOTA.onEnd([]() {
    Serial.println("\nOTA End");
    showStatus("OTA COMPLETE", COLOR_GREEN);
  });
  
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    String progressStr = "OTA: " + String((progress / (total / 100))) + "%";
    showStatus(progressStr, COLOR_CYAN);
  });
  
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("Error[%u]: ", error);
    String errorMsg = "OTA Error: ";
    if (error == OTA_AUTH_ERROR) errorMsg += "Auth Failed";
    else if (error == OTA_BEGIN_ERROR) errorMsg += "Begin Failed";
    else if (error == OTA_CONNECT_ERROR) errorMsg += "Connect Failed";
    else if (error == OTA_RECEIVE_ERROR) errorMsg += "Receive Failed";
    else if (error == OTA_END_ERROR) errorMsg += "End Failed";
    
    showError(errorMsg);
  });
  
  ArduinoOTA.begin();
  Serial.println("OTA ready");
}

void setupNTP() {
  timeClient.begin();
  timeClient.setTimeOffset(0);
  if (timeClient.update()) {
    ntpInitialized = true;
    Serial.println("NTP initialized");
  }
}

void setupMDNS() {
  if (MDNS.begin(deviceID.c_str())) {
    MDNS.addService("http", "tcp", 80);
    MDNS.addService("obs-tally", "tcp", 80);
    Serial.println("mDNS responder started");
  }
}

void loadConfiguration() {
  preferences.begin("obs-tally", false);
  deviceName = preferences.getString("deviceName", DEFAULT_DEVICE_NAME);
  serverURL = preferences.getString("serverURL", DEFAULT_SERVER_URL);
  preferences.end();
  
  Serial.println("Configuration loaded:");
  Serial.println("  Device Name: " + deviceName);
  Serial.println("  Server URL: " + serverURL);
}

void saveConfiguration() {
  preferences.begin("obs-tally", false);
  preferences.putString("deviceName", deviceName);
  preferences.putString("serverURL", serverURL);
  preferences.end();
  Serial.println("Configuration saved:");
  Serial.println("  Device Name: " + deviceName);
  Serial.println("  Server URL: " + serverURL);
}

void registerDevice() {
  if (!isConnected) return;
  
  Serial.println("Registering device with server...");
  
  http.begin(serverURL + "/api/esp32/register");
  http.addHeader("Content-Type", "application/json");
  
  JsonDocument doc;
  doc["deviceId"] = deviceID;
  doc["deviceName"] = deviceName;
  doc["ipAddress"] = ipAddress;
  doc["macAddress"] = macAddress;
  doc["firmware"] = FIRMWARE_VERSION;
  doc["model"] = DEVICE_MODEL;
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  int httpCode = http.POST(jsonString);
  
  if (httpCode > 0) {
    String response = http.getString();
    Serial.println("Registration response: " + response);
    
    if (httpCode == 200) {
      isRegistered = true;
      updateStatus("READY");
      lastError = "";
    } else {
      lastError = "Registration failed: HTTP " + String(httpCode);
      updateStatus("ERROR");
    }
  } else {
    lastError = "Registration failed: " + http.errorToString(httpCode);
    updateStatus("ERROR");
    connectionAttempts++;
  }
  
  http.end();
}

void sendHeartbeat() {
  if (!isConnected || !isRegistered) return;
  
  http.begin(serverURL + "/api/heartbeat");
  http.addHeader("Content-Type", "application/json");
  
  JsonDocument doc;
  doc["id"] = deviceID;
  doc["status"] = currentStatus;
  doc["uptime"] = millis() - bootTime;
  doc["ip"] = ipAddress;
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  int httpCode = http.POST(jsonString);
  
  if (httpCode > 0) {
    String response = http.getString();
    
    if (httpCode == 200) {
      JsonDocument responseDoc;
      deserializeJson(responseDoc, response);
      
      if (responseDoc["status"].is<String>()) {
        String newStatus = responseDoc["status"];
        if (newStatus != currentStatus) {
          updateStatus(newStatus);
        }
      }
      
      successfulHeartbeats++;
    } else {
      failedHeartbeats++;
      lastError = "Heartbeat failed: HTTP " + String(httpCode);
      updateStatus("ERROR");
    }
  } else {
    failedHeartbeats++;
    lastError = "Heartbeat failed: " + http.errorToString(httpCode);
    updateStatus("ERROR");
  }
  
  http.end();
}

void updateDisplay() {
  // Only update LIVE animation, don't constantly redraw for other states
  if (currentStatus == "LIVE") {
    pulsePhase += PULSE_SPEED * 0.1;
    if (pulsePhase > 2 * PI) pulsePhase = 0;
    
    brightness = 128 + (127 * sin(pulsePhase));
    
    // Only update the backlight brightness, not the entire display
    analogWrite(BACKLIGHT_PIN, brightness);
    
    // Force full redraw occasionally to refresh display
    if (millis() - lastFullRedraw > FULL_REDRAW_INTERVAL || !lastDisplayState) {
      showStatus("● LIVE", COLOR_RED, true);
      lastFullRedraw = millis();
      lastDisplayState = true;
    }
  } else {
    // For non-LIVE states, ensure full brightness and only redraw when needed
    analogWrite(BACKLIGHT_PIN, 255);
    if (lastDisplayState) {
      // State changed from LIVE to something else, force redraw
      lastDisplayState = false;
      lastFullRedraw = millis();
    }
  }
}

void updateStatus(const String& status) {
  if (status == currentStatus) return;
  
  currentStatus = status;
  Serial.println("Status updated: " + status);
  
  // Force immediate display update on state change
  lastDisplayState = false;
  lastFullRedraw = 0;
  
  // Update display based on status with new colors matching web interface
  if (status == "Live") {
    pulsePhase = 0; // Reset animation phase
    showStatus("● LIVE", COLOR_LIVE_RED, true);
    lastDisplayState = true;
  } else if (status == "Preview") {
    showStatus("● PREVIEW", COLOR_PREVIEW_ORANGE);
  } else if (status == "Idle") {
    showStatus("● IDLE", COLOR_IDLE_GRAY);
  } else if (status == "READY") {
    showStatus("● READY", COLOR_GREEN);
  } else if (status == "OFFLINE") {
    showStatus("● OFFLINE", COLOR_GRAY);
  } else if (status == "NO_WIFI") {
    showStatus("NO WIFI", COLOR_ORANGE);
  } else if (status == "ERROR") {
    showStatus("● ERROR", COLOR_PURPLE);
  } else {
    showStatus(status, COLOR_WHITE);
  }
}

void showStatus(const String& status, uint16_t color, bool pulse) {
  // Update WiFi signal strength
  updateWiFiSignalStrength();
  
  // Only do full screen redraw when necessary
  static String lastStatus = "";
  static uint16_t lastColor = 0;
  
  if (status != lastStatus || color != lastColor || !pulse) {
    // Set background color first based on status
    if (status.indexOf("LIVE") >= 0) {
      // Live status gets red background
      tft.fillScreen(COLOR_LIVE_RED);
      tft.setTextColor(COLOR_WHITE);
    } else {
      tft.fillScreen(COLOR_BLACK);
      tft.setTextColor(color);
    }
    
    // Show WiFi signal strength indicator (top right)
    int wifiQuality = getWiFiSignalQuality(wifiSignalStrength);
    // Always use white for WiFi bars to ensure visibility on any background
    uint16_t wifiColor = COLOR_WHITE;
    
    // Draw WiFi signal bars
    for (int i = 0; i < 4; i++) {
      int barHeight = 3 + (i * 2);
      uint16_t barColor = (i < (wifiQuality / 25)) ? wifiColor : COLOR_DARK_GRAY;
      tft.fillRect(SCREEN_WIDTH - 25 + (i * 4), 15 - barHeight, 3, barHeight, barColor);
    }
    
    tft.setTextSize(4);
    
    // Display source name or "no source" if not assigned
    String displayText;
    if (assignedSource.length() > 0) {
      displayText = assignedSource;
    } else {
      displayText = "NO SOURCE";
      tft.setTextColor(COLOR_IDLE_GRAY);
    }
    
    int16_t x = (SCREEN_WIDTH - (displayText.length() * 24)) / 2;
    int16_t y = SCREEN_HEIGHT / 2 - 40;
    
    tft.setCursor(x, y);
    tft.print(displayText);
    
    // Show tally status below source name
    tft.setTextSize(2);
    if (status.indexOf("LIVE") >= 0) {
      tft.setTextColor(COLOR_WHITE);
    } else {
      tft.setTextColor(color);
    }
    
    String statusDisplay = status;
    if (assignedSource.length() == 0 && status != "NO_WIFI" && status != "OFFLINE" && status != "ERROR") {
      statusDisplay = "NOT ASSIGNED";
    }
    
    x = (SCREEN_WIDTH - (statusDisplay.length() * 12)) / 2;
    y = SCREEN_HEIGHT / 2 - 5;
    tft.setCursor(x, y);
    tft.print(statusDisplay);
    
    // Device info at bottom (smaller text for Live background)
    if (status.indexOf("LIVE") >= 0) {
      tft.setTextColor(COLOR_WHITE);
    } else {
      tft.setTextColor(COLOR_WHITE);
    }
    tft.setTextSize(1);
    tft.setCursor(5, SCREEN_HEIGHT - 40);
    tft.print(deviceName);
    
    tft.setCursor(5, SCREEN_HEIGHT - 30);
    tft.print("IP: " + ipAddress);
    
    tft.setCursor(5, SCREEN_HEIGHT - 20);
    tft.print("FW: " + String(FIRMWARE_VERSION));
    
    tft.setCursor(5, SCREEN_HEIGHT - 10);
    tft.print("ID: " + deviceID.substring(6, 12));
    
    // Connection status dot removed for cleaner display
    
    lastStatus = status;
    lastColor = color;
  }
}

void showError(const String& error) {
  Serial.println("ERROR: " + error);
  lastError = error;
  
  tft.fillScreen(COLOR_BLACK);
  tft.setTextColor(COLOR_RED);
  tft.setTextSize(2);
  
  int16_t x = (SCREEN_WIDTH - (String("ERROR").length() * 12)) / 2;
  int16_t y = SCREEN_HEIGHT / 2 - 30;
  
  tft.setCursor(x, y);
  tft.print("ERROR");
  
  tft.setTextColor(COLOR_WHITE);
  tft.setTextSize(1);
  
  // Word wrap the error message
  String errorMsg = error;
  int lineHeight = 10;
  int maxCharsPerLine = SCREEN_WIDTH / 6;
  int currentY = y + 30;
  
  while (errorMsg.length() > 0 && currentY < SCREEN_HEIGHT - 20) {
    String line = errorMsg.substring(0, min((int)errorMsg.length(), maxCharsPerLine));
    int spaceIndex = line.lastIndexOf(' ');
    
    if (spaceIndex > 0 && errorMsg.length() > maxCharsPerLine) {
      line = errorMsg.substring(0, spaceIndex);
      errorMsg = errorMsg.substring(spaceIndex + 1);
    } else {
      errorMsg = errorMsg.substring(line.length());
    }
    
    tft.setCursor(5, currentY);
    tft.print(line);
    currentY += lineHeight;
  }
  
  // Show device info at bottom
  tft.setCursor(5, SCREEN_HEIGHT - 20);
  tft.print("ID: " + deviceID.substring(6, 12));
}

void showBootScreen() {
  tft.fillScreen(COLOR_BLACK);
  
  // Show logo/title
  tft.setTextColor(COLOR_CYAN);
  tft.setTextSize(3);
  int16_t x = (SCREEN_WIDTH - (String("OBS TALLY").length() * 18)) / 2;
  tft.setCursor(x, 30);
  tft.print("OBS TALLY");
  
  tft.setTextColor(COLOR_WHITE);
  tft.setTextSize(2);
  x = (SCREEN_WIDTH - (String("ULTIMATE").length() * 12)) / 2;
  tft.setCursor(x, 60);
  tft.print("ULTIMATE");
  
  // Show version
  tft.setTextSize(1);
  x = (SCREEN_WIDTH - (String("v" + String(FIRMWARE_VERSION)).length() * 6)) / 2;
  tft.setCursor(x, 85);
  tft.print("v" + String(FIRMWARE_VERSION));
  
  // Show device info
  tft.setCursor(5, SCREEN_HEIGHT - 40);
  tft.print("Device: " + deviceName);
  
  tft.setCursor(5, SCREEN_HEIGHT - 30);
  tft.print("Model: " + String(DEVICE_MODEL));
  
  tft.setCursor(5, SCREEN_HEIGHT - 20);
  tft.print("MAC: " + macAddress);
  
  tft.setCursor(5, SCREEN_HEIGHT - 10);
  tft.print("Starting...");
  
  delay(2000);
}

void showConfigScreen() {
  tft.fillScreen(COLOR_BLACK);
  
  tft.setTextColor(COLOR_YELLOW);
  tft.setTextSize(2);
  int16_t x = (SCREEN_WIDTH - (String("CONFIG MODE").length() * 12)) / 2;
  tft.setCursor(x, 30);
  tft.print("CONFIG MODE");
  
  tft.setTextColor(COLOR_WHITE);
  tft.setTextSize(1);
  
  tft.setCursor(5, 70);
  tft.print("1. Connect to WiFi:");
  
  tft.setCursor(5, 85);
  tft.print("   OBS-Tally-XXXX");
  
  tft.setCursor(5, 105);
  tft.print("2. Open browser to:");
  
  tft.setCursor(5, 120);
  tft.print("   192.168.4.1");
  
  tft.setCursor(5, 140);
  tft.print("3. Configure settings");
  
  tft.setCursor(5, SCREEN_HEIGHT - 20);
  tft.print("Timeout: " + String(CONFIG_PORTAL_TIMEOUT) + "s");
}

void performHealthCheck() {
  Serial.println("Performing health check...");
  
  // Check memory
  uint32_t freeHeap = ESP.getFreeHeap();
  if (freeHeap < 50000) {
    Serial.println("WARNING: Low memory - " + String(freeHeap) + " bytes");
  }
  
  // Check WiFi signal strength
  if (WiFi.status() == WL_CONNECTED) {
    int32_t rssi = WiFi.RSSI();
    Serial.println("WiFi RSSI: " + String(rssi) + " dBm");
    
    if (rssi < -80) {
      Serial.println("WARNING: Weak WiFi signal");
    }
  }
  
  // Check heartbeat success rate
  if (successfulHeartbeats + failedHeartbeats > 10) {
    float successRate = (float)successfulHeartbeats / (successfulHeartbeats + failedHeartbeats) * 100;
    Serial.println("Heartbeat success rate: " + String(successRate, 1) + "%");
    
    if (successRate < 80) {
      Serial.println("WARNING: Low heartbeat success rate");
    }
  }
  
  Serial.println("Health check complete");
}

void handleRoot() {
  String statusClass = currentStatus;
  statusClass.toLowerCase();
  
  String html = "<!DOCTYPE html><html><head>";
  html += "<title>OBS Tally Device</title>";
  html += "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">";
  html += "<style>";
  html += "body { font-family: Arial; margin: 20px; background: #1a1a1a; color: #fff; }";
  html += ".container { max-width: 800px; margin: 0 auto; }";
  html += ".status { padding: 20px; border-radius: 8px; margin: 10px 0; text-align: center; font-size: 24px; }";
  html += ".live { background: #ff4444; }";
  html += ".preview { background: #ffaa00; }";
  html += ".ready { background: #44ff44; }";
  html += ".offline { background: #888888; }";
  html += ".error { background: #aa44ff; }";
  html += ".info { background: #333; padding: 15px; border-radius: 8px; margin: 10px 0; }";
  html += ".btn { background: #0066cc; color: white; padding: 10px 20px; border: none; border-radius: 4px; margin: 5px; cursor: pointer; }";
  html += ".btn:hover { background: #0052a3; }";
  html += ".btn-danger { background: #dc3545; }";
  html += ".btn-danger:hover { background: #c82333; }";
  html += "</style></head><body>";
  html += "<div class=\"container\">";
  html += "<h1>OBS Tally Device</h1>";
  html += "<div class=\"status " + statusClass + "\">";
  html += currentStatus;
  html += "</div>";
  html += "<div class=\"info\">";
  html += "<h3>Device Information</h3>";
  html += "<p><strong>Device Name:</strong> " + deviceName + "</p>";
  html += "<p><strong>Device ID:</strong> " + deviceID + "</p>";
  html += "<p><strong>IP Address:</strong> " + ipAddress + "</p>";
  html += "<p><strong>MAC Address:</strong> " + macAddress + "</p>";
  html += "<p><strong>Firmware:</strong> " + String(FIRMWARE_VERSION) + "</p>";
  html += "<p><strong>Uptime:</strong> " + formatUptime() + "</p>";
  html += "<p><strong>Server URL:</strong> " + serverURL + "</p>";
  html += "</div>";
  html += "<div class=\"info\">";
  html += "<h3>Statistics</h3>";
  html += "<p><strong>Successful Heartbeats:</strong> " + String(successfulHeartbeats) + "</p>";
  html += "<p><strong>Failed Heartbeats:</strong> " + String(failedHeartbeats) + "</p>";
  html += "<p><strong>Display Updates:</strong> " + String(displayUpdates) + "</p>";
  html += "<p><strong>Last Heartbeat:</strong> " + lastHeartbeat + "</p>";
  html += "</div>";
  html += "<div>";
  html += "<button class=\"btn\" onclick=\"location.href='/config'\">Configuration</button>";
  html += "<button class=\"btn\" onclick=\"location.href='/restart'\">Restart</button>";
  html += "<button class=\"btn btn-danger\" onclick=\"location.href='/factory-reset'\">Factory Reset</button>";
  html += "</div></div></body></html>";
  
  server.send(200, "text/html", html);
}

void handleConfig() {
  String html = "<!DOCTYPE html><html><head>";
  html += "<title>OBS Tally Configuration</title>";
  html += "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">";
  html += "<style>";
  html += "body { font-family: Arial; margin: 20px; background: #1a1a1a; color: #fff; }";
  html += ".container { max-width: 600px; margin: 0 auto; }";
  html += ".form-group { margin: 15px 0; }";
  html += "label { display: block; margin-bottom: 5px; }";
  html += "input[type=\"text\"], input[type=\"url\"] { width: 100%; padding: 10px; border: 1px solid #555; background: #333; color: #fff; border-radius: 4px; box-sizing: border-box; }";
  html += ".btn { background: #0066cc; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }";
  html += ".btn:hover { background: #0052a3; }";
  html += "</style></head><body>";
  html += "<div class=\"container\">";
  html += "<h1>Device Configuration</h1>";
  html += "<form action=\"/config-save\" method=\"post\">";
  html += "<div class=\"form-group\">";
  html += "<label for=\"deviceName\">Device Name:</label>";
  html += "<input type=\"text\" id=\"deviceName\" name=\"deviceName\" value=\"" + deviceName + "\" required>";
  html += "</div>";
  html += "<div class=\"form-group\">";
  html += "<label for=\"serverURL\">Server URL:</label>";
  html += "<input type=\"url\" id=\"serverURL\" name=\"serverURL\" value=\"" + serverURL + "\" required>";
  html += "</div>";
  html += "<button type=\"submit\" class=\"btn\">Save Configuration</button>";
  html += "</form><br>";
  html += "<button class=\"btn\" onclick=\"location.href='/'\">Back to Status</button>";
  html += "</div></body></html>";
  
  server.send(200, "text/html", html);
}

void handleConfigSave() {
  if (server.hasArg("deviceName")) {
    deviceName = server.arg("deviceName");
  }
  if (server.hasArg("serverURL")) {
    serverURL = server.arg("serverURL");
  }
  
  saveConfiguration();
  
  server.send(200, "text/html", R"(
<!DOCTYPE html>
<html>
<head>
    <title>Configuration Saved</title>
    <meta http-equiv="refresh" content="3;url=/">
    <style>
        body { font-family: Arial; text-align: center; margin: 50px; background: #1a1a1a; color: #fff; }
    </style>
</head>
<body>
    <h1>Configuration Saved</h1>
    <p>Restarting device...</p>
</body>
</html>
  )");
  
  delay(1000);
  ESP.restart();
}

void handleRestart() {
  server.send(200, "text/html", R"(
<!DOCTYPE html>
<html>
<head>
    <title>Restarting</title>
    <style>
        body { font-family: Arial; text-align: center; margin: 50px; background: #1a1a1a; color: #fff; }
    </style>
</head>
<body>
    <h1>Restarting Device</h1>
    <p>Please wait...</p>
</body>
</html>
  )");
  
  delay(1000);
  ESP.restart();
}

void handleFactoryReset() {
  server.send(200, "text/html", R"(
<!DOCTYPE html>
<html>
<head>
    <title>Factory Reset</title>
    <style>
        body { font-family: Arial; text-align: center; margin: 50px; background: #1a1a1a; color: #fff; }
    </style>
</head>
<body>
    <h1>Factory Reset Complete</h1>
    <p>Device will restart and enter configuration mode...</p>
</body>
</html>
  )");
  
  delay(1000);
  
  preferences.clear();
  wifiManager.resetSettings();
  ESP.restart();
}

void handleDeviceInfo() {
  JsonDocument doc;
  
  doc["deviceId"] = deviceID;
  doc["deviceName"] = deviceName;
  doc["ipAddress"] = ipAddress;
  doc["macAddress"] = macAddress;
  doc["firmware"] = FIRMWARE_VERSION;
  doc["model"] = DEVICE_MODEL;
  doc["status"] = currentStatus;
  doc["uptime"] = millis() - bootTime;
  doc["serverURL"] = serverURL;
  doc["isConnected"] = isConnected;
  doc["isRegistered"] = isRegistered;
  doc["lastHeartbeat"] = lastHeartbeat;
  doc["successfulHeartbeats"] = successfulHeartbeats;
  doc["failedHeartbeats"] = failedHeartbeats;
  doc["displayUpdates"] = displayUpdates;
  
  if (lastError.length() > 0) {
    doc["lastError"] = lastError;
  }
  
  String output;
  serializeJson(doc, output);
  server.send(200, "application/json", output);
}

void handleTallyUpdate() {
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"error\":\"No body\"}");
    return;
  }
  
  String body = server.arg("plain");
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, body);
  
  if (error) {
    server.send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
    return;
  }
  
  // Extract assigned source if provided
  if (doc["assignedSource"].is<const char*>()) {
    assignedSource = doc["assignedSource"].as<const char*>();
  }
  
  // Check if device name is provided and update it
  if (doc["deviceName"].is<const char*>()) {
    String newDeviceName = doc["deviceName"].as<const char*>();
    if (newDeviceName != deviceName) {
      deviceName = newDeviceName;
      saveConfiguration();
      Serial.println("Device name updated to: " + deviceName);
    }
  }
  
  // Check if tallyStatus field exists (new format from server)
  if (doc["tallyStatus"].is<String>()) {
    String newStatus = doc["tallyStatus"];
    updateStatus(newStatus);
    
    JsonDocument response;
    response["success"] = true;
    response["status"] = currentStatus;
    response["timestamp"] = formatTime();
    
    String output;
    serializeJson(response, output);
    server.send(200, "application/json", output);
  } else if (doc["status"].is<String>()) {
    // Legacy format support
    String newStatus = doc["status"];
    updateStatus(newStatus);
    
    // Also handle device name in legacy format
    if (doc["deviceName"].is<const char*>()) {
      String newDeviceName = doc["deviceName"].as<const char*>();
      if (newDeviceName != deviceName) {
        deviceName = newDeviceName;
        saveConfiguration();
        Serial.println("Device name updated to: " + deviceName);
      }
    }
    
    JsonDocument response;
    response["success"] = true;
    response["status"] = currentStatus;
    response["timestamp"] = formatTime();
    
    String output;
    serializeJson(response, output);
    server.send(200, "application/json", output);
  } else {
    server.send(400, "application/json", "{\"error\":\"Missing tallyStatus or status\"}");
  }
}

void announceDevice() {
  WiFiUDP udp;
  IPAddress broadcastIP(255, 255, 255, 255);
  
  JsonDocument doc;
  doc["type"] = "device_announcement";
  doc["deviceId"] = deviceID;
  doc["deviceName"] = deviceName;
  doc["ipAddress"] = ipAddress;
  doc["macAddress"] = macAddress;
  doc["firmware"] = FIRMWARE_VERSION;
  doc["model"] = DEVICE_MODEL;
  doc["timestamp"] = millis();
  
  String announcement;
  serializeJson(doc, announcement);
  
  udp.begin(0);
  udp.beginPacket(broadcastIP, 3001);
  udp.print(announcement);
  udp.endPacket();
  udp.stop();
  
  Serial.println("Device announcement sent");
}

String formatUptime() {
  unsigned long uptimeMs = millis() - bootTime;
  unsigned long seconds = uptimeMs / 1000;
  unsigned long minutes = seconds / 60;
  unsigned long hours = minutes / 60;
  unsigned long days = hours / 24;
  
  seconds %= 60;
  minutes %= 60;
  hours %= 24;
  
  String uptime = "";
  if (days > 0) uptime += String(days) + "d ";
  if (hours > 0) uptime += String(hours) + "h ";
  if (minutes > 0) uptime += String(minutes) + "m ";
  uptime += String(seconds) + "s";
  
  return uptime;
}

String formatTime() {
  if (ntpInitialized && timeClient.isTimeSet()) {
    return timeClient.getFormattedTime();
  }
  return String(millis() / 1000) + "s";
}

uint16_t interpolateColor(uint16_t color1, uint16_t color2, float factor) {
  if (factor <= 0) return color1;
  if (factor >= 1) return color2;
  
  uint8_t r1 = (color1 >> 11) & 0x1F;
  uint8_t g1 = (color1 >> 5) & 0x3F;
  uint8_t b1 = color1 & 0x1F;
  
  uint8_t r2 = (color2 >> 11) & 0x1F;
  uint8_t g2 = (color2 >> 5) & 0x3F;
  uint8_t b2 = color2 & 0x1F;
  
  uint8_t r = r1 + (r2 - r1) * factor;
  uint8_t g = g1 + (g2 - g1) * factor;
  uint8_t b = b1 + (b2 - b1) * factor;
  
  return (r << 11) | (g << 5) | b;
}

// Convert WiFi RSSI to signal quality percentage
int getWiFiSignalQuality(int32_t rssi) {
  if (rssi >= -50) return 100;
  if (rssi <= -100) return 0;
  return 2 * (rssi + 100);
}

// Update WiFi signal strength
void updateWiFiSignalStrength() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiSignalStrength = WiFi.RSSI();
  } else {
    wifiSignalStrength = -100; // No signal
  }
}