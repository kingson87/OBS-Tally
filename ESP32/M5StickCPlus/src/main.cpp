/*
 * ESP32 OBS Tally Light System - M5StickC PLUS Edition v1.0.0
 * 
 * Features:
 * - WiFi configuration portal with auto-discovery
 * - Built-in web server for device management
 * - Real-time tally status display with smooth animations
 * - Automatic device registration and heartbeat system
 * - Over-The-Air (OTA) firmware updates
 * - Comprehensive error handling and diagnostics
 * - mDNS support for network discovery
 * - UDP device announcement system
 * - Persistent configuration storage
 * - Advanced firmware management
 * 
 * Hardware: M5StickC PLUS
 */

#include <Arduino.h>
#include <M5StickCPlus.h>
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <DNSServer.h>
#include <WiFiManager.h>
#include <ESPmDNS.h>
#include <WiFiUdp.h>
#include <NTPClient.h>
#include <Update.h>
#include <ArduinoOTA.h>

// Define Serial port for ESP32
#if defined(ARDUINO_USB_CDC_ON_BOOT)
HardwareSerial SerialPort(0);
#define DEBUG_PORT SerialPort
#else 
#define DEBUG_PORT Serial0
#endif

// Constants
#define FIRMWARE_VERSION "1.0.0"
#define CONFIG_VERSION "M5CP1"
#define DEVICE_TYPE "M5StickC-PLUS"
#define DEFAULT_HOSTNAME "OBS-Tally-M5CP"
#define CONFIG_PORTAL_TIMEOUT 180
#define HEARTBEAT_INTERVAL 5000
#define STATUS_CHECK_INTERVAL 1000
#define ANNOUNCE_INTERVAL 30000
#define SERVER_PORT 80
#define UDP_PORT 8888

// Brightness control for M5StickC Plus - Further reduced for battery life
#define BACKLIGHT_PIN 32
#define BRIGHTNESS_IDLE 30          // Reduced from 50 for battery savings
#define BRIGHTNESS_PREVIEW 60       // Reduced from 80 for battery savings  
#define BRIGHTNESS_LIVE 80          // Reduced from 100 for battery savings

// Power optimization constants
#define AUTO_SLEEP_TIMEOUT 300000   // 5 minutes of inactivity before sleep
#define DISPLAY_TIMEOUT 60000       // 1 minute before dimming display
#define DEEP_SLEEP_DURATION 30      // 30 seconds deep sleep intervals
#define WIFI_POWER_SAVE_TIMEOUT 10000 // Enable WiFi power save after 10 seconds
#define CPU_FREQ_NORMAL 240         // Normal CPU frequency (MHz)
#define CPU_FREQ_POWER_SAVE 80      // Power save CPU frequency (MHz)
#define HEARTBEAT_INTERVAL_POWER_SAVE 10000 // Slower heartbeat when power saving

// LED control for rear red LED (GPIO 10)
#define LED_PIN 10
#define LED_BLINK_INTERVAL 500

// Global variables
WebServer webServer(SERVER_PORT);
WiFiUDP udp;
NTPClient timeClient(udp, "pool.ntp.org");
Preferences preferences;

// Device state
struct {
    char serverIP[16] = "";
    uint16_t serverPort = 4444;
    char deviceName[32] = "";
    char assignedSource[64] = "";
    char hostname[32] = DEFAULT_HOSTNAME;
    bool isPreview = false;
    bool isProgram = false;
    bool isStreaming = false;
    bool isRecording = false;
    unsigned long lastHeartbeat = 0;
    unsigned long lastAnnounce = 0;
    bool serverConnected = false;
    bool configMode = false;
    bool ledManuallyDisabled = true; // Manual LED control state - default to OFF
    bool isRegistered = false; // Track device registration status
    String deviceID = ""; // Device ID for registration
    String macAddress = ""; // MAC address for registration
} deviceState;

// Power management state
struct {
    unsigned long lastActivity = 0;
    unsigned long lastDisplayUpdate = 0;
    bool powerSaveMode = false;
    bool displayDimmed = false;
    bool deepSleepEnabled = true;
    uint8_t originalBrightness = BRIGHTNESS_IDLE;
    unsigned long wifiPowerSaveStart = 0;
    bool cpuFreqReduced = false;
    int batteryPercent = 100;
    bool lowBatteryMode = false;
} powerState;

// Button handling state
struct {
    unsigned long btnB_LastPress = 0;
    unsigned long btnB_PressStart = 0;
    bool btnB_IsPressed = false;
    bool btnB_WaitingForDouble = false;
    bool btnB_LongPressHandled = false;
    int btnB_ClickCount = 0;
} buttonState;

// Function declarations
void setupDisplay();
void setupWiFi();
void setupWebServer();
void setupMDNS();
void setupOTA();
void handleRoot();
void handleConfig();
void handleConfigPost();
void handleUpdate();
void handleUpdateResponse();
void handleUpdateFile();
void handleReset();
void handleStatus();
void updateDisplay();
void setBrightness(uint8_t brightness);
void drawWiFiAndBattery(int32_t wifiSignal, int batteryPercent);
void updateLED();
void checkServer();
void announceDevice();
void sendHeartbeat();
void registerDevice();
bool loadConfig();
void saveConfig();
void factoryReset();
void handleButtonB();
void showNetworkInfo();
void toggleLED();

// Power management functions
void initPowerManagement();
void updatePowerState();
void enterPowerSaveMode();
void exitPowerSaveMode();
void updateBatteryStatus();
void handleLowBattery();
void enterDeepSleep();
void dimDisplay();
void brightenDisplay();
void updateActivity();
void optimizeWiFiPower();
void adjustCPUFrequency(bool powerSave);

void setup() {
    // Initialize serial port first for debugging
    #if defined(ARDUINO_USB_CDC_ON_BOOT)
        DEBUG_PORT.begin(115200);
        delay(500); // Give Serial time to initialize
    #endif

    delay(500); // Brief delay before initializing hardware
    
    // Initialize M5StickC PLUS with minimal features first
    M5.begin(true, true, false);  // Initialize AXP192 Power and LCD, but not Serial (already done)
    
    // Configure power management for optimal display performance
    M5.Axp.SetLDO2(true);   // Enable LCD backlight power
    delay(100);             // Allow power to stabilize
    
    // Initialize LED pin
    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, HIGH); // Start with LED off (HIGH = OFF for M5StickC Plus)
    Serial.println("[INIT] LED initialized and set to OFF by default");
    
    // Initialize display
    M5.Lcd.setRotation(3); // Landscape
    M5.Lcd.fillScreen(TFT_BLACK);
    M5.Lcd.setTextSize(2);
    
    // Test brightness control with visible changes
    DEBUG_PORT.println("Testing brightness control...");
    
    // Start with maximum brightness for visibility
    setBrightness(255);
    
    // Show boot screen with maximum brightness
    M5.Lcd.setCursor(10, 20);
    M5.Lcd.println("OBS Tally");
    M5.Lcd.setCursor(10, 40);
    M5.Lcd.println("M5StickC PLUS");
    M5.Lcd.setCursor(10, 60);
    M5.Lcd.println("Max Bright");
    
    delay(2000); // Show at max brightness
    
    // Test dimming
    setBrightness(50);
    M5.Lcd.setCursor(10, 80);
    M5.Lcd.println("Dim Test");
    
    delay(2000); // Show dimmed
    
    // Return to normal brightness
    setBrightness(BRIGHTNESS_IDLE);
    
    delay(1000); // Allow time for stable power
    
    // Load config - but don't reset immediately if it fails
    bool configLoaded = loadConfig();
    if (!configLoaded) {
        M5.Lcd.setCursor(10, 80);
        M5.Lcd.setTextColor(TFT_YELLOW);
        M5.Lcd.println("No Config");
        delay(2000);
    }
    
    // Setup networking with visual feedback
    M5.Lcd.fillScreen(TFT_BLACK);
    M5.Lcd.setCursor(10, 20);
    M5.Lcd.setTextColor(TFT_WHITE);
    M5.Lcd.println("WiFi Setup");
    setupWiFi();
    
    // Only continue with other services if WiFi is connected
    if (WiFi.status() == WL_CONNECTED) {
        setupWebServer();
        setupMDNS();
        setupOTA();
        
        // Setup UDP for device discovery
        udp.begin(UDP_PORT);
        
        // Setup time client
        timeClient.begin();
        timeClient.setUpdateInterval(3600000); // Update every hour
    }
    
    // Initialize power management
    initPowerManagement();
    Serial.println("[INIT] Power management initialized");
}

void loop() {
    M5.update(); // Handle button presses
    
    // Basic functionality regardless of connection state
    if (M5.BtnA.pressedFor(2000)) {
        // Long press A button for factory reset
        factoryReset();
        return;
    }
    
    if (deviceState.configMode) {
        // In configuration mode, just handle basic functions
        static unsigned long lastBlink = 0;
        if (millis() - lastBlink > 1000) {
            static bool blinkState = false;
            blinkState = !blinkState;
            
            M5.Lcd.setTextColor(blinkState ? TFT_YELLOW : TFT_BLACK);
            M5.Lcd.setCursor(10, 80);
            M5.Lcd.println("Config Mode");
            
            lastBlink = millis();
        }
        
        // Keep WiFi running
        if (WiFi.status() == WL_CONNECTED) {
            deviceState.configMode = false;
            setup(); // Re-run setup to initialize all services
        }
        
        delay(100);
        return;
    }
    
    // Normal operation mode
    static unsigned long lastWifiCheck = 0;
    static bool wasDisconnected = false;
    
    if (WiFi.status() != WL_CONNECTED) {
        wasDisconnected = true;
        deviceState.isRegistered = false; // Clear registration when WiFi is lost
        deviceState.serverConnected = false;
        
        if (millis() - lastWifiCheck > 5000) {
            M5.Lcd.fillScreen(TFT_BLACK);
            M5.Lcd.setTextColor(TFT_RED);
            M5.Lcd.setCursor(10, 20);
            M5.Lcd.println("WiFi Lost");
            M5.Lcd.setCursor(10, 40);
            M5.Lcd.println("Reconnecting");
            
            WiFi.reconnect();
            lastWifiCheck = millis();
        }
        delay(100);
        return;
    }
    
    // WiFi connection restored - re-register device
    if (wasDisconnected) {
        wasDisconnected = false;
        deviceState.isRegistered = false; // Force re-registration
        Serial.println("WiFi connection restored, will re-register device");
    }
    
    // Handle normal operations only when connected
    ArduinoOTA.handle();
    webServer.handleClient();
    timeClient.update();
    
    // Check server connection (adjust heartbeat interval based on power save mode)
    unsigned long heartbeatInterval = powerState.powerSaveMode ? HEARTBEAT_INTERVAL_POWER_SAVE : HEARTBEAT_INTERVAL;
    if (millis() - deviceState.lastHeartbeat > heartbeatInterval) {
        sendHeartbeat();
    }
    
    // Announce device presence (reduce frequency in power save mode)
    unsigned long announceInterval = powerState.powerSaveMode ? (ANNOUNCE_INTERVAL * 2) : ANNOUNCE_INTERVAL;
    if (millis() - deviceState.lastAnnounce > announceInterval) {
        announceDevice();
    }
    
    // Update display status only when state actually changes
    static bool lastPreview = deviceState.isPreview;
    static bool lastProgram = deviceState.isProgram;
    static bool lastStreaming = deviceState.isStreaming;
    static bool lastRecording = deviceState.isRecording;
    static bool lastServerConnected = deviceState.serverConnected;
    
    bool stateChanged = (lastPreview != deviceState.isPreview ||
                        lastProgram != deviceState.isProgram ||
                        lastStreaming != deviceState.isStreaming ||
                        lastRecording != deviceState.isRecording ||
                        lastServerConnected != deviceState.serverConnected);
    
    // Only update display when state actually changes to prevent flickering and save power
    static unsigned long lastDisplayUpdate = 0;
    if (stateChanged || millis() - lastDisplayUpdate > 10000) { // Force update every 10 seconds max
        updateDisplay();
        lastDisplayUpdate = millis();
        
        // Update last states
        lastPreview = deviceState.isPreview;
        lastProgram = deviceState.isProgram;
        lastStreaming = deviceState.isStreaming;
        lastRecording = deviceState.isRecording;
        lastServerConnected = deviceState.serverConnected;
    }
    
    // Update LED status (for recording/preview indicators) - reduce frequency to save power
    static unsigned long lastLEDUpdate = 0;
    if (millis() - lastLEDUpdate > 100) { // Update LED max 10 times per second
        updateLED();
        lastLEDUpdate = millis();
    }
    
    // Update power management state
    updatePowerState();
    
    // Handle button presses
    if (M5.BtnA.wasPressed()) {
        // Update activity on button press
        updateActivity();
        
        // Short press A button to rotate display
        static uint8_t rotation = 3;
        rotation = (rotation + 1) % 4;
        M5.Lcd.setRotation(rotation);
        updateDisplay();
    }
    
    // Advanced Button B handling
    handleButtonB();
    
    // Small delay to prevent tight loop (adjust based on power save mode)
    delay(powerState.powerSaveMode ? 200 : 100);
}

// Brightness control for M5StickC Plus - uses AXP192 power management only
void setBrightness(uint8_t brightness) {
    // Ensure display power is enabled first
    M5.Axp.SetLDO2(true);  // Enable LCD backlight power supply
    
    // Use AXP192 ScreenBreath for brightness control (0-100 range)
    // This is the correct method for M5StickC Plus backlight control
    uint8_t axpBrightness = map(brightness, 0, 255, 0, 100);  // Map to full 0-100 range
    M5.Axp.ScreenBreath(axpBrightness);
    
    DEBUG_PORT.println("Brightness set - AXP192 ScreenBreath: " + String(axpBrightness) + " (0-100 range), Input: " + String(brightness) + " (0-255)");
}

void updateDisplay() {
    M5.Lcd.fillScreen(TFT_BLACK);
    
    // Get WiFi signal strength and battery level
    int32_t wifiSignal = WiFi.RSSI();
    float batteryVoltage = M5.Axp.GetBatVoltage();
    int batteryPercent = map(batteryVoltage * 1000, 3200, 4200, 0, 100);
    batteryPercent = constrain(batteryPercent, 0, 100);
    
    if (!deviceState.serverConnected) {
        M5.Lcd.setTextColor(TFT_YELLOW);
        M5.Lcd.setTextSize(2);
        // Center "NO SERVER" text
        int textWidth = strlen("NO SERVER") * 12; // Approximate width for size 2
        M5.Lcd.setCursor((M5.Lcd.width() - textWidth) / 2, 30);
        M5.Lcd.println("NO SERVER");
        
        M5.Lcd.setTextSize(1);
        String ipStr = WiFi.localIP().toString();
        int ipWidth = ipStr.length() * 6; // Approximate width for size 1
        M5.Lcd.setCursor((M5.Lcd.width() - ipWidth) / 2, 55);
        M5.Lcd.println(ipStr);
        
        // Show WiFi and battery even when no server
        drawWiFiAndBattery(wifiSignal, batteryPercent);
        return;
    }
    
    // Choose colors based on status
    uint16_t bgColor, textColor;
    String statusText;
    int textSize;
    uint8_t brightness;
    
    if (deviceState.isProgram) {
        bgColor = TFT_RED;
        textColor = TFT_WHITE;
        statusText = "LIVE";
        textSize = 4;
        brightness = BRIGHTNESS_LIVE;
    } else if (deviceState.isPreview) {
        bgColor = TFT_ORANGE;
        textColor = TFT_BLACK;
        statusText = "PREVIEW";
        textSize = 3;
        brightness = BRIGHTNESS_PREVIEW;
    } else {
        bgColor = TFT_DARKGREY;
        textColor = TFT_WHITE;
        statusText = "IDLE";
        textSize = 3;
        brightness = BRIGHTNESS_IDLE;
    }
    
    // Set brightness based on status
    setBrightness(brightness);
    
    M5.Lcd.fillScreen(bgColor);
    
    // Display source name at the top, centered and larger
    if (strlen(deviceState.assignedSource) > 0) {
        M5.Lcd.setTextColor(textColor);
        M5.Lcd.setTextSize(2); // Larger text for source name
        String sourceStr = String(deviceState.assignedSource);
        int sourceWidth = sourceStr.length() * 12; // Approximate width for size 2
        M5.Lcd.setCursor((M5.Lcd.width() - sourceWidth) / 2, 10);
        M5.Lcd.println(sourceStr);
    } else {
        M5.Lcd.setTextColor(TFT_YELLOW);
        M5.Lcd.setTextSize(1);
        String notAssignedStr = "NOT ASSIGNED";
        int notAssignedWidth = notAssignedStr.length() * 6; // Approximate width for size 1
        M5.Lcd.setCursor((M5.Lcd.width() - notAssignedWidth) / 2, 15);
        M5.Lcd.println(notAssignedStr);
    }
    
    // Display large status text in center of screen
    M5.Lcd.setTextColor(textColor);
    M5.Lcd.setTextSize(textSize);
    int statusWidth = statusText.length() * (6 * textSize); // Approximate width
    int statusHeight = 8 * textSize; // Approximate height
    M5.Lcd.setCursor((M5.Lcd.width() - statusWidth) / 2, (M5.Lcd.height() - statusHeight) / 2);
    M5.Lcd.println(statusText);
    
    // Show recording/streaming status at bottom center - LARGER and more visible
    // Enhanced debug output for recording/streaming status
    Serial.printf("[DISPLAY] Recording: %s, Streaming: %s\n", 
                  deviceState.isRecording ? "TRUE" : "FALSE",
                  deviceState.isStreaming ? "TRUE" : "FALSE");
    
    if (deviceState.isRecording || deviceState.isStreaming) {
        int indicatorY = M5.Lcd.height() - 45; // Higher position for better visibility
        Serial.printf("[DISPLAY] Drawing indicators at Y=%d\n", indicatorY);
        
        if (deviceState.isRecording) {
            Serial.println("[DISPLAY] Drawing RECORDING indicator");
            // Large red recording indicator
            M5.Lcd.fillCircle(20, indicatorY, 6, TFT_RED);
            M5.Lcd.setTextSize(2); // Larger text
            M5.Lcd.setTextColor(TFT_WHITE);
            M5.Lcd.setCursor(35, indicatorY - 8);
            M5.Lcd.println("REC");
        }
        
        if (deviceState.isStreaming) {
            int streamX = deviceState.isRecording ? 100 : 20; // Position next to recording or alone
            Serial.printf("[DISPLAY] Drawing STREAMING indicator at X=%d\n", streamX);
            // Large blue streaming indicator
            M5.Lcd.fillRect(streamX - 8, indicatorY - 8, 16, 16, TFT_BLUE);
            M5.Lcd.setTextSize(2); // Larger text
            M5.Lcd.setTextColor(TFT_WHITE);
            M5.Lcd.setCursor(streamX + 15, indicatorY - 8);
            M5.Lcd.println("LIVE");
        }
    } else {
        Serial.println("[DISPLAY] No recording/streaming indicators to show");
    }
    
    // Draw WiFi and battery indicators at the bottom
    drawWiFiAndBattery(wifiSignal, batteryPercent);
}

// Helper function to draw WiFi signal and battery level (larger and more visible)
void drawWiFiAndBattery(int32_t wifiSignal, int batteryPercent) {
    // Position indicators at bottom of screen with more space
    int bottomY = M5.Lcd.height() - 20; // More space from bottom
    
    // WiFi signal strength (bottom left) - LARGER
    uint16_t wifiColor = TFT_GREEN;
    if (wifiSignal < -70) wifiColor = TFT_RED;
    else if (wifiSignal < -60) wifiColor = TFT_YELLOW;
    
    // Draw larger WiFi icon with thicker bars
    int wifiStrength = map(wifiSignal, -90, -30, 1, 4);
    wifiStrength = constrain(wifiStrength, 1, 4);
    
    for (int i = 0; i < 4; i++) {
        uint16_t barColor = (i < wifiStrength) ? wifiColor : TFT_DARKGREY;
        int barHeight = 4 + (i * 3); // Taller bars
        int barWidth = 3; // Wider bars
        M5.Lcd.fillRect(8 + (i * 5), bottomY + 8 - barHeight, barWidth, barHeight, barColor);
    }
    
    // WiFi signal strength text
    M5.Lcd.setTextSize(1);
    M5.Lcd.setTextColor(wifiColor);
    M5.Lcd.setCursor(5, bottomY + 10);
    M5.Lcd.println("WiFi");
    
    // Battery level (bottom right) - LARGER
    // Check if battery is charging
    float chargeCurrent = M5.Axp.GetBatChargeCurrent();
    bool isCharging = chargeCurrent > 1.0; // Consider charging if current > 1mA
    
    uint16_t batteryColor = TFT_GREEN;
    if (batteryPercent < 20) batteryColor = TFT_RED;
    else if (batteryPercent < 40) batteryColor = TFT_YELLOW;
    
    // Draw larger battery outline
    int batteryX = M5.Lcd.width() - 35;
    int batteryY = bottomY - 8;
    int batteryWidth = 28;
    int batteryHeight = 14;
    
    M5.Lcd.drawRect(batteryX, batteryY, batteryWidth, batteryHeight, TFT_WHITE);
    M5.Lcd.fillRect(batteryX + batteryWidth, batteryY + 3, 3, 8, TFT_WHITE); // Battery tip
    
    // Fill battery based on percentage with thicker fill
    int fillWidth = map(batteryPercent, 0, 100, 0, batteryWidth - 2);
    M5.Lcd.fillRect(batteryX + 1, batteryY + 1, fillWidth, batteryHeight - 2, batteryColor);
    
    // Add charging indicator if charging
    if (isCharging) {
        // Draw lightning bolt icon in the middle of the battery
        uint16_t lightningColor = TFT_CYAN;
        int centerX = batteryX + batteryWidth / 2;
        int centerY = batteryY + batteryHeight / 2;
        
        // Simple lightning bolt using lines
        M5.Lcd.drawLine(centerX - 3, centerY - 4, centerX + 1, centerY, lightningColor);
        M5.Lcd.drawLine(centerX + 1, centerY, centerX - 3, centerY + 4, lightningColor);
        M5.Lcd.drawLine(centerX - 1, centerY - 2, centerX + 3, centerY + 2, lightningColor);
    }
    
    // Show larger percentage text next to battery with charging indicator
    M5.Lcd.setTextSize(1);
    M5.Lcd.setTextColor(batteryColor);
    String battStr = String(batteryPercent) + "%";
    if (isCharging) {
        battStr += " CHG";
    }
    M5.Lcd.setCursor(batteryX - 35, bottomY + 10);
    M5.Lcd.println(battStr);
}

// Load configuration from preferences
bool loadConfig() {
    preferences.begin("obs-tally", false);
    String configVersion = preferences.getString("version", "");
    
    if (configVersion != CONFIG_VERSION) {
        preferences.end();
        return false;
    }
    
    String serverIP = preferences.getString("server_ip", "");
    serverIP.toCharArray(deviceState.serverIP, 16);
    deviceState.serverPort = preferences.getUInt("server_port", 3005);
    
    String deviceName = preferences.getString("device_name", "");
    deviceName.toCharArray(deviceState.deviceName, 32);
    
    String assignedSource = preferences.getString("assigned_source", "");
    assignedSource.toCharArray(deviceState.assignedSource, 64);
    
    String hostname = preferences.getString("hostname", DEFAULT_HOSTNAME);
    hostname.toCharArray(deviceState.hostname, 32);
    
    preferences.end();
    return true;
}

// Save configuration to preferences
void saveConfig() {
    preferences.begin("obs-tally", false);
    preferences.putString("version", CONFIG_VERSION);
    preferences.putString("server_ip", deviceState.serverIP);
    preferences.putUInt("server_port", deviceState.serverPort);
    preferences.putString("device_name", deviceState.deviceName);
    preferences.putString("assigned_source", deviceState.assignedSource);
    preferences.putString("hostname", deviceState.hostname);
    preferences.end();
}

// Reset to factory defaults
void factoryReset() {
    M5.Lcd.fillScreen(TFT_BLACK);
    M5.Lcd.setTextColor(TFT_YELLOW);
    M5.Lcd.setCursor(10, 20);
    M5.Lcd.println("Factory Reset");
    
    // Clear preferences
    preferences.begin("obs-tally", false);
    preferences.clear();
    preferences.end();
    
    // Give visual feedback
    M5.Lcd.setCursor(10, 40);
    M5.Lcd.println("Complete");
    M5.Lcd.setCursor(10, 60);
    M5.Lcd.println("Rebooting...");
    
    // Brief delay before restart
    delay(3000);
    
    // Ensure clean WiFi disconnect
    WiFi.disconnect(true);
    delay(1000);
    
    ESP.restart();
}

void setupWiFi() {
    WiFi.mode(WIFI_STA);
    WiFi.hostname(deviceState.hostname);

    WiFiManager wifiManager;
    wifiManager.setConfigPortalTimeout(CONFIG_PORTAL_TIMEOUT);
    
    // Reduce WiFi power to prevent brownout
    WiFi.setTxPower(WIFI_POWER_8_5dBm);
    
    String apName = String("OBS-Tally-") + String((uint32_t)ESP.getEfuseMac(), HEX);
    String apPassword = "obstally123"; // Simple password to prevent accidental connections
    
    // Configure timeouts and retry behavior
    wifiManager.setConnectTimeout(20);
    wifiManager.setDebugOutput(true);
    
    // Show connection status on display
    M5.Lcd.fillScreen(TFT_BLACK);
    M5.Lcd.setTextColor(TFT_WHITE);
    M5.Lcd.setCursor(10, 20);
    
    if (!wifiManager.autoConnect(apName.c_str(), apPassword.c_str())) {
        // If connection fails, show error but don't restart immediately
        M5.Lcd.fillScreen(TFT_RED);
        M5.Lcd.setTextColor(TFT_WHITE);
        M5.Lcd.setCursor(10, 20);
        M5.Lcd.println("WiFi Failed");
        M5.Lcd.setCursor(10, 40);
        M5.Lcd.println("AP Mode:");
        M5.Lcd.setCursor(10, 60);
        M5.Lcd.println(apName);
        
        // Stay in AP mode for configuration
        deviceState.configMode = true;
        return;
    }
    
    // Successfully connected
    M5.Lcd.fillScreen(TFT_GREEN);
    M5.Lcd.setTextColor(TFT_BLACK);
    
    // Initialize device ID and MAC address for registration
    deviceState.macAddress = WiFi.macAddress();
    deviceState.deviceID = "m5stick-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    M5.Lcd.setCursor(10, 20);
    M5.Lcd.println("Connected to:");
    M5.Lcd.setCursor(10, 40);
    M5.Lcd.println(WiFi.SSID());
    delay(2000);
}

void setupWebServer() {
    webServer.on("/", handleRoot);
    webServer.on("/config", HTTP_GET, handleConfig);
    webServer.on("/config", HTTP_POST, handleConfigPost);
    webServer.on("/update", HTTP_GET, handleUpdate);
    webServer.on("/update", HTTP_POST, handleUpdateResponse, handleUpdateFile);
    webServer.on("/reset", HTTP_GET, []() {
        webServer.send(200, "text/plain", "Device will restart in 3 seconds...");
        delay(3000);
        ESP.restart();
    });
    webServer.on("/api/reset", HTTP_POST, []() {
        JsonDocument doc;
        doc["success"] = true;
        doc["message"] = "Device reset initiated";
        
        String response;
        serializeJson(doc, response);
        webServer.send(200, "application/json", response);
        
        // Restart after a short delay to allow response to be sent
        delay(100);
        ESP.restart();
    });
    webServer.on("/status", handleStatus);
    webServer.on("/api/device-info", HTTP_GET, []() {
        JsonDocument doc;
        doc["device_type"] = DEVICE_TYPE;
        doc["firmware_version"] = FIRMWARE_VERSION;
        doc["device_name"] = deviceState.deviceName;
        doc["assigned_source"] = deviceState.assignedSource;
        doc["ip"] = WiFi.localIP().toString();
        doc["mac"] = WiFi.macAddress();
        doc["hostname"] = deviceState.hostname;
        JsonObject state = doc["state"].to<JsonObject>();
        state["preview"] = deviceState.isPreview;
        state["program"] = deviceState.isProgram;
        state["streaming"] = deviceState.isStreaming;
        state["recording"] = deviceState.isRecording;
        state["connected"] = deviceState.serverConnected;
        
        String response;
        serializeJson(doc, response);
        webServer.send(200, "application/json", response);
    });
    
    // Add firmware info endpoint for server health checks
    webServer.on("/api/firmware/info", HTTP_GET, []() {
        JsonDocument doc;
        doc["device_type"] = DEVICE_TYPE;
        doc["firmware_version"] = FIRMWARE_VERSION;
        doc["model"] = "M5StickC-PLUS";
        doc["device_name"] = deviceState.deviceName;
        doc["mac"] = WiFi.macAddress();
        doc["uptime"] = millis() / 1000;
        
        String response;
        serializeJson(doc, response);
        webServer.send(200, "application/json", response);
    });
    
    // Add firmware cleanup endpoint (to erase old firmware)
    webServer.on("/api/firmware/erase-old", HTTP_POST, []() {
        JsonDocument doc;
        
        // M5StickC doesn't support explicit firmware cleanup
        // but we can return success to maintain API compatibility
        doc["success"] = true;
        doc["message"] = "No operation needed for M5StickC";
        
        String response;
        serializeJson(doc, response);
        webServer.send(200, "application/json", response);
    });
    
    // Handle tally status updates from server
    webServer.on("/api/tally", HTTP_POST, []() {
        if (webServer.hasArg("plain")) {
            String body = webServer.arg("plain");
            JsonDocument doc;
            DeserializationError error = deserializeJson(doc, body);
            
            if (!error) {
                // Update device state from tally data
                deviceState.isPreview = doc["status"] == "Preview";
                deviceState.isProgram = doc["status"] == "Live" || doc["status"] == "Program";
                
                // Handle enhanced recording/streaming status format
                DEBUG_PORT.println("[TALLY] Processing recording/streaming status...");
                
                if (doc["recordingStatus"].is<JsonObject>()) {
                    bool newRecordingState = doc["recordingStatus"]["active"] | false;
                    DEBUG_PORT.printf("[TALLY] Enhanced recording format - active: %s\n", 
                                     newRecordingState ? "TRUE" : "FALSE");
                    deviceState.isRecording = newRecordingState;
                } else if (doc["recording"].is<bool>()) {
                    bool newRecordingState = doc["recording"] | false;
                    DEBUG_PORT.printf("[TALLY] Legacy recording format - value: %s\n", 
                                     newRecordingState ? "TRUE" : "FALSE");
                    deviceState.isRecording = newRecordingState;
                } else {
                    DEBUG_PORT.println("[TALLY] No recording status found in payload");
                    deviceState.isRecording = false;
                }
                
                if (doc["streamingStatus"].is<JsonObject>()) {
                    bool newStreamingState = doc["streamingStatus"]["active"] | false;
                    DEBUG_PORT.printf("[TALLY] Enhanced streaming format - active: %s\n", 
                                     newStreamingState ? "TRUE" : "FALSE");
                    deviceState.isStreaming = newStreamingState;
                } else if (doc["streaming"].is<bool>()) {
                    bool newStreamingState = doc["streaming"] | false;
                    DEBUG_PORT.printf("[TALLY] Legacy streaming format - value: %s\n", 
                                     newStreamingState ? "TRUE" : "FALSE");
                    deviceState.isStreaming = newStreamingState;
                } else {
                    DEBUG_PORT.println("[TALLY] No streaming status found in payload");
                    deviceState.isStreaming = false;
                }
                
                deviceState.serverConnected = doc["obsConnected"] | true;
                
                // Update device name if provided
                if (doc["deviceName"]) {
                    String newDeviceName = doc["deviceName"];
                    newDeviceName.toCharArray(deviceState.deviceName, 32);
                }
                
                // Update assigned source if provided and save to persistent storage
                if (doc["assignedSource"]) {
                    String newAssignedSource = doc["assignedSource"];
                    String currentAssignedSource = String(deviceState.assignedSource);
                    
                    if (newAssignedSource != currentAssignedSource) {
                        newAssignedSource.toCharArray(deviceState.assignedSource, 64);
                        saveConfig(); // Save the updated assigned source to persistent storage
                        DEBUG_PORT.println("Assigned source updated and saved: " + newAssignedSource);
                    }
                }
                
                DEBUG_PORT.println("[TALLY] Status updated successfully:");
                DEBUG_PORT.println("  Status: " + String(doc["status"].as<const char*>()));
                DEBUG_PORT.println("  Preview: " + String(deviceState.isPreview));
                DEBUG_PORT.println("  Program: " + String(deviceState.isProgram));
                DEBUG_PORT.printf("  Recording: %s (isRecording=%d)\n", 
                                 deviceState.isRecording ? "TRUE" : "FALSE", deviceState.isRecording);
                DEBUG_PORT.printf("  Streaming: %s (isStreaming=%d)\n", 
                                 deviceState.isStreaming ? "TRUE" : "FALSE", deviceState.isStreaming);
                DEBUG_PORT.println("  Server Connected: " + String(deviceState.serverConnected));
                DEBUG_PORT.println("  Assigned Source: " + String(deviceState.assignedSource));
                
                // Force display update to show new recording/streaming status
                updateDisplay();
                
                webServer.send(200, "application/json", "{\"success\":true}");
            } else {
                DEBUG_PORT.println("Failed to parse tally JSON");
                webServer.send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
            }
        } else {
            DEBUG_PORT.println("No tally data received");
            webServer.send(400, "application/json", "{\"error\":\"No data\"}");
        }
    });
    
    webServer.begin();
}

void setupMDNS() {
    if (MDNS.begin(deviceState.hostname)) {
        MDNS.addService("http", "tcp", 80);
        MDNS.addService("obs-tally", "udp", UDP_PORT);
    }
}

void setupOTA() {
    ArduinoOTA.setHostname(deviceState.hostname);
    ArduinoOTA.onStart([]() {
        M5.Lcd.fillScreen(TFT_BLACK);
        M5.Lcd.setCursor(0, 0);
        M5.Lcd.println("OTA Update");
    });
    
    ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
        float percent = (float)progress / (float)total * 100.0;
        M5.Lcd.setCursor(0, 20);
        M5.Lcd.printf("Progress: %u%%\n", (unsigned int)percent);
    });
    
    ArduinoOTA.onEnd([]() {
        M5.Lcd.println("\nUpdate complete!");
        delay(1000);
    });
    
    ArduinoOTA.onError([](ota_error_t error) {
        M5.Lcd.printf("Error[%u]: ", error);
        switch (error) {
            case OTA_AUTH_ERROR: M5.Lcd.println("Auth Failed"); break;
            case OTA_BEGIN_ERROR: M5.Lcd.println("Begin Failed"); break;
            case OTA_CONNECT_ERROR: M5.Lcd.println("Connect Failed"); break;
            case OTA_RECEIVE_ERROR: M5.Lcd.println("Receive Failed"); break;
            case OTA_END_ERROR: M5.Lcd.println("End Failed"); break;
        }
        delay(3000);
    });
    
    ArduinoOTA.begin();
}

void handleRoot() {
    String tallyStatusColor = "gray";
    String tallyStatusText = "IDLE";
    
    if (deviceState.isProgram) {
        tallyStatusColor = "#ff3b30";
        tallyStatusText = "LIVE";
    } else if (deviceState.isPreview) {
        tallyStatusColor = "#ff9500";
        tallyStatusText = "PREVIEW";
    }
    
    String html = R"(
<!DOCTYPE html>
<html>
<head>
    <title>)" + String(deviceState.hostname) + R"(</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            margin: 0; 
            padding: 20px; 
            background: #1a1a1a; 
            color: #fff; 
            line-height: 1.6;
        }
        .container { max-width: 600px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 30px; }
        .device-name { font-size: 2em; margin-bottom: 10px; }
        .tally-status { 
            font-size: 3em; 
            font-weight: bold; 
            margin: 20px 0; 
            padding: 20px; 
            border-radius: 12px; 
            background: )" + tallyStatusColor + R"(; 
            color: )" + (deviceState.isPreview ? "black" : "white") + R"(;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }
        .info-grid { 
            display: grid; 
            gap: 15px; 
            margin: 30px 0; 
        }
        .info-item { 
            background: #2a2a2a; 
            padding: 15px; 
            border-radius: 8px; 
            border-left: 4px solid #007aff;
        }
        .info-label { 
            font-size: 0.9em; 
            color: #999; 
            margin-bottom: 5px; 
        }
        .info-value { 
            font-size: 1.1em; 
            font-weight: 500; 
        }
        .actions { 
            display: grid; 
            gap: 10px; 
            margin-top: 30px; 
        }
        .btn { 
            background: #007aff; 
            color: white; 
            border: none; 
            padding: 12px 20px; 
            border-radius: 8px; 
            font-size: 1em; 
            cursor: pointer; 
            text-decoration: none; 
            text-align: center; 
            transition: background 0.2s;
        }
        .btn:hover { background: #0056b3; }
        .btn.danger { background: #ff3b30; }
        .btn.danger:hover { background: #d62d20; }
        .status-indicators { 
            display: flex; 
            gap: 10px; 
            justify-content: center; 
            margin: 20px 0; 
        }
        .status-badge { 
            padding: 5px 10px; 
            border-radius: 20px; 
            font-size: 0.8em; 
            font-weight: 500; 
        }
        .recording { background: #ff3b30; color: white; }
        .streaming { background: #007aff; color: white; }
        .connected { background: #34c759; color: white; }
        .disconnected { background: #8e8e93; color: white; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="device-name">)" + String(deviceState.deviceName) + R"(</div>
            <div class="tally-status">)" + tallyStatusText + R"(</div>
        </div>
        
        <div class="status-indicators">)";
    
    if (deviceState.serverConnected) {
        html += R"(<span class="status-badge connected">CONNECTED</span>)";
    } else {
        html += R"(<span class="status-badge disconnected">DISCONNECTED</span>)";
    }
    
    if (deviceState.isRecording) {
        html += R"(<span class="status-badge recording">RECORDING</span>)";
    }
    
    if (deviceState.isStreaming) {
        html += R"(<span class="status-badge streaming">STREAMING</span>)";
    }
    
    html += R"(</div>
        
        <div class="info-grid">
            <div class="info-item">
                <div class="info-label">Assigned Source</div>
                <div class="info-value">)" + (strlen(deviceState.assignedSource) > 0 ? String(deviceState.assignedSource) : "Not Assigned") + R"(</div>
            </div>
            <div class="info-item">
                <div class="info-label">IP Address</div>
                <div class="info-value">)" + WiFi.localIP().toString() + R"(</div>
            </div>
            <div class="info-item">
                <div class="info-label">Firmware Version</div>
                <div class="info-value">)" + String(FIRMWARE_VERSION) + R"(</div>
            </div>
            <div class="info-item">
                <div class="info-label">Server Connection</div>
                <div class="info-value">)" + String(deviceState.serverIP) + ":" + String(deviceState.serverPort) + R"(</div>
            </div>
        </div>
        
        <div class="actions">
            <a href="/config" class="btn">Configuration</a>
            <a href="/update" class="btn">Firmware Update</a>
            <a href="/reset" class="btn danger">Factory Reset</a>
        </div>
    </div>
    
    <script>
        // Auto-refresh every 30 seconds to reduce server load and power consumption
        setTimeout(() => location.reload(), 30000);
    </script>
</body>
</html>)";
    
    webServer.send(200, "text/html", html);
}

void handleConfigPost() {
    String newServerIP = webServer.arg("server_ip");
    String newDeviceName = webServer.arg("device_name");
    uint16_t newServerPort = webServer.arg("server_port").toInt();
    
    if (newServerIP.length() > 0) {
        newServerIP.toCharArray(deviceState.serverIP, 16);
    }
    if (newDeviceName.length() > 0) {
        newDeviceName.toCharArray(deviceState.deviceName, 32);
    }
    if (newServerPort > 0) {
        deviceState.serverPort = newServerPort;
    }
    
    saveConfig();
    webServer.sendHeader("Location", "/");
    webServer.send(303);
}

void handleConfig() {
    String html = "<html><head><title>Configuration</title></head>";
    html += "<body><h1>Configuration</h1>";
    html += "<form method='post'>";
    html += "Server IP: <input name='server_ip' value='" + String(deviceState.serverIP) + "'><br>";
    html += "Server Port: <input name='server_port' value='" + String(deviceState.serverPort) + "'><br>";
    html += "Device Name: <input name='device_name' value='" + String(deviceState.deviceName) + "'><br>";
    html += "<input type='submit' value='Save'>";
    html += "</form></body></html>";
    webServer.send(200, "text/html", html);
}

void handleUpdateFile() {
    HTTPUpload& upload = webServer.upload();
    if (upload.status == UPLOAD_FILE_START) {
        M5.Lcd.fillScreen(TFT_BLACK);
        M5.Lcd.setCursor(0, 0);
        M5.Lcd.println("Update starting...");
        if (!Update.begin(UPDATE_SIZE_UNKNOWN)) {
            Update.printError(DEBUG_PORT);
        }
    } else if (upload.status == UPLOAD_FILE_WRITE) {
        if (Update.write(upload.buf, upload.currentSize) != upload.currentSize) {
            Update.printError(DEBUG_PORT);
        }
    } else if (upload.status == UPLOAD_FILE_END) {
        if (Update.end(true)) {
            M5.Lcd.println("Update Success!");
        } else {
            Update.printError(DEBUG_PORT);
        }
    }
}

void handleUpdateResponse() {
    if (Update.hasError()) {
        webServer.send(200, "text/plain", "UPDATE FAILED");
    } else {
        webServer.send(200, "text/plain", "Update successful! Rebooting...");
        delay(1000);
        ESP.restart();
    }
}

void handleUpdate() {
    String html = "<html><head><title>Firmware Update</title></head>";
    html += "<body><h1>Firmware Update</h1>";
    html += "<form method='post' enctype='multipart/form-data'>";
    html += "<input type='file' name='update'>";
    html += "<input type='submit' value='Update'>";
    html += "</form></body></html>";
    webServer.send(200, "text/html", html);
}

void handleReset() {
    webServer.send(200, "text/plain", "Resetting to factory defaults...");
    delay(1000);
    factoryReset();
}

void handleStatus() {
    JsonDocument doc;
    doc["device_name"] = deviceState.deviceName;
    doc["preview"] = deviceState.isPreview;
    doc["program"] = deviceState.isProgram;
    doc["streaming"] = deviceState.isStreaming;
    doc["recording"] = deviceState.isRecording;
    doc["connected"] = deviceState.serverConnected;
    
    String response;
    serializeJson(doc, response);
    webServer.send(200, "application/json", response);
}

void checkServer() {
    if (strlen(deviceState.serverIP) == 0) return;
    
    HTTPClient http;
    String url = "http://" + String(deviceState.serverIP) + ":" + String(deviceState.serverPort) + "/device/status";
    http.begin(url);
    
    int httpCode = http.GET();
    if (httpCode == HTTP_CODE_OK) {
        String payload = http.getString();
        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, payload);
        
        if (!error) {
            deviceState.isPreview = doc["preview"] | false;
            deviceState.isProgram = doc["program"] | false;
            deviceState.isStreaming = doc["streaming"] | false;
            deviceState.isRecording = doc["recording"] | false;
            deviceState.serverConnected = true;
        }
    } else {
        deviceState.serverConnected = false;
    }
    http.end();
}

void announceDevice() {
    JsonDocument doc;
    doc["type"] = "device-announce";  // Changed to match server's expected type
    doc["deviceId"] = deviceState.deviceID;  // Use proper unique deviceID
    doc["deviceName"] = deviceState.deviceName;
    doc["ipAddress"] = WiFi.localIP().toString();  // Changed from "ip" to "ipAddress"
    doc["macAddress"] = WiFi.macAddress();  // Changed from "mac" to "macAddress"
    doc["firmware"] = FIRMWARE_VERSION;  // Changed from "version" to "firmware"
    doc["model"] = DEVICE_TYPE;  // Changed from "type" to "model"
    doc["assignedSource"] = deviceState.assignedSource;
    doc["timestamp"] = millis();
    
    String message;
    serializeJson(doc, message);
    
    // Send to configured server IP if available
    if (strlen(deviceState.serverIP) > 0) {
        udp.beginPacket(deviceState.serverIP, 3006);
        udp.write((uint8_t*)message.c_str(), message.length());
        udp.endPacket();
    }
    
    // Also send broadcast for auto-discovery
    IPAddress broadcastIP(255, 255, 255, 255);
    udp.beginPacket(broadcastIP, 3006);
    udp.write((uint8_t*)message.c_str(), message.length());
    udp.endPacket();
    
    deviceState.lastAnnounce = millis();
    Serial.println("Device announcement sent to server and broadcast");
}

void registerDevice() {
    if (WiFi.status() != WL_CONNECTED || strlen(deviceState.serverIP) == 0) {
        return;
    }
    
    Serial.println("Registering device with server...");
    
    HTTPClient http;
    String url = "http://" + String(deviceState.serverIP) + ":" + String(deviceState.serverPort) + "/api/esp32/register";
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    
    JsonDocument doc;
    doc["deviceId"] = deviceState.deviceID;
    doc["deviceName"] = strlen(deviceState.deviceName) > 0 ? deviceState.deviceName : "M5StickC-Tally";
    doc["ipAddress"] = WiFi.localIP().toString();
    doc["macAddress"] = deviceState.macAddress;
    doc["firmware"] = FIRMWARE_VERSION;
    doc["model"] = DEVICE_TYPE;
    doc["assignedSource"] = deviceState.assignedSource;
    
    String jsonString;
    serializeJson(doc, jsonString);
    
    int httpCode = http.POST(jsonString);
    
    if (httpCode > 0) {
        String response = http.getString();
        Serial.println("Registration response: " + response);
        
        if (httpCode == 200) {
            deviceState.isRegistered = true;
            deviceState.serverConnected = true;
            Serial.println("Device registration successful");
        } else {
            Serial.println("Registration failed: HTTP " + String(httpCode));
            deviceState.isRegistered = false;
        }
    } else {
        Serial.println("Registration failed: " + http.errorToString(httpCode));
        deviceState.isRegistered = false;
    }
    
    http.end();
}

void sendHeartbeat() {
    if (WiFi.status() != WL_CONNECTED || strlen(deviceState.serverIP) == 0) {
        return;
    }
    
    // If not registered, try to register first
    if (!deviceState.isRegistered) {
        registerDevice();
        return; // Exit and try heartbeat on next cycle
    }
    
    HTTPClient http;
    String url = "http://" + String(deviceState.serverIP) + ":" + String(deviceState.serverPort) + "/api/heartbeat";
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    
    JsonDocument doc;
    doc["id"] = deviceState.deviceID;
    doc["status"] = deviceState.isProgram ? "Live" : (deviceState.isPreview ? "Preview" : "Idle");
    doc["uptime"] = millis();
    doc["ip"] = WiFi.localIP().toString();
    doc["assignedSource"] = deviceState.assignedSource;
    
    String jsonString;
    serializeJson(doc, jsonString);
    
    int httpCode = http.POST(jsonString);
    
    if (httpCode > 0) {
        String response = http.getString();
        
        if (httpCode == 200) {
            JsonDocument responseDoc;
            DeserializationError error = deserializeJson(responseDoc, response);
            
            if (!error) {
                // Update device state from server response
                if (responseDoc["status"].is<String>()) {
                    String newStatus = responseDoc["status"].as<String>();
                    if (newStatus == "Live") {
                        deviceState.isProgram = true;
                        deviceState.isPreview = false;
                    } else if (newStatus == "Preview") {
                        deviceState.isProgram = false;
                        deviceState.isPreview = true;
                    } else {
                        deviceState.isProgram = false;
                        deviceState.isPreview = false;
                    }
                }
                
                // Update streaming/recording status if provided
                if (responseDoc["recording"].is<bool>()) {
                    deviceState.isRecording = responseDoc["recording"] | false;
                }
                if (responseDoc["streaming"].is<bool>()) {
                    deviceState.isStreaming = responseDoc["streaming"] | false;
                }
            }
            
            deviceState.serverConnected = true;
            Serial.println("Heartbeat successful");
        } else if (httpCode == 404) {
            // Device not registered on server, clear registration flag
            deviceState.isRegistered = false;
            deviceState.serverConnected = false;
            Serial.println("Device not registered on server, will re-register");
        } else {
            deviceState.serverConnected = false;
            Serial.println("Heartbeat failed: HTTP " + String(httpCode));
        }
    } else {
        deviceState.serverConnected = false;
        Serial.println("Heartbeat failed: " + http.errorToString(httpCode));
    }
    
    http.end();
    deviceState.lastHeartbeat = millis();
}

// LED control function - solid red for live, blinking red for preview, off for idle
void updateLED() {
    static unsigned long lastLEDBlink = 0;
    static bool ledState = false;
    
    // Check if LED is manually disabled - Always turn LED off in this case
    if (deviceState.ledManuallyDisabled) {
        digitalWrite(LED_PIN, HIGH); // LED OFF (HIGH = OFF for M5StickC Plus)
        ledState = false;
        return;
    }
    
    // Check for error conditions first - turn off LED
    if (!deviceState.serverConnected || WiFi.status() != WL_CONNECTED || deviceState.configMode) {
        // LED off for no server connection, no WiFi, or config mode
        digitalWrite(LED_PIN, HIGH); // LED OFF (HIGH = OFF for M5StickC Plus)
        ledState = false; // Reset blink state
        return;
    }
    
    if (deviceState.isProgram) {
        // Solid red LED for LIVE/program (LED ON)
        digitalWrite(LED_PIN, LOW); // LED ON (LOW = ON for M5StickC Plus)
        ledState = true; // Keep track of state
    } else if (deviceState.isPreview) {
        // Blinking red LED for preview
        if (millis() - lastLEDBlink > LED_BLINK_INTERVAL) {
            ledState = !ledState;
            digitalWrite(LED_PIN, ledState ? LOW : HIGH); // Toggle LED (LOW = ON, HIGH = OFF)
            lastLEDBlink = millis();
        }
    } else {
        // LED off for idle (when not in preview or program)
        digitalWrite(LED_PIN, HIGH); // LED OFF (HIGH = OFF for M5StickC Plus)
        ledState = false; // Reset blink state
    }
}

// Advanced Button B handling function
void handleButtonB() {
    const unsigned long DOUBLE_CLICK_TIME = 400; // ms for double click detection
    const unsigned long LONG_PRESS_TIME = 1500;  // ms for long press detection
    
    // Handle button press start
    if (M5.BtnB.wasPressed()) {
        // Update activity on any button press
        updateActivity();
        
        buttonState.btnB_PressStart = millis();
        buttonState.btnB_IsPressed = true;
        buttonState.btnB_LongPressHandled = false;
        
        Serial.println("[BUTTON] Button B pressed");
        
        // Check for double click
        if (buttonState.btnB_WaitingForDouble) {
            // This is a double click
            buttonState.btnB_WaitingForDouble = false;
            buttonState.btnB_ClickCount = 2;
            Serial.println("[BUTTON] Double click detected");
            
            // Double click action: Server check/heartbeat
            M5.Lcd.fillScreen(TFT_BLACK);
            M5.Lcd.setTextColor(TFT_CYAN);
            M5.Lcd.setTextSize(2);
            M5.Lcd.setCursor(10, 30);
            M5.Lcd.println("Checking");
            M5.Lcd.setCursor(10, 50);
            M5.Lcd.println("Server...");
            
            sendHeartbeat();
            delay(500); // Brief pause to show message
            updateDisplay(); // Restore normal display
            
            buttonState.btnB_ClickCount = 0;
            return;
        } else {
            // Start waiting for potential double click
            buttonState.btnB_WaitingForDouble = true;
            buttonState.btnB_LastPress = millis();
            buttonState.btnB_ClickCount = 1;
        }
    }
    
    // Handle button release
    if (M5.BtnB.wasReleased()) {
        buttonState.btnB_IsPressed = false;
        unsigned long pressDuration = millis() - buttonState.btnB_PressStart;
        
        Serial.printf("[BUTTON] Button B released after %lu ms\n", pressDuration);
        
        // Don't process single click if long press was already handled
        if (buttonState.btnB_LongPressHandled) {
            buttonState.btnB_WaitingForDouble = false;
            buttonState.btnB_ClickCount = 0;
            return;
        }
    }
    
    // Handle long press while button is held
    if (buttonState.btnB_IsPressed && !buttonState.btnB_LongPressHandled) {
        unsigned long pressDuration = millis() - buttonState.btnB_PressStart;
        
        if (pressDuration >= LONG_PRESS_TIME) {
            // Long press action: Show network info
            buttonState.btnB_LongPressHandled = true;
            buttonState.btnB_WaitingForDouble = false;
            buttonState.btnB_ClickCount = 0;
            
            Serial.println("[BUTTON] Long press detected");
            showNetworkInfo();
            return;
        }
    }
    
    // Handle single click timeout
    if (buttonState.btnB_WaitingForDouble && 
        (millis() - buttonState.btnB_LastPress >= DOUBLE_CLICK_TIME)) {
        
        buttonState.btnB_WaitingForDouble = false;
        
        if (buttonState.btnB_ClickCount == 1) {
            // Single click action: LED toggle
            Serial.println("[BUTTON] Single click detected");
            toggleLED();
        }
        
        buttonState.btnB_ClickCount = 0;
    }
}

// Toggle LED on/off manually
void toggleLED() {
    // Toggle the LED manual disable state
    deviceState.ledManuallyDisabled = !deviceState.ledManuallyDisabled;
    
    // Show feedback on display
    M5.Lcd.fillScreen(TFT_BLACK);
    M5.Lcd.setTextColor(deviceState.ledManuallyDisabled ? TFT_RED : TFT_GREEN);
    M5.Lcd.setTextSize(2);
    M5.Lcd.setCursor(10, 30);
    M5.Lcd.println("LED");
    M5.Lcd.setCursor(10, 50);
    M5.Lcd.println(deviceState.ledManuallyDisabled ? "OFF" : "AUTO");
    
    Serial.printf("[LED] LED manually %s\n", deviceState.ledManuallyDisabled ? "DISABLED" : "ENABLED");
    
    // If disabling, turn off LED immediately
    if (deviceState.ledManuallyDisabled) {
        digitalWrite(LED_PIN, HIGH); // LED OFF (HIGH = OFF for M5StickC Plus)
        Serial.println("[LED] LED turned OFF manually");
    } else {
        // Immediately update LED based on current state 
        updateLED(); 
        Serial.println("[LED] LED switched to AUTO control");
    }
    
    delay(1000); // Show message for 1 second
    updateDisplay(); // Restore normal display
}

// Show network information
void showNetworkInfo() {
    M5.Lcd.fillScreen(TFT_BLACK);
    M5.Lcd.setTextColor(TFT_WHITE);
    M5.Lcd.setTextSize(1);
    
    // Show IP address
    M5.Lcd.setCursor(5, 10);
    M5.Lcd.println("Network Info:");
    
    M5.Lcd.setCursor(5, 25);
    M5.Lcd.print("IP: ");
    M5.Lcd.println(WiFi.localIP().toString());
    
    // Show WiFi details
    M5.Lcd.setCursor(5, 40);
    M5.Lcd.print("SSID: ");
    String ssid = WiFi.SSID();
    if (ssid.length() > 12) {
        ssid = ssid.substring(0, 12) + "...";
    }
    M5.Lcd.println(ssid);
    
    M5.Lcd.setCursor(5, 55);
    M5.Lcd.print("Signal: ");
    M5.Lcd.print(WiFi.RSSI());
    M5.Lcd.println(" dBm");
    
    // Show MAC address
    M5.Lcd.setCursor(5, 70);
    M5.Lcd.print("MAC: ");
    String mac = WiFi.macAddress();
    M5.Lcd.println(mac.substring(9)); // Show last part of MAC
    
    // Show server connection
    M5.Lcd.setCursor(5, 85);
    M5.Lcd.print("Server: ");
    M5.Lcd.setTextColor(deviceState.serverConnected ? TFT_GREEN : TFT_RED);
    M5.Lcd.println(deviceState.serverConnected ? "Connected" : "Offline");
    
    // Show assigned source
    if (strlen(deviceState.assignedSource) > 0) {
        M5.Lcd.setTextColor(TFT_CYAN);
        M5.Lcd.setCursor(5, 100);
        M5.Lcd.print("Source: ");
        String source = String(deviceState.assignedSource);
        if (source.length() > 10) {
            source = source.substring(0, 10) + "...";
        }
        M5.Lcd.println(source);
    }
    
    Serial.println("[NETWORK] Displaying network information");
    Serial.printf("IP: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("SSID: %s\n", WiFi.SSID().c_str());
    Serial.printf("Signal: %d dBm\n", WiFi.RSSI());
    Serial.printf("MAC: %s\n", WiFi.macAddress().c_str());
    Serial.printf("Server: %s\n", deviceState.serverConnected ? "Connected" : "Offline");
    Serial.printf("Source: %s\n", deviceState.assignedSource);
    
    // Show info for 5 seconds or until button is pressed
    unsigned long showStart = millis();
    while (millis() - showStart < 5000) {
        M5.update();
        if (M5.BtnA.wasPressed() || M5.BtnB.wasPressed()) {
            break;
        }
        delay(50);
    }
    
    updateDisplay(); // Restore normal display
}

// ===== POWER MANAGEMENT FUNCTIONS =====

// Initialize power management system
void initPowerManagement() {
    Serial.println("[POWER] Initializing aggressive power management system");
    
    // Initialize power state
    powerState.lastActivity = millis();
    powerState.lastDisplayUpdate = millis();
    powerState.powerSaveMode = false;
    powerState.displayDimmed = false;
    powerState.deepSleepEnabled = true;
    powerState.originalBrightness = BRIGHTNESS_IDLE;
    powerState.wifiPowerSaveStart = 0;
    powerState.cpuFreqReduced = false;
    powerState.lowBatteryMode = false;
    
    // Configure AXP192 power management aggressively
    // Disable unnecessary power domains to save battery
    M5.Axp.SetLDO3(false);   // Disable camera power (not used)
    M5.Axp.SetDCDC3(false);  // Disable unused DCDC3
    
    // Enable power monitoring
    // Set initial CPU frequency to power save mode by default
    setCpuFrequencyMhz(CPU_FREQ_POWER_SAVE);
    powerState.cpuFreqReduced = true;
    
    // Configure WiFi power saving immediately
    WiFi.setSleep(true);
    WiFi.setTxPower(WIFI_POWER_8_5dBm); // Reduce TX power immediately
    esp_wifi_set_ps(WIFI_PS_MIN_MODEM);
    
    // Update initial battery status
    updateBatteryStatus();
    
    // Start in power save mode if battery is low
    if (powerState.batteryPercent < 50) {
        enterPowerSaveMode();
    }
    
    Serial.printf("[POWER] Aggressive power management initialized - Battery: %d%%, CPU: %dMHz\n", 
                  powerState.batteryPercent, getCpuFrequencyMhz());
}

// Update power management state based on activity and battery level
void updatePowerState() {
    unsigned long currentTime = millis();
    
    // Update battery status periodically
    static unsigned long lastBatteryUpdate = 0;
    if (currentTime - lastBatteryUpdate > 30000) { // Update every 30 seconds to save CPU
        updateBatteryStatus();
        lastBatteryUpdate = currentTime;
    }
    
    // Check for low battery condition
    if (powerState.batteryPercent < 30 && !powerState.lowBatteryMode) { // More aggressive low battery threshold
        handleLowBattery();
    } else if (powerState.batteryPercent > 40 && powerState.lowBatteryMode) {
        // Exit low battery mode when battery recovers
        powerState.lowBatteryMode = false;
        exitPowerSaveMode();
        Serial.println("[POWER] Exiting low battery mode");
    }
    
    // Check for inactivity timeout
    unsigned long inactiveTime = currentTime - powerState.lastActivity;
    
    // Dim display after shorter timeout to save power
    if (!powerState.displayDimmed && inactiveTime > (DISPLAY_TIMEOUT / 2)) { // 30 seconds instead of 60
        dimDisplay();
    }
    
    // Enter power save mode much more aggressively
    if (!powerState.powerSaveMode && inactiveTime > 60000) { // 1 minute instead of 2.5 minutes
        enterPowerSaveMode();
    }
    
    // Enter deep sleep after shorter timeout when inactive
    if (powerState.deepSleepEnabled && inactiveTime > (AUTO_SLEEP_TIMEOUT / 2)) { // 2.5 minutes instead of 5
        // Only enter deep sleep if not actively being used as tally light
        if (!deviceState.serverConnected || (!deviceState.isPreview && !deviceState.isProgram)) {
            enterDeepSleep();
        }
    }
    
    // Optimize WiFi power immediately when inactive
    if (powerState.wifiPowerSaveStart == 0 && inactiveTime > 30000) { // 30 seconds instead of 10
        optimizeWiFiPower();
        powerState.wifiPowerSaveStart = currentTime;
    }
}

// Enter power save mode with reduced CPU frequency and optimized settings
void enterPowerSaveMode() {
    if (powerState.powerSaveMode) return; // Already in power save mode
    
    Serial.println("[POWER] Entering power save mode");
    powerState.powerSaveMode = true;
    
    // Reduce CPU frequency
    adjustCPUFrequency(true);
    
    // Optimize WiFi power
    optimizeWiFiPower();
    
    // Reduce display brightness if not already dimmed
    if (!powerState.displayDimmed) {
        dimDisplay();
    }
    
    // Disable unnecessary features for power saving
    // Note: Advanced LDO/DCDC control not available in this library version
    
    Serial.printf("[POWER] Power save mode active - CPU: %dMHz, Battery: %d%%\n", 
                  getCpuFrequencyMhz(), powerState.batteryPercent);
}

// Exit power save mode and restore normal operation
void exitPowerSaveMode() {
    if (!powerState.powerSaveMode) return; // Not in power save mode
    
    Serial.println("[POWER] Exiting power save mode");
    powerState.powerSaveMode = false;
    
    // Restore normal CPU frequency
    adjustCPUFrequency(false);
    
    // Restore display brightness
    brightenDisplay();
    
    // Restore normal WiFi operation
    WiFi.setSleep(false);
    
    // Reset WiFi power save timer
    powerState.wifiPowerSaveStart = 0;
    
    Serial.printf("[POWER] Normal operation restored - CPU: %dMHz\n", getCpuFrequencyMhz());
}

// Update battery status and percentage
void updateBatteryStatus() {
    float batteryVoltage = M5.Axp.GetBatVoltage();
    float chargeCurrent = M5.Axp.GetBatChargeCurrent();
    // Note: Discharge current not available in this library version
    
    // Calculate battery percentage (3.2V = 0%, 4.2V = 100%)
    powerState.batteryPercent = map(batteryVoltage * 1000, 3200, 4200, 0, 100);
    powerState.batteryPercent = constrain(powerState.batteryPercent, 0, 100);
    
    // Check if charging
    bool isCharging = chargeCurrent > 1.0;
    
    // Log battery status periodically
    static unsigned long lastBatteryLog = 0;
    if (millis() - lastBatteryLog > 30000) { // Log every 30 seconds
        Serial.printf("[POWER] Battery: %d%% (%.2fV), Charge: %.1fmA, Charging: %s\n",
                      powerState.batteryPercent, batteryVoltage, chargeCurrent,
                      isCharging ? "Yes" : "No");
        lastBatteryLog = millis();
    }
}

// Handle low battery condition with aggressive power saving
void handleLowBattery() {
    if (powerState.lowBatteryMode) return; // Already in low battery mode
    
    Serial.printf("[POWER] LOW BATTERY WARNING: %d%% - Entering aggressive power save\n", 
                  powerState.batteryPercent);
    powerState.lowBatteryMode = true;
    
    // Show low battery warning on display
    M5.Lcd.fillScreen(TFT_BLACK);
    M5.Lcd.setTextColor(TFT_RED);
    M5.Lcd.setTextSize(2);
    M5.Lcd.setCursor(10, 20);
    M5.Lcd.println("LOW BATTERY");
    M5.Lcd.setTextSize(3);
    M5.Lcd.setCursor(20, 50);
    M5.Lcd.printf("%d%%", powerState.batteryPercent);
    
    // Aggressive power saving measures
    enterPowerSaveMode();
    
    // Further reduce display brightness
    setBrightness(20); // Very dim
    
    // Reduce WiFi power even more
    WiFi.setTxPower(WIFI_POWER_2dBm); // Minimum WiFi power
    
    // Disable LED to save power
    digitalWrite(LED_PIN, HIGH); // LED OFF
    
    // Show warning for 3 seconds then restore display
    delay(3000);
    updateDisplay();
    
    Serial.println("[POWER] Low battery mode activated");
}

// Enter deep sleep mode for maximum power savings
void enterDeepSleep() {
    Serial.printf("[POWER] Entering deep sleep for %d seconds (Battery: %d%%)\n", 
                  DEEP_SLEEP_DURATION, powerState.batteryPercent);
    
    // Show sleep message on display
    M5.Lcd.fillScreen(TFT_BLACK);
    M5.Lcd.setTextColor(TFT_BLUE);
    M5.Lcd.setTextSize(2);
    M5.Lcd.setCursor(10, 30);
    M5.Lcd.println("SLEEPING");
    M5.Lcd.setTextSize(1);
    M5.Lcd.setCursor(10, 60);
    M5.Lcd.printf("Wake in %ds", DEEP_SLEEP_DURATION);
    
    delay(1000); // Show message briefly
    
    // Configure wake-up sources
    esp_sleep_enable_timer_wakeup(DEEP_SLEEP_DURATION * 1000000ULL); // Convert to microseconds
    esp_sleep_enable_ext0_wakeup(GPIO_NUM_37, 0); // Wake on button A (M5StickC Plus button A)
    esp_sleep_enable_ext1_wakeup((1ULL << GPIO_NUM_39), ESP_EXT1_WAKEUP_ANY_HIGH); // Wake on button B
    
    // Minimize power consumption before sleep
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    
    // Turn off display
    M5.Axp.SetLDO2(false); // Disable LCD backlight
    // Note: LCD sleep method not available in this library version
    
    // Turn off LED
    digitalWrite(LED_PIN, HIGH);
    
    // Configure AXP192 for deep sleep
    // Note: AXP192 SetSleep method not available in this library version
    // The ESP32 deep sleep will handle power management
    
    // Enter deep sleep
    esp_deep_sleep_start();
    
    // This line will never be reached, but included for completeness
    Serial.println("[POWER] Deep sleep started");
}

// Dim the display to save power
void dimDisplay() {
    if (powerState.displayDimmed) return; // Already dimmed
    
    Serial.println("[POWER] Dimming display for power saving");
    powerState.displayDimmed = true;
    
    // Store original brightness if not already stored
    if (powerState.originalBrightness == BRIGHTNESS_IDLE) {
        powerState.originalBrightness = deviceState.isProgram ? BRIGHTNESS_LIVE :
                                       deviceState.isPreview ? BRIGHTNESS_PREVIEW :
                                       BRIGHTNESS_IDLE;
    }
    
    // Set to very low brightness (25% of original)
    uint8_t dimBrightness = powerState.originalBrightness / 4;
    if (dimBrightness < 10) dimBrightness = 10; // Minimum readable brightness
    
    setBrightness(dimBrightness);
    powerState.lastDisplayUpdate = millis();
    
    Serial.printf("[POWER] Display dimmed to %d (was %d)\n", dimBrightness, powerState.originalBrightness);
}

// Restore display brightness
void brightenDisplay() {
    if (!powerState.displayDimmed) return; // Not dimmed
    
    Serial.println("[POWER] Restoring display brightness");
    powerState.displayDimmed = false;
    
    // Restore appropriate brightness based on current state
    uint8_t targetBrightness = deviceState.isProgram ? BRIGHTNESS_LIVE :
                              deviceState.isPreview ? BRIGHTNESS_PREVIEW :
                              BRIGHTNESS_IDLE;
    
    setBrightness(targetBrightness);
    powerState.lastDisplayUpdate = millis();
    
    Serial.printf("[POWER] Display brightness restored to %d\n", targetBrightness);
}

// Update activity timestamp and exit power save modes if active
void updateActivity() {
    unsigned long currentTime = millis();
    
    // Only update if significant time has passed to avoid excessive updates
    if (currentTime - powerState.lastActivity < 1000) return;
    
    powerState.lastActivity = currentTime;
    
    // Exit power save mode if active
    if (powerState.powerSaveMode && !powerState.lowBatteryMode) {
        exitPowerSaveMode();
    }
    
    // Restore display brightness if dimmed
    if (powerState.displayDimmed && !powerState.lowBatteryMode) {
        brightenDisplay();
    }
    
    Serial.println("[POWER] Activity detected - power save modes reset");
}

// Optimize WiFi power consumption
void optimizeWiFiPower() {
    if (WiFi.status() != WL_CONNECTED) return;
    
    Serial.println("[POWER] Optimizing WiFi power consumption");
    
    // Enable WiFi sleep mode for power saving
    WiFi.setSleep(true);
    
    // Reduce WiFi transmission power
    if (powerState.lowBatteryMode) {
        WiFi.setTxPower(WIFI_POWER_2dBm); // Minimum power for low battery
    } else if (powerState.powerSaveMode) {
        WiFi.setTxPower(WIFI_POWER_5dBm); // Reduced power for power save mode
    } else {
        WiFi.setTxPower(WIFI_POWER_8_5dBm); // Normal reduced power
    }
    
    // Configure power save parameters
    esp_wifi_set_ps(WIFI_PS_MIN_MODEM); // Enable minimum modem sleep
    
    Serial.printf("[POWER] WiFi power optimized - Sleep: enabled, TX Power: reduced\n");
}

// Adjust CPU frequency for power management
void adjustCPUFrequency(bool powerSave) {
    uint32_t targetFreq = powerSave ? CPU_FREQ_POWER_SAVE : CPU_FREQ_NORMAL;
    uint32_t currentFreq = getCpuFrequencyMhz();
    
    if (currentFreq == targetFreq) return; // Already at target frequency
    
    Serial.printf("[POWER] Adjusting CPU frequency: %dMHz -> %dMHz\n", currentFreq, targetFreq);
    
    bool success = setCpuFrequencyMhz(targetFreq);
    
    if (success) {
        powerState.cpuFreqReduced = powerSave;
        Serial.printf("[POWER] CPU frequency changed to %dMHz (requested %dMHz)\n", 
                      getCpuFrequencyMhz(), targetFreq);
    } else {
        Serial.printf("[POWER] Failed to change CPU frequency to %dMHz\n", targetFreq);
    }
}
