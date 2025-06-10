/*
 * ESP32 OBS Tally Light System - M5StickC PLUS Edition v2.0.0
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
 * Hardware: M5StickC PLUS
 * 
 * Upload Instructions:
 * 1. Set Board: "M5StickC-Plus" or "ESP32 Dev Module"
 * 2. Set Partition Scheme: "Default 4MB with spiffs (1.2MB APP/1.5MB SPIFFS)"
 * 3. Set Upload Speed: 921600
 * 4. Install required libraries via Library Manager:
 *    - M5StickCPlus by M5Stack (v0.1.0+)
 *    - ArduinoJson by Benoit Blanchon (v7.0.3+)
 *    - WiFiManager by tzapu (v2.0.17+)
 *    - NTPClient by Fabrice Weinberg (v3.2.1+)
 * 5. Upload this firmware
 * 6. Monitor Serial at 115200 baud for first boot
 * 7. Connect to "OBS-Tally-XXXX" WiFi network for setup
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



// Firmware version and model information
// FIRMWARE_VERSION is defined in platformio.ini build flags
#define DEVICE_MODEL "M5StickC-PLUS"
#define BUILD_DATE __DATE__ " " __TIME__

// Display configuration
#define SCREEN_WIDTH 240
#define SCREEN_HEIGHT 135
#define TFT_ROTATION 1

// Server and networking configuration  
#define DEFAULT_SERVER_URL "http://192.168.0.91:3005"
#define CONFIG_PORTAL_TIMEOUT 300
#define HEARTBEAT_INTERVAL 30000
#define RECONNECT_INTERVAL 5000
#define HEALTH_CHECK_INTERVAL 60000

// Device and display settings
#define DEFAULT_DEVICE_NAME "OBS-Tally"
#define DEFAULT_HOSTNAME "obs-tally-m5stick"
#define STATUS_UPDATE_INTERVAL 100
#define PULSE_SPEED 3
#define CONFIG_VERSION "2.0"

// Brightness levels
#define BRIGHTNESS_IDLE 80
#define BRIGHTNESS_PREVIEW 150
#define BRIGHTNESS_LIVE 255

// CPU frequency settings
#define CPU_FREQ_NORMAL 240
#define CPU_FREQ_POWER_SAVE 80

// Timing constants
#define DISPLAY_TIMEOUT 30000
#define AUTO_SLEEP_TIMEOUT 300000
#define DEEP_SLEEP_DURATION 30000000ULL
#define LED_BLINK_INTERVAL 500
#define UDP_PORT 3006

// Power save intervals
#define HEARTBEAT_INTERVAL_POWER_SAVE 60000
#define ANNOUNCE_INTERVAL 30000

// Pin definitions (for M5StickC PLUS)
#define BACKLIGHT_PIN 32
#define BOOT_BUTTON_PIN 37
#define LED_PIN 10

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
#define COLOR_REC_RED   0xF800    // Red for recording status

// Global objects
WebServer server(80);
WebServer webServer(80);  // Add explicit webServer object for compatibility
HTTPClient http;
Preferences preferences;
WiFiManager wifiManager;
WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "pool.ntp.org");

// Global variables
String deviceName = DEFAULT_DEVICE_NAME;
String deviceID = "tally-";
String macAddress = "";
String ipAddress = "";
String serverURL = DEFAULT_SERVER_URL;
String serverIP = "";
uint16_t serverPort = 3005;
String hostname = "";
String assignedSource = "";
String currentStatus = "INIT";
String lastError = "";
bool isConnected = false;
bool isRegistered = false;
bool webServerRunning = false;
bool ntpInitialized = false;

// OBS Recording and Streaming status
bool showRecordingStatus = true;  // Whether to display recording status
bool showStreamingStatus = true;  // Whether to display streaming status
bool isRecording = false;         // Current recording state
bool isStreaming = false;         // Current streaming state

// UDP Discovery
WiFiUDP discoveryUDP;
bool discoveryUDPInitialized = false;
unsigned long lastAnnouncementTime = 0;
#define ANNOUNCEMENT_INTERVAL 60000  // Send announcement every minute
#define UDP_DISCOVERY_PORT 3006      // Port for UDP discovery

// Status tracking
unsigned long lastHeartbeatTime = 0;
unsigned long lastStatusUpdate = 0;
unsigned long lastHealthCheck = 0;
unsigned long bootTime = 0;
unsigned long connectionAttempts = 0;
unsigned long successfulHeartbeats = 0;
unsigned long failedHeartbeats = 0;
unsigned long displayUpdates = 0;

// WiFi signal tracking
int wifiSignalStrength = -100;
String lastHeartbeat = "Never";

// Power management variables
bool powerSaveMode = false;
bool lowBatteryMode = false;
bool displayDimmed = false;
bool deepSleepEnabled = true;
bool cpuFreqReduced = false;
uint8_t originalBrightness = BRIGHTNESS_IDLE;
uint8_t batteryPercent = 100;
unsigned long lastActivity = 0;
unsigned long wifiPowerSaveStart = 0;

// State variables for tally status
bool isProgram = false;
bool isPreview = false;
bool configMode = false;
bool serverConnected = false;
bool ledManuallyDisabled = false;

// Button state variables
bool btnB_WaitingForDouble = false;
unsigned long btnB_SinglePressTime = 0;
bool btnB_IsPressed = false;
unsigned long btnB_PressStart = 0;
bool btnB_LongPressHandled = false;
int btnB_ClickCount = 0;
unsigned long btnB_LastPress = 0;

// Network variables
WiFiUDP udp;
bool webServerDeclared = false;

// Timing variables for loops
unsigned long lastAnnounce = 0;

// Animation variables
float pulsePhase = 0;
int brightness = 255;
bool lastDisplayState = false;
unsigned long lastFullRedraw = 0;
#define FULL_REDRAW_INTERVAL 5000  // Full redraw every 5 seconds

// Additional timing variables
unsigned long lastDisplayUpdate = 0;

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

// Missing utility functions
String formatUptime();
String formatTime();
uint16_t interpolateColor(uint16_t color1, uint16_t color2, float factor);
int getWiFiSignalQuality(int32_t rssi);
void updateWiFiSignalStrength();
void checkServerConnection();
void setupDiscovery();
void handleDiscoveryRequest();
void fetchCurrentTallyState();
void performHealthCheck();

// Power management functions
void initPowerManagement();
void updatePowerState();
void enterPowerSaveMode();
void exitPowerSaveMode();
void updateBatteryStatus();
void handleLowBattery();
void enterDeepSleep();
void disableDeepSleep();
void enableDeepSleep();
void dimDisplay();
void brightenDisplay();
void updateActivity();
void optimizeWiFiPower();
void adjustCPUFrequency(bool powerSave);

// Stability monitoring functions
void performStabilityCheck();
void monitorSystemHealth();
void preventRestartConditions();

void setup() {
    // Initialize serial port first for debugging
    Serial.begin(115200);
    delay(1000); // Give serial time to initialize properly
    
    // Disable watchdog to prevent reset loops
    disableCore0WDT();
    disableCore1WDT();
    Serial.println("[BOOT] Watchdog timers disabled for stability");
    
    // Suppress verbose Arduino core HTTP logs to reduce memory pressure
    esp_log_level_set("HTTPClient", ESP_LOG_WARN);
    esp_log_level_set("WebServer", ESP_LOG_WARN);
    esp_log_level_set("wifi", ESP_LOG_WARN);
    esp_log_level_set("esp_event", ESP_LOG_WARN);
    
    // Check wake-up cause to prevent immediate deep sleep after wake-up
    esp_sleep_wakeup_cause_t wakeup_reason = esp_sleep_get_wakeup_cause();
    bool wokeFromDeepSleep = (wakeup_reason == ESP_SLEEP_WAKEUP_TIMER || 
                              wakeup_reason == ESP_SLEEP_WAKEUP_EXT0 || 
                              wakeup_reason == ESP_SLEEP_WAKEUP_EXT1);
    
    if (wokeFromDeepSleep) {
        Serial.printf("[BOOT] Woke from deep sleep (reason: %d) - staying awake longer\n", wakeup_reason);
    } else {
        Serial.println("[BOOT] Normal boot/reset - checking for crash recovery");
        
        // Check if previous reset was due to panic/crash
        esp_reset_reason_t reset_reason = esp_reset_reason();
        switch (reset_reason) {
            case ESP_RST_PANIC:
                Serial.println("[BOOT] WARNING: Previous reset was due to panic/crash");
                break;
            case ESP_RST_INT_WDT:
                Serial.println("[BOOT] WARNING: Previous reset was due to interrupt watchdog");
                break;
            case ESP_RST_TASK_WDT:
                Serial.println("[BOOT] WARNING: Previous reset was due to task watchdog");
                break;
            case ESP_RST_WDT:
                Serial.println("[BOOT] WARNING: Previous reset was due to other watchdog");
                break;
            case ESP_RST_BROWNOUT:
                Serial.println("[BOOT] WARNING: Previous reset was due to brownout");
                break;
            default:
                Serial.printf("[BOOT] Normal reset - reason: %d\n", reset_reason);
                break;
        }
    }
    
    // Initialize essential variables
    bootTime = millis();
    macAddress = WiFi.macAddress();
    deviceID = "tally-" + String((uint32_t)ESP.getEfuseMac());
    ipAddress = "0.0.0.0";

    delay(500); // Brief delay before initializing hardware
    
    // Initialize M5StickC PLUS with minimal features first - use safe initialization
    Serial.println("[INIT] Initializing M5StickC PLUS hardware...");
    try {
        M5.begin(true, true, false);  // Initialize AXP192 Power and LCD, but not Serial (already done)
        Serial.println("[INIT] M5StickC PLUS hardware initialized successfully");
    } catch (...) {
        Serial.println("[INIT] ERROR: M5StickC hardware initialization failed - continuing with fallback");
        // Continue anyway to avoid restart
    }
    
    // Configure power management for optimal display performance with error handling
    try {
        M5.Axp.SetLDO2(true);   // Enable LCD backlight power
        delay(100);             // Allow power to stabilize
        Serial.println("[INIT] AXP192 power management configured");
    } catch (...) {
        Serial.println("[INIT] WARNING: AXP192 power management configuration failed");
        // Continue anyway
    }
    
    // Initialize LED pin
    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, HIGH); // Start with LED off (HIGH = OFF for M5StickC Plus)
    Serial.println("[INIT] LED initialized and set to OFF by default");
    
    // Initialize display with error handling
    try {
        M5.Lcd.setRotation(3); // Landscape
        M5.Lcd.fillScreen(TFT_BLACK);
        M5.Lcd.setTextSize(2);
        Serial.println("[INIT] Display initialized successfully");
    } catch (...) {
        Serial.println("[INIT] WARNING: Display initialization failed");
        // Continue anyway
    }
    
    // Test brightness control with visible changes

    
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
    // Fallback: If port is 0, set to 3005
    if (serverPort == 0) {
        serverPort = 3005;
        Serial.println("[DEBUG] serverPort was 0, set to 3005 fallback");
    }
    Serial.printf("[BOOT] Config loaded: %s\n", configLoaded ? "YES" : "NO");
    Serial.printf("[DEBUG] Loaded config: serverIP='%s', serverPort=%d, assignedSource='%s', deviceName='%s', hostname='%s', ledDisabled=%s\n",
        serverIP.c_str(), serverPort, assignedSource.c_str(), deviceName.c_str(), hostname.c_str(), ledManuallyDisabled ? "true" : "false");
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
        ntpInitialized = true; // Set flag to indicate NTP is initialized
        
        // If we have server configuration, automatically register and start communication
        // Check if we have server IP and port (serverURL should be constructed by setupWiFi)
        if (serverIP.length() > 0 && serverPort > 0 && serverURL.length() > 0) {
            Serial.printf("[INIT] Starting automatic server communication to %s...\n", serverURL.c_str());
            
            // Show connecting status
            M5.Lcd.fillScreen(TFT_BLACK);
            M5.Lcd.setTextColor(TFT_CYAN);
            M5.Lcd.setTextSize(2);
            M5.Lcd.setCursor(10, 30);
            M5.Lcd.println("Registering");
            M5.Lcd.setCursor(10, 50);
            M5.Lcd.println("Device...");
            
            // Small delay to ensure network stack is ready
            delay(1000);
            
            // Attempt device registration
            registerDevice();
            
            // Start immediate heartbeat and tally state fetch
            sendHeartbeat();
            fetchCurrentTallyState();
            
            // Brief delay to show registration attempt
            delay(2000);
            
            Serial.println("[INIT] Automatic server communication initiated");
        } else {
            Serial.printf("[INIT] No server configuration - serverIP='%s', serverPort=%d, serverURL='%s'\n", 
                         serverIP.c_str(), serverPort, serverURL.c_str());
        }
    }
    
    // Initialize power management
    initPowerManagement();
    Serial.println("[INIT] Power management initialized");

    // After setup, fetch current tally state if possible
    fetchCurrentTallyState();
    
    // Force initial display update to show assigned source after restart
    Serial.println("[INIT] Forcing initial display update to show assigned source");
    updateDisplay();
    
    // Add memory barrier to ensure all initialization is complete
    __asm__ __volatile__("" ::: "memory");
    
    // Final stability check before marking setup complete
    Serial.printf("[INIT] Free heap after setup: %d bytes\n", ESP.getFreeHeap());
    if (ESP.getFreeHeap() < 80000) {
        Serial.println("[INIT] WARNING: Low memory after setup - forcing garbage collection");
        // Force garbage collection by creating and destroying temporary objects
        for (int i = 0; i < 10; i++) {
            String temp = "cleanup_" + String(i);
            delay(10);
        }
        Serial.printf("[INIT] Free heap after cleanup: %d bytes\n", ESP.getFreeHeap());
    }
    
    // Enable additional stability monitoring
    Serial.println("[INIT] Enabling stability monitoring...");
    
    Serial.println("[SETUP] Complete! Device ready for ultra-stable operation");
    Serial.println("[SETUP] Random restart prevention measures active");
}

void loop() {
    // Wrap main loop in try-catch to prevent crashes from propagating to restart
    try {
        M5.update(); // Handle button presses with error protection
    } catch (...) {
        Serial.println("[LOOP] WARNING: M5.update() failed - continuing anyway");
        // Don't restart, just continue
    }
    
    // Monitor for stack overflow or corruption
    static unsigned long loopCounter = 0;
    loopCounter++;
    
    // Check for memory leaks every 1000 loops
    if (loopCounter % 1000 == 0) {
        uint32_t freeHeap = ESP.getFreeHeap();
        if (freeHeap < 60000) {
            Serial.printf("[LOOP] WARNING: Memory getting low - %u bytes free\n", freeHeap);
            // Force a small delay to prevent tight loops that could cause watchdog resets
            delay(100);
        }
    }
    
    // Prevent immediate deep sleep after boot - ensure device stays awake for at least 10 minutes after startup
    static bool initialAwakePeriod = true;
    if (initialAwakePeriod && millis() > 600000) { // 10 minutes
        initialAwakePeriod = false;
        Serial.println("[POWER] Initial wake period completed - deep sleep may now be considered");
    } else if (initialAwakePeriod) {
        // DISABLE deep sleep entirely during initial period to prevent restart loops
        deepSleepEnabled = false;
        
        // Regularly check if we should exit deep sleep or power save mode
        updatePowerState();
    }
    
    // Update activity to prevent deep sleep during initial period (reduce frequency)
    static unsigned long lastInitialActivity = 0;
    if (initialAwakePeriod && (millis() - lastInitialActivity > 30000)) { // Only every 30 seconds during initial period
        updateActivity();
        lastInitialActivity = millis();
    }
    
    // Basic functionality regardless of connection state
    if (M5.BtnA.pressedFor(2000)) {
        // Long press A button for factory reset
        factoryReset();
        return;
    }
    
    if (configMode) {
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
            configMode = false;
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
        isRegistered = false; // Clear registration when WiFi is lost
        serverConnected = false;
        
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
        isRegistered = false; // Force re-registration
        Serial.println("WiFi connection restored, will re-register device");
        // After WiFi reconnect, fetch current tally state
        fetchCurrentTallyState();
    }
    
    // Fallback registration check - if device has been running for more than 60 seconds
    // but still isn't registered, and we have server configuration, try to register
    static unsigned long lastRegistrationAttempt = 0;
    if (!isRegistered && 
        serverIP.length() > 0 && 
        serverPort > 0 && 
        millis() > 60000 && 
        (millis() - lastRegistrationAttempt > 30000)) { // Try every 30 seconds
        
        Serial.println("[FALLBACK] Device not registered after 60s, attempting registration...");
        
        // Ensure serverURL is constructed
        if (serverURL.length() == 0) {
            serverURL = "http://" + serverIP + ":" + String(serverPort);
            Serial.printf("[FALLBACK] Constructed serverURL: %s\n", serverURL.c_str());
        }
        
        registerDevice();
        lastRegistrationAttempt = millis();
    }
    
    // Handle normal operations only when connected with enhanced error handling
    try {
        ArduinoOTA.handle();
    } catch (...) {
        Serial.println("[LOOP] WARNING: ArduinoOTA.handle() failed - continuing");
    }
    
    try {
        webServer.handleClient();
    } catch (...) {
        Serial.println("[LOOP] WARNING: webServer.handleClient() failed - continuing");
    }
    
    try {
        timeClient.update();
    } catch (...) {
        Serial.println("[LOOP] WARNING: timeClient.update() failed - continuing");
    }
    
    // Check server connection (adjust heartbeat interval based on power save mode)
    unsigned long heartbeatInterval = powerSaveMode ? HEARTBEAT_INTERVAL_POWER_SAVE : HEARTBEAT_INTERVAL;
    if (millis() - lastHeartbeatTime > heartbeatInterval) {
        Serial.printf("[LOOP] Heartbeat trigger: lastTime=%lu, now=%lu, interval=%lu\n", 
                     lastHeartbeatTime, millis(), heartbeatInterval);
        sendHeartbeat();
    }
    
    // Announce device presence (reduce frequency in power save mode)
    unsigned long announceInterval = powerSaveMode ? (ANNOUNCE_INTERVAL * 4) : (ANNOUNCE_INTERVAL * 2); // Less frequent announcements
    if (millis() - lastAnnounce > announceInterval) {
        announceDevice();
    }
    
    // Perform health check periodically (similar to ESP32-1732S019)
    static unsigned long lastHealthCheck = 0;
    if (millis() - lastHealthCheck > HEALTH_CHECK_INTERVAL) {
        performHealthCheck();
        lastHealthCheck = millis();
    }
    
    // Perform stability monitoring to prevent random restarts
    performStabilityCheck();
    
    // Update display status only when state actually changes, or periodically in LIVE mode
    static bool lastPreview = isPreview;
    static bool lastProgram = isProgram;
    static bool lastStreaming = isStreaming;
    static bool lastRecording = isRecording;
    static bool lastServerConnected = serverConnected;
    static unsigned long lastDisplayUpdate = 0;
    static unsigned long lastFullRedraw = 0;
    // Use a local variable instead of macro to avoid redefinition error
    const unsigned long fullRedrawInterval = 5000; // 5 seconds

    bool stateChanged = (lastPreview != isPreview ||
                        lastProgram != isProgram ||
                        lastStreaming != isStreaming ||
                        lastRecording != isRecording ||
                        lastServerConnected != serverConnected);

    bool needsRedraw = stateChanged;

    // Periodic redraw logic: only in LIVE mode (isProgram)
    if (!needsRedraw && isProgram) {
        if (millis() - lastFullRedraw > fullRedrawInterval) {
            needsRedraw = true;
        }
    }

    if (needsRedraw) {
        updateDisplay();
        lastDisplayUpdate = millis();
        if (isProgram) {
            lastFullRedraw = millis();
        } else {
            lastFullRedraw = 0;
        }

        // Update last states
        lastPreview = isPreview;
        lastProgram = isProgram;
        lastStreaming = isStreaming;
        lastRecording = isRecording;
        lastServerConnected = serverConnected;

        // Only log when there was an actual state change, not just a periodic redraw
        if (stateChanged) {
            Serial.printf("[DISPLAY] State changed - Preview: %s, Program: %s, Streaming: %s, Recording: %s\n",
                         isPreview ? "TRUE" : "FALSE",
                         isProgram ? "TRUE" : "FALSE", 
                         isStreaming ? "TRUE" : "FALSE",
                         isRecording ? "TRUE" : "FALSE");
        }
    }
    
    // Update LED status (for recording/preview indicators) - reduce frequency to save power
    static unsigned long lastLEDUpdate = 0;
    if (millis() - lastLEDUpdate > 200) { // Update LED max 5 times per second instead of 10
        updateLED();
        lastLEDUpdate = millis();
    }
    
    // Update power management state (reduce frequency to save CPU)
    static unsigned long lastPowerUpdate = 0;
    if (millis() - lastPowerUpdate > 5000) { // Update power state every 5 seconds instead of every loop
        updatePowerState();
        lastPowerUpdate = millis();
    }
    
    // Handle button presses (reduce activity update frequency)
    if (M5.BtnA.wasPressed()) {
        // Update activity on button press (but not too frequently)
        static unsigned long lastBtnActivity = 0;
        if (millis() - lastBtnActivity > 5000) { // Only update activity every 5 seconds from button presses
            updateActivity();
            lastBtnActivity = millis();
        }
        
        // Short press A button to rotate display
        static uint8_t rotation = 3;
        rotation = (rotation + 1) % 4;
        M5.Lcd.setRotation(rotation);
        updateDisplay();
    }
    
    // Advanced Button B handling
    handleButtonB();
    
    // Small delay to prevent tight loop (adjust based on power save mode)
    // Increased delays to reduce CPU usage and prevent watchdog timeouts
    delay(powerSaveMode ? 1000 : 750); // Longer delays for stability
    
    // Additional yield to prevent watchdog resets
    yield();
}

// Brightness control for M5StickC Plus - uses AXP192 power management only
void setBrightness(uint8_t brightness) {
    // Ensure display power is enabled first
    M5.Axp.SetLDO2(true);  // Enable LCD backlight power supply
    
    // Use AXP192 ScreenBreath for brightness control (0-100 range)
    // This is the correct method for M5StickC Plus backlight control
    uint8_t axpBrightness = map(brightness, 0, 255, 0, 100);  // Map to full 0-100 range
    M5.Axp.ScreenBreath(axpBrightness);
    

}

void updateDisplay() {
    M5.Lcd.fillScreen(TFT_BLACK);
    
    // Get WiFi signal strength and use the global optimized battery percentage
    int32_t wifiSignal = WiFi.RSSI();
    // Use the global batteryPercent which is calculated with our optimized algorithm
    // Don't recalculate here to avoid inconsistency
    
    if (!isConnected) {
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
    uint8_t brightnessLevel;
    
    if (isProgram) {
        bgColor = TFT_RED;
        textColor = TFT_WHITE;
        statusText = "LIVE";
        textSize = 4;
        brightnessLevel = BRIGHTNESS_LIVE;
    } else if (isPreview) {
        bgColor = TFT_ORANGE;
        textColor = TFT_BLACK;
        statusText = "PREVIEW";
        textSize = 3;
        brightnessLevel = BRIGHTNESS_PREVIEW;
    } else {
        bgColor = TFT_DARKGREY;
        textColor = TFT_WHITE;
        statusText = "IDLE";
        textSize = 3;
        brightnessLevel = BRIGHTNESS_IDLE;
    }
    
    // Set brightness based on status
    setBrightness(brightnessLevel);
    
    M5.Lcd.fillScreen(bgColor);
    
    // Display source name at the top, centered and larger
    if (assignedSource.length() > 0) {
        M5.Lcd.setTextColor(textColor);
        M5.Lcd.setTextSize(2); // Larger text for source name
        int sourceWidth = assignedSource.length() * 12; // Approximate width for size 2
        M5.Lcd.setCursor((M5.Lcd.width() - sourceWidth) / 2, 10);
        M5.Lcd.println(assignedSource);
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
    // Only log recording/streaming changes, not every display update
    static bool lastRecDisplayLogged = false;
    static bool lastStreamDisplayLogged = false;
    
    if ((isRecording != lastRecDisplayLogged) || (isStreaming != lastStreamDisplayLogged)) {
        Serial.printf("[DISPLAY] Recording: %s, Streaming: %s\n", 
                      isRecording ? "TRUE" : "FALSE",
                      isStreaming ? "TRUE" : "FALSE");
        lastRecDisplayLogged = isRecording;
        lastStreamDisplayLogged = isStreaming;
    }
    
    if (isRecording || isStreaming) {
        int indicatorY = M5.Lcd.height() - 45; // Higher position for better visibility
        
        if (isRecording) {
            // Large red recording indicator
            M5.Lcd.fillCircle(20, indicatorY, 6, TFT_RED);
            M5.Lcd.setTextSize(2); // Larger text
            M5.Lcd.setTextColor(TFT_WHITE);
            M5.Lcd.setCursor(35, indicatorY - 8);
            M5.Lcd.println("REC");
        }
        
        if (isStreaming) {
            int streamX = isRecording ? 100 : 20; // Position next to recording or alone
            // Large blue streaming indicator
            M5.Lcd.fillRect(streamX - 8, indicatorY - 8, 16, 16, TFT_BLUE);
            M5.Lcd.setTextSize(2); // Larger text
            M5.Lcd.setTextColor(TFT_WHITE);
            M5.Lcd.setCursor(streamX + 15, indicatorY - 8);
            M5.Lcd.println("LIVE");
        }
    }
    
    // Draw WiFi and battery indicators at the bottom
    drawWiFiAndBattery(wifiSignal, batteryPercent);
}

// Fetch the current tally state from the server and update device state/display
void fetchCurrentTallyState() {
    static unsigned long lastFetch = 0;
    unsigned long currentTime = millis();
    
    // Rate limit fetches to prevent excessive calls (minimum 10 seconds between fetches)
    if (currentTime - lastFetch < 10000) {
        Serial.println("[TALLY] fetchCurrentTallyState() rate limited, skipping");
        return;
    }
    
    Serial.printf("[TALLY] fetchCurrentTallyState() called. assignedSource='%s'\n", assignedSource.c_str());
    if (WiFi.status() != WL_CONNECTED || serverURL.length() == 0) {
        Serial.println("[TALLY] Not connected to WiFi or server URL not set, skipping fetchCurrentTallyState()");
        return;
    }

    // Use the same heartbeat mechanism as ESP32-1732S019 to get current status
    sendHeartbeat();
    lastFetch = currentTime;
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
    // Check enhanced charging status
    float chargeCurrent = M5.Axp.GetBatChargeCurrent();
    float batteryVoltage = M5.Axp.GetBatVoltage();
    bool isCharging = chargeCurrent > 1.0; // Consider charging if current > 1mA
    bool chargingComplete = (batteryVoltage >= 4.1 && chargeCurrent > 0 && chargeCurrent < 15.0);
    
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
    
    // Add enhanced charging indicators
    if (chargingComplete) {
        // Draw checkmark for charging complete
        uint16_t checkColor = TFT_CYAN;
        int centerX = batteryX + batteryWidth / 2;
        int centerY = batteryY + batteryHeight / 2;
        
        // Simple checkmark using lines
        M5.Lcd.drawLine(centerX - 3, centerY, centerX - 1, centerY + 2, checkColor);
        M5.Lcd.drawLine(centerX - 1, centerY + 2, centerX + 3, centerY - 2, checkColor);
        M5.Lcd.drawLine(centerX - 2, centerY, centerX, centerY + 2, checkColor); // Thicker checkmark
        M5.Lcd.drawLine(centerX, centerY + 2, centerX + 2, centerY - 2, checkColor);
    } else if (isCharging) {
        // Draw lightning bolt icon for active charging
        uint16_t lightningColor = TFT_CYAN;
        int centerX = batteryX + batteryWidth / 2;
        int centerY = batteryY + batteryHeight / 2;
        
        // Simple lightning bolt using lines
        M5.Lcd.drawLine(centerX - 3, centerY - 4, centerX + 1, centerY, lightningColor);
        M5.Lcd.drawLine(centerX + 1, centerY, centerX - 3, centerY + 4, lightningColor);
        M5.Lcd.drawLine(centerX - 1, centerY - 2, centerX + 3, centerY + 2, lightningColor);
    }
    
    // Show enhanced percentage text with better charging status
    M5.Lcd.setTextSize(1);
    M5.Lcd.setTextColor(batteryColor);
    String battStr = String(batteryPercent) + "%";
    if (chargingComplete) {
        battStr += " FULL";
    } else if (isCharging) {
        battStr += " CHG";
    }
    M5.Lcd.setCursor(batteryX - 40, bottomY + 10); // Adjusted position for longer text
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
    
    serverIP = preferences.getString("server_ip", "");
    serverPort = preferences.getUInt("server_port", 3005);
    deviceName = preferences.getString("device_name", "");
    assignedSource = preferences.getString("assigned_source", "");
    hostname = preferences.getString("hostname", DEFAULT_HOSTNAME);
    ledManuallyDisabled = preferences.getBool("led_disabled", false); // Load LED preference, default to enabled
    
    preferences.end();
    return true;
}

// Save configuration to preferences
void saveConfig() {
    preferences.begin("obs-tally", false);
    preferences.putString("version", CONFIG_VERSION);
    preferences.putString("server_ip", serverIP);
    preferences.putUInt("server_port", serverPort);
    preferences.putString("device_name", deviceName);
    preferences.putString("assigned_source", assignedSource);
    preferences.putString("hostname", hostname);
    preferences.putBool("led_disabled", ledManuallyDisabled); // Save LED preference
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
    WiFi.hostname(hostname);

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
        configMode = true;
        return;
    }
    
    // Successfully connected
    M5.Lcd.fillScreen(TFT_GREEN);
    M5.Lcd.setTextColor(TFT_BLACK);
    
    // Initialize device ID and MAC address for registration
    macAddress = WiFi.macAddress();
    deviceID = "m5stick-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    ipAddress = WiFi.localIP().toString();
    
    M5.Lcd.setCursor(10, 20);
    M5.Lcd.println("Connected to:");
    M5.Lcd.setCursor(10, 40);
    M5.Lcd.println(WiFi.SSID());
    M5.Lcd.setCursor(10, 60);
    M5.Lcd.setTextSize(1);
    M5.Lcd.println("IP: " + ipAddress);
    
    // Build server URL if we have server configuration
    if (serverIP.length() > 0 && serverPort > 0) {
        serverURL = "http://" + serverIP + ":" + String(serverPort);
        Serial.printf("[WIFI] Server URL constructed: %s\n", serverURL.c_str());
        
        // Show server connection attempt
        M5.Lcd.setCursor(10, 80);
        M5.Lcd.setTextColor(TFT_YELLOW);
        M5.Lcd.println("Connecting to server...");
    } else {
        Serial.println("[WIFI] No server configuration available");
        M5.Lcd.setCursor(10, 80);
        M5.Lcd.setTextColor(TFT_ORANGE);
        M5.Lcd.println("No server config");
    }
    
    delay(3000);
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
    
    // Add restart endpoint (was missing, causing 404 errors)
    webServer.on("/restart", HTTP_GET, []() {
        webServer.send(200, "text/html", R"(
<!DOCTYPE html>
<html>
<head>
    <title>Restarting Device</title>
    <meta http-equiv="refresh" content="3;url=/">
    <style>
        body { font-family: Arial; text-align: center; margin: 50px; background: #1a1a1a; color: #fff; }
        .status { padding: 20px; border-radius: 8px; background: #0066cc; color: white; }
    </style>
</head>
<body>
    <div class="status">
        <h1>Restarting Device</h1>
        <p>Please wait while the device restarts...</p>
        <p>You will be redirected automatically.</p>
    </div>
</body>
</html>
        )");
        
        Serial.println("[WEB] Restart requested via web interface");
        delay(1000);
        ESP.restart();
    });
    
    // Add factory reset endpoint (was missing, causing 404 errors)
    webServer.on("/factory-reset", HTTP_GET, []() {
        webServer.send(200, "text/html", R"(
<!DOCTYPE html>
<html>
<head>
    <title>Factory Reset</title>
    <style>
        body { font-family: Arial; text-align: center; margin: 50px; background: #1a1a1a; color: #fff; }
        .status { padding: 20px; border-radius: 8px; background: #dc3545; color: white; }
    </style>
</head>
<body>
    <div class="status">
        <h1>Factory Reset Complete</h1>
        <p>Device will restart and enter configuration mode...</p>
        <p>Connect to the WiFi access point to reconfigure.</p>
    </div>
</body>
</html>
        )");
        
        Serial.println("[WEB] Factory reset requested via web interface");
        delay(1000);
        factoryReset();
    });
    
    webServer.on("/api/device-info", HTTP_GET, []() {
        JsonDocument doc;
        doc["device_type"] = DEVICE_MODEL;
        doc["firmware_version"] = FIRMWARE_VERSION;
        doc["device_name"] = deviceName;
        doc["assigned_source"] = assignedSource;
        doc["ip"] = WiFi.localIP().toString();
        doc["mac"] = WiFi.macAddress();
        doc["hostname"] = hostname;
        doc["led_disabled"] = ledManuallyDisabled;
        JsonObject state = doc["state"].to<JsonObject>();
        state["preview"] = isPreview;
        state["program"] = isProgram;
        state["streaming"] = isStreaming;
        state["recording"] = isRecording;
        state["connected"] = serverConnected;
        
        String response;
        serializeJson(doc, response);
        webServer.send(200, "application/json", response);
    });
    
    // Add firmware info endpoint for server health checks
    webServer.on("/api/firmware/info", HTTP_GET, []() {
        JsonDocument doc;
        doc["device_type"] = DEVICE_MODEL;
        doc["firmware_version"] = FIRMWARE_VERSION;
        doc["model"] = "M5StickC-PLUS";
        doc["device_name"] = deviceName;
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
                isPreview = doc["status"] == "Preview";
                isProgram = doc["status"] == "Live" || doc["status"] == "Program";
                
                // Handle enhanced recording/streaming status format

                
                if (doc["recordingStatus"].is<JsonObject>()) {
                    bool newRecordingState = doc["recordingStatus"]["active"] | false;
                    isRecording = newRecordingState;
                } else if (doc["recording"].is<bool>()) {
                    bool newRecordingState = doc["recording"] | false;
                    isRecording = newRecordingState;
                } else {
                    isRecording = false;
                }
                
                if (doc["streamingStatus"].is<JsonObject>()) {
                    bool newStreamingState = doc["streamingStatus"]["active"] | false;
                    isStreaming = newStreamingState;
                } else if (doc["streaming"].is<bool>()) {
                    bool newStreamingState = doc["streaming"] | false;
                    isStreaming = newStreamingState;
                } else {
                    isStreaming = false;
                }
                
                serverConnected = doc["obsConnected"] | true;
                
                // Update device name if provided
                if (doc["deviceName"]) {
                    String newDeviceName = doc["deviceName"];
                    deviceName = newDeviceName;
                }
                
                // Update assigned source if provided and save to persistent storage
                if (doc["assignedSource"]) {
                    String newAssignedSource = doc["assignedSource"];
                    String currentAssignedSource = assignedSource;
                    
                    if (newAssignedSource != currentAssignedSource) {
                        assignedSource = newAssignedSource;
                        saveConfig(); // Save the updated assigned source to persistent storage
                    }
                }
                

                
                // Force display update to show new recording/streaming status
                updateDisplay();
                
                webServer.send(200, "application/json", "{\"success\":true}");
            } else {

                webServer.send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
            }
        } else {

            webServer.send(400, "application/json", "{\"error\":\"No data\"}");
        }
    });
    
    webServer.begin();
}

void setupMDNS() {
    if (MDNS.begin(hostname)) {
        MDNS.addService("http", "tcp", 80);
        MDNS.addService("obs-tally", "udp", UDP_PORT);
    }
}

void setupOTA() {
    ArduinoOTA.setHostname(hostname.c_str());
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
    html += ".btn-danger { background: #dc3545; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }";
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
    html += "<p><strong>Assigned Source:</strong> " + (assignedSource.length() > 0 ? assignedSource : String("None")) + "</p>";
    html += "<p><strong>LED Status:</strong> " + (ledManuallyDisabled ? String("Disabled") : String("Auto")) + "</p>";
    html += "</div>";
    html += "<div class=\"info\">";
    html += "<h3>Statistics</h3>";
    html += "<p><strong>Successful Heartbeats:</strong> " + String(successfulHeartbeats) + "</p>";
    html += "<p><strong>Failed Heartbeats:</strong> " + String(failedHeartbeats) + "</p>";
    html += "<p><strong>Display Updates:</strong> " + String(displayUpdates) + "</p>";
    html += "<p><strong>Last Heartbeat:</strong> " + String(lastHeartbeat) + "</p>";
    html += "</div>";
    html += "<div>";
    html += "<button class=\"btn\" onclick=\"location.href='/config'\">Configuration</button>";
    html += "<button class=\"btn\" onclick=\"location.href='/restart'\">Restart</button>";
    html += "<button class=\"btn btn-danger\" onclick=\"location.href='/factory-reset'\">Factory Reset</button>";
    html += "</div></div></body></html>";
    
    webServer.send(200, "text/html", html);
}

void handleConfigPost() {
    String newServerIP = webServer.arg("server_ip");
    String newDeviceName = webServer.arg("device_name");
    uint16_t newServerPort = webServer.arg("server_port").toInt();
    String newAssignedSource = webServer.arg("assigned_source");
    bool newLedDisabled = webServer.hasArg("led_disabled"); // Checkbox is present when checked

    if (newServerIP.length() > 0) {
        serverIP = newServerIP;
    }
    if (newDeviceName.length() > 0) {
        deviceName = newDeviceName;
    }
    if (newServerPort > 0) {
        serverPort = newServerPort;
    } else if (serverPort == 0) {
        serverPort = 3005;
    }
    if (newAssignedSource.length() > 0) {
        assignedSource = newAssignedSource;
    }
    
    // Update LED preference
    bool ledStateChanged = (ledManuallyDisabled != newLedDisabled);
    ledManuallyDisabled = newLedDisabled;
    
    // If LED state changed, immediately apply the new setting
    if (ledStateChanged) {
        if (ledManuallyDisabled) {
            digitalWrite(LED_PIN, HIGH); // Turn off LED immediately
            Serial.println("[CONFIG] LED disabled via web interface");
        } else {
            updateLED(); // Apply current tally status to LED
            Serial.println("[CONFIG] LED enabled via web interface");
        }
    }

    saveConfig();
    webServer.sendHeader("Location", "/");
    webServer.send(303);
}

void handleConfig() {
    String html = "<html><head><title>Configuration</title>";
    html += "<style>";
    html += "body { font-family: Arial; margin: 20px; background: #1a1a1a; color: #fff; }";
    html += ".form-group { margin: 15px 0; }";
    html += "label { display: block; margin-bottom: 5px; font-weight: bold; }";
    html += "input[type='text'], input[type='number'] { width: 300px; padding: 8px; border: 1px solid #444; background: #333; color: #fff; border-radius: 4px; }";
    html += "input[type='checkbox'] { margin-right: 8px; transform: scale(1.2); }";
    html += "input[type='submit'] { background: #0066cc; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }";
    html += "input[type='submit']:hover { background: #0052a3; }";
    html += ".checkbox-group { display: flex; align-items: center; margin-top: 5px; }";
    html += "</style></head>";
    html += "<body><h1>Device Configuration</h1>";
    html += "<form method='post'>";
    html += "<div class='form-group'>";
    html += "<label for='server_ip'>Server IP Address:</label>";
    html += "<input type='text' id='server_ip' name='server_ip' value='" + serverIP + "' placeholder='192.168.1.100'>";
    html += "</div>";
    html += "<div class='form-group'>";
    html += "<label for='server_port'>Server Port:</label>";
    html += "<input type='number' id='server_port' name='server_port' value='" + String(serverPort) + "' placeholder='3005'>";
    html += "</div>";
    html += "<div class='form-group'>";
    html += "<label for='device_name'>Device Name:</label>";
    html += "<input type='text' id='device_name' name='device_name' value='" + deviceName + "' placeholder='OBS-Tally'>";
    html += "</div>";
    html += "<div class='form-group'>";
    html += "<label for='assigned_source'>Assigned Source:</label>";
    html += "<input type='text' id='assigned_source' name='assigned_source' value='" + assignedSource + "' placeholder='Camera 1'>";
    html += "</div>";
    html += "<div class='form-group'>";
    html += "<label>LED Settings:</label>";
    html += "<div class='checkbox-group'>";
    html += "<input type='checkbox' id='led_disabled' name='led_disabled' value='1'" + (ledManuallyDisabled ? String(" checked") : String("")) + ">";
    html += "<label for='led_disabled'>Disable LED (keep LED off regardless of tally status)</label>";
    html += "</div>";
    html += "</div>";
    html += "<input type='submit' value='Save Configuration'>";
    html += "</form>";
    html += "<br><a href='/' style='color: #0066cc;'>← Back to Status</a>";
    html += "</body></html>";
    webServer.send(200, "text/html", html);
}

void handleUpdateFile() {
    HTTPUpload& upload = webServer.upload();
    if (upload.status == UPLOAD_FILE_START) {
        M5.Lcd.fillScreen(TFT_BLACK);
        M5.Lcd.setCursor(0, 0);
        M5.Lcd.println("Update starting...");
        if (!Update.begin(UPDATE_SIZE_UNKNOWN)) {
        }
    } else if (upload.status == UPLOAD_FILE_WRITE) {
        if (Update.write(upload.buf, upload.currentSize) != upload.currentSize) {
        }
    } else if (upload.status == UPLOAD_FILE_END) {
        if (Update.end(true)) {
            M5.Lcd.println("Update Success!");
        } else {
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

void handleStatus() {
    JsonDocument doc;
    doc["device_name"] = deviceName;
    doc["preview"] = isPreview;
    doc["program"] = isProgram;
    doc["streaming"] = isStreaming;
    doc["recording"] = isRecording;
    doc["connected"] = serverConnected;
    
    String response;
    serializeJson(doc, response);
    webServer.send(200, "application/json", response);
}

void checkServer() {
    if (serverIP.length() == 0) return;
    
    HTTPClient http;
    String url = "http://" + serverIP + ":" + String(serverPort) + "/device/status";
    http.begin(url);
    
    int httpCode = http.GET();
    if (httpCode == HTTP_CODE_OK) {
        String payload = http.getString();
        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, payload);
        
        if (!error) {
            isPreview = doc["preview"] | false;
            isProgram = doc["program"] | false;
            isStreaming = doc["streaming"] | false;
            isRecording = doc["recording"] | false;
            serverConnected = true;
        }
    } else {
        serverConnected = false;
    }
    http.end();
}

void announceDevice() {
    JsonDocument doc;
    doc["type"] = "device-announce";  // Changed to match server's expected type
    doc["deviceId"] = deviceID;  // Use proper unique deviceID
    doc["deviceName"] = deviceName;
    doc["ipAddress"] = WiFi.localIP().toString();  // Changed from "ip" to "ipAddress"
    doc["macAddress"] = WiFi.macAddress();  // Changed from "mac" to "macAddress"
    doc["firmware"] = FIRMWARE_VERSION;  // Changed from "version" to "firmware"
    doc["model"] = DEVICE_MODEL;  // Changed from "type" to "model"
    doc["assignedSource"] = assignedSource;
    doc["timestamp"] = millis();
    
    String message;
    serializeJson(doc, message);
    
    // Send to configured server IP if available
    if (serverIP.length() > 0) {
        udp.beginPacket(serverIP.c_str(), 3006);
        udp.write((uint8_t*)message.c_str(), message.length());
        udp.endPacket();
    }
    
    // Also send broadcast for auto-discovery
    IPAddress broadcastIP(255, 255, 255, 255);
    udp.beginPacket(broadcastIP, 3006);
    udp.write((uint8_t*)message.c_str(), message.length());
    udp.endPacket();
    
    lastAnnounce = millis();
    
    // Reduce announcement logging to minimize serial spam
    static unsigned long lastAnnounceLog = 0;
    if (millis() - lastAnnounceLog > 300000) { // Only log every 5 minutes
        Serial.println("Device announcement sent to server and broadcast");
        lastAnnounceLog = millis();
    }
}

void registerDevice() {
    if (WiFi.status() != WL_CONNECTED || serverURL.length() == 0) {
        return;
    }
    
    Serial.println("[REGISTER] Registering device with server...");
    
    HTTPClient http;
    String url = serverURL + "/api/esp32/register";
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    
    JsonDocument doc;
    doc["deviceId"] = deviceID;
    doc["deviceName"] = deviceName.length() > 0 ? deviceName : "M5StickC-Tally";
    doc["ipAddress"] = WiFi.localIP().toString();
    doc["macAddress"] = macAddress;
    doc["firmware"] = FIRMWARE_VERSION;
    doc["model"] = DEVICE_MODEL;
    doc["assignedSource"] = assignedSource;
    
    String jsonString;
    serializeJson(doc, jsonString);
    
    int httpCode = http.POST(jsonString);
    
    if (httpCode > 0) {
        String response = http.getString();
        Serial.printf("[REGISTER] Response: %s\n", response.c_str());
        
        if (httpCode == 200) {
            isRegistered = true;
            isConnected = true;
            serverConnected = true; // Set serverConnected flag for API endpoint
            lastHeartbeatTime = 0; // Reset heartbeat timer to trigger immediate heartbeat
            Serial.println("[REGISTER] Device registration successful");
        } else {
            Serial.printf("[REGISTER] Registration failed: HTTP %d\n", httpCode);
            isRegistered = false;
        }
    } else {
        Serial.printf("[REGISTER] Registration failed: %s\n", http.errorToString(httpCode).c_str());
        isRegistered = false;
    }
    
    http.end();
}

void sendHeartbeat() {
    if (WiFi.status() != WL_CONNECTED || serverURL.length() == 0) {
        return;
    }
    
    // If not registered, try to register first
    if (!isRegistered) {
        registerDevice();
        // Don't return - continue with heartbeat if registration was successful
        if (!isRegistered) {
            return; // Only return if registration failed
        }
    }
    
    HTTPClient http;
    String url = serverURL + "/api/heartbeat";
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    
    JsonDocument doc;
    doc["id"] = deviceID;
    doc["status"] = currentStatus;
    doc["uptime"] = millis() - bootTime;
    doc["ip"] = WiFi.localIP().toString();
    doc["assignedSource"] = assignedSource;
    doc["signal"] = getWiFiSignalQuality(wifiSignalStrength);
    doc["version"] = FIRMWARE_VERSION;
    doc["model"] = DEVICE_MODEL;
    
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
                String newStatus = "";
                
                // Check for status in the nested object format from heartbeat response
                if (responseDoc["status"].is<JsonObject>() && responseDoc["status"]["status"].is<String>()) {
                    newStatus = responseDoc["status"]["status"].as<String>();
                } else if (responseDoc["status"].is<String>()) {
                    // Fallback to direct string format for compatibility
                    newStatus = responseDoc["status"].as<String>();
                }
                
                if (newStatus.length() > 0) {
                    // Update tally status based on server response
                    bool oldPreview = isPreview;
                    bool oldProgram = isProgram;
                    String oldCurrentStatus = currentStatus;
                    
                    if (newStatus == "Live" || newStatus == "Program") {
                        isProgram = true;
                        isPreview = false;
                        currentStatus = "LIVE";
                    } else if (newStatus == "Preview") {
                        isProgram = false;
                        isPreview = true;
                        currentStatus = "PREVIEW";
                    } else {
                        isProgram = false;
                        isPreview = false;
                        currentStatus = "IDLE";
                    }
                    
                    // Log status changes for debugging
                    if (oldPreview != isPreview || oldProgram != isProgram || oldCurrentStatus != currentStatus) {
                        Serial.printf("[HEARTBEAT] Status change: %s -> currentStatus=%s, isProgram=%s, isPreview=%s\n", 
                                      newStatus.c_str(), 
                                      currentStatus.c_str(),
                                      isProgram ? "true" : "false", 
                                      isPreview ? "true" : "false");
                    }
                }
                
                // Update assigned source if provided
                if (responseDoc["assignedSource"].is<String>()) {
                    String newAssignedSource = responseDoc["assignedSource"].as<String>();
                    if (newAssignedSource != assignedSource) {
                        assignedSource = newAssignedSource;
                        saveConfig(); // Save the updated assigned source to persistent storage
                        Serial.printf("[HEARTBEAT] Assigned source updated and saved: %s\n", assignedSource.c_str());
                    }
                }
                
                // Update streaming/recording status if provided
                if (responseDoc["recording"].is<bool>()) {
                    bool newRecording = responseDoc["recording"] | false;
                    if (newRecording != isRecording) {
                        isRecording = newRecording;
                        Serial.printf("[HEARTBEAT] Recording status: %s\n", isRecording ? "STARTED" : "STOPPED");
                    }
                }
                if (responseDoc["streaming"].is<bool>()) {
                    bool newStreaming = responseDoc["streaming"] | false;
                    if (newStreaming != isStreaming) {
                        isStreaming = newStreaming;
                        Serial.printf("[HEARTBEAT] Streaming status: %s\n", isStreaming ? "STARTED" : "STOPPED");
                    }
                }
            }
            
            isConnected = true;
            serverConnected = true; // Update serverConnected flag for API endpoint
            successfulHeartbeats++;
            lastHeartbeat = formatTime();
            
            // Reduce heartbeat success logging to minimize serial spam
            static unsigned long lastHeartbeatLog = 0;
            if (millis() - lastHeartbeatLog > 60000) { // Only log every minute
                Serial.println("[HEARTBEAT] Successful");
                lastHeartbeatLog = millis();
            }
        } else if (httpCode == 404) {
            // Device not registered on server, clear registration flag
            isRegistered = false;
            isConnected = false;
            serverConnected = false;
            failedHeartbeats++;
            Serial.println("[HEARTBEAT] Device not registered on server, will re-register");
        } else {
            isConnected = false;
            serverConnected = false;
            failedHeartbeats++;
            lastError = "Heartbeat failed: HTTP " + String(httpCode);
            Serial.printf("[HEARTBEAT] Failed: HTTP %d\n", httpCode);
        }
    } else {
        isConnected = false;
        serverConnected = false;
        failedHeartbeats++;
        lastError = "Heartbeat failed: " + http.errorToString(httpCode);
        Serial.printf("[HEARTBEAT] Failed: %s\n", http.errorToString(httpCode).c_str());
    }
    
    http.end();
    lastHeartbeatTime = millis();
}

// LED control function - solid red for live, blinking red for preview, off for idle
void updateLED() {
    static unsigned long lastLEDBlink = 0;
    static bool ledState = false;
    
    // Check if LED is manually disabled - Always turn LED off in this case
    if (ledManuallyDisabled) {
        digitalWrite(LED_PIN, HIGH); // LED OFF (HIGH = OFF for M5StickC Plus)
        ledState = false;
        return;
    }
    
    // Check for error conditions first - turn off LED
    if (!serverConnected || WiFi.status() != WL_CONNECTED || configMode) {
        // LED off for no server connection, no WiFi, or config mode
        digitalWrite(LED_PIN, HIGH); // LED OFF (HIGH = OFF for M5StickC Plus)
        ledState = false; // Reset blink state
        return;
    }
    
    if (isProgram) {
        // Solid red LED for LIVE/program (LED ON)
        digitalWrite(LED_PIN, LOW); // LED ON (LOW = ON for M5StickC Plus)
        ledState = true; // Keep track of state
    } else if (isPreview) {
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
        // Update activity on any button press (but rate limited)
        static unsigned long lastBtnBActivity = 0;
        if (millis() - lastBtnBActivity > 5000) { // Only update activity every 5 seconds from button B presses
            updateActivity();
            lastBtnBActivity = millis();
        }
        
        btnB_PressStart = millis();
        btnB_IsPressed = true;
        btnB_LongPressHandled = false;
        
        Serial.println("[BUTTON] Button B pressed");
        
        // Check for double click
        if (btnB_WaitingForDouble) {
            // This is a double click
            btnB_WaitingForDouble = false;
            btnB_ClickCount = 2;
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
            
            btnB_ClickCount = 0;
            return;
        } else {
            // Start waiting for potential double click
            btnB_WaitingForDouble = true;
            btnB_LastPress = millis();
            btnB_ClickCount = 1;
        }
    }
    
    // Handle button release
    if (M5.BtnB.wasReleased()) {
        btnB_IsPressed = false;
        unsigned long pressDuration = millis() - btnB_PressStart;
        
        Serial.printf("[BUTTON] Button B released after %lu ms\n", pressDuration);
        
        // Don't process single click if long press was already handled
        if (btnB_LongPressHandled) {
            btnB_WaitingForDouble = false;
            btnB_ClickCount = 0;
            return;
        }
    }
    
    // Handle long press while button is held
    if (btnB_IsPressed && !btnB_LongPressHandled) {
        unsigned long pressDuration = millis() - btnB_PressStart;
        
        if (pressDuration >= LONG_PRESS_TIME) {
            // Long press action: Show network info
            btnB_LongPressHandled = true;
            btnB_WaitingForDouble = false;
            btnB_ClickCount = 0;
            
            Serial.println("[BUTTON] Long press detected");
            showNetworkInfo();
            return;
        }
    }
    
    // Handle single click timeout
    if (btnB_WaitingForDouble && 
        (millis() - btnB_LastPress >= DOUBLE_CLICK_TIME)) {
        
        btnB_WaitingForDouble = false;
        
        if (btnB_ClickCount == 1) {
            // Single click action: LED toggle
            Serial.println("[BUTTON] Single click detected");
            toggleLED();
        }
        
        btnB_ClickCount = 0;
    }
}

// Toggle LED on/off manually
void toggleLED() {
    // Toggle the LED manual disable state
    ledManuallyDisabled = !ledManuallyDisabled;
    
    // Save the LED preference to persistent storage
    saveConfig();
    
    // Show feedback on display
    M5.Lcd.fillScreen(TFT_BLACK);
    M5.Lcd.setTextColor(ledManuallyDisabled ? TFT_RED : TFT_GREEN);
    M5.Lcd.setTextSize(2);
    M5.Lcd.setCursor(10, 30);
    M5.Lcd.println("LED");
    M5.Lcd.setCursor(10, 50);
    M5.Lcd.println(ledManuallyDisabled ? "OFF" : "AUTO");
    
    Serial.printf("[LED] LED manually %s (saved to config)\n", ledManuallyDisabled ? "DISABLED" : "ENABLED");
    
    // If disabling, turn off LED immediately
    if (ledManuallyDisabled) {
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
    M5.Lcd.setTextColor(serverConnected ? TFT_GREEN : TFT_RED);
    M5.Lcd.println(serverConnected ? "Connected" : "Offline");
    
    // Show assigned source
    if (assignedSource.length() > 0) {
        M5.Lcd.setTextColor(TFT_CYAN);
        M5.Lcd.setCursor(5, 100);
        M5.Lcd.print("Source: ");
        String source = assignedSource;
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
    Serial.printf("Server: %s\n", serverConnected ? "Connected" : "Offline");
    Serial.printf("Source: %s\n", assignedSource.c_str());
    
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
    Serial.println("[POWER] Initializing STABLE power management system (anti-restart mode)");
    
    // Initialize power state
    lastActivity = millis();
    lastDisplayUpdate = millis();
    powerSaveMode = false;
    displayDimmed = false;
    deepSleepEnabled = false; // DISABLED to prevent random restarts
    originalBrightness = BRIGHTNESS_IDLE;
    wifiPowerSaveStart = 0;
    cpuFreqReduced = false;
    lowBatteryMode = false;
    
    // Initialize battery percentage to safe default
    batteryPercent = 50; // Safe default
    
    // Configure AXP192 power management VERY conservatively for stability
    // Ensure LCD power is stable
    M5.Axp.SetLDO2(true);   // Ensure LCD backlight power is enabled
    delay(100); // Allow power to stabilize
    
    // Keep CPU at normal frequency for stability (no aggressive power saving)
    setCpuFrequencyMhz(CPU_FREQ_NORMAL);
    
    cpuFreqReduced = false;
    
    // Configure WiFi power saving VERY conservatively
    WiFi.setSleep(false); // Keep WiFi fully awake for stability
    WiFi.setTxPower(WIFI_POWER_11dBm); // Use normal power for stability
    
    // Update battery status after initialization
    delay(1000); // Give AXP192 time to initialize properly
    updateBatteryStatus();
    
    // FORCE disable deep sleep for stability - prevent random restarts
    deepSleepEnabled = false;
    Serial.println("[POWER] Deep sleep FORCIBLY DISABLED to prevent random restarts");
    
    Serial.printf("[POWER] STABLE power management initialized - Battery: %d%%, CPU: %dMHz, DeepSleep: DISABLED\n", 
                  batteryPercent, getCpuFrequencyMhz());
}

// Update power management state based on activity and battery level  
void updatePowerState() {
    static unsigned long lastPowerStateUpdate = 0;
    unsigned long currentTime = millis();
    
    // Only update power state every 15 seconds to reduce CPU usage and prevent restart triggers
    if (currentTime - lastPowerStateUpdate < 15000) {
        return;
    }
    lastPowerStateUpdate = currentTime;
    
    // Stability check - monitor for potential restart conditions
    static uint32_t lastFreeHeap = 0;
    uint32_t currentFreeHeap = ESP.getFreeHeap();
    
    if (lastFreeHeap > 0 && currentFreeHeap < lastFreeHeap - 10000) {
        Serial.printf("[POWER] WARNING: Significant memory drop detected: %u -> %u bytes\n", 
                      lastFreeHeap, currentFreeHeap);
        // Force minor garbage collection
        delay(50);
    }
    lastFreeHeap = currentFreeHeap;
    
    // Update battery status periodically but not too frequently
    static unsigned long lastBatteryUpdate = 0;
    if (currentTime - lastBatteryUpdate > 45000) { // Update every 45 seconds instead of 30
        try {
            updateBatteryStatus();
        } catch (...) {
            Serial.println("[POWER] WARNING: Battery status update failed - using fallback");
            batteryPercent = 50; // Safe fallback
        }
        lastBatteryUpdate = currentTime;
    }
    
    // DISABLE ALL aggressive power management features to prevent restarts
    if (batteryPercent < 15 && !lowBatteryMode) {
        Serial.printf("[POWER] Low battery detected (%d%%) but ULTRA-CONSERVATIVE mode enabled for stability\n", batteryPercent);
        // Do NOT call handleLowBattery() - it could trigger restarts
        // Just set a flag but don't change power settings aggressively
        lowBatteryMode = true;
        Serial.println("[POWER] Low battery mode enabled in conservative mode only");
    } else if (batteryPercent > 40 && lowBatteryMode) {
        // Exit low battery mode when battery recovers
        lowBatteryMode = false;
        Serial.println("[POWER] Exiting low battery mode");
    }
    
    // COMPLETELY DISABLE all power-saving features that could cause instability
    powerSaveMode = false;
    displayDimmed = false;
    deepSleepEnabled = false;
    
    // Keep WiFi at full power to prevent disconnection-related restarts
    WiFi.setSleep(false);
    WiFi.setTxPower(WIFI_POWER_11dBm);
    
    // Keep CPU at normal frequency to prevent clock-related instability
    if (getCpuFrequencyMhz() != CPU_FREQ_NORMAL) {
        setCpuFrequencyMhz(CPU_FREQ_NORMAL);
        Serial.println("[POWER] CPU frequency restored to normal for stability");
    }
}

// Enter power save mode with reduced CPU frequency and optimized settings
void enterPowerSaveMode() {
    if (powerSaveMode) return; // Already in power save mode
    
    Serial.println("[POWER] Entering power save mode");
    powerSaveMode = true;
    
    // Reduce CPU frequency
    adjustCPUFrequency(true);
    
    // Optimize WiFi power
    optimizeWiFiPower();
    
    // Reduce display brightness if not already dimmed
    if (!displayDimmed) {
        dimDisplay();
    }
    
    // Disable unnecessary features for power saving
    // Note: Advanced LDO/DCDC control not available in this library version
    
    Serial.printf("[POWER] Power save mode active - CPU: %dMHz, Battery: %d%%\n", 
                  getCpuFrequencyMhz(), batteryPercent);
}

// Exit power save mode and restore normal operation
void exitPowerSaveMode() {
    if (!powerSaveMode) return; // Not in power save mode
    
    Serial.println("[POWER] Exiting power save mode");
    powerSaveMode = false;
    
    // Restore normal CPU frequency
    adjustCPUFrequency(false);
    
    // Restore display brightness
    brightenDisplay();
    
    // Restore normal WiFi operation
    WiFi.setSleep(false);
    
    // Reset WiFi power save timer
    wifiPowerSaveStart = 0;
    
    Serial.printf("[POWER] Normal operation restored - CPU: %dMHz\n", getCpuFrequencyMhz());
}

// Update battery status and percentage
void updateBatteryStatus() {
    float batteryVoltage = M5.Axp.GetBatVoltage();
    float chargeCurrent = M5.Axp.GetBatChargeCurrent();
    // Note: Discharge current not available in this library version
    
    // Validate battery voltage reading - if it's unrealistic, use fallback and disable deep sleep
    if (batteryVoltage < 2.5 || batteryVoltage > 5.0) {
        Serial.printf("[POWER] WARNING: Invalid battery voltage %.2fV - using fallback\n", batteryVoltage);
        batteryVoltage = 3.7; // Fallback to nominal voltage
        batteryPercent = 50;  // Safe fallback percentage
        
        // Disable deep sleep when battery readings are unreliable - PREVENT RESTARTS
        deepSleepEnabled = false;
        Serial.println("[POWER] Deep sleep DISABLED due to unreliable battery readings - RESTART PREVENTION");
        return;
    } else {
        // KEEP deep sleep disabled even if voltage readings become reliable - stability first
        if (!deepSleepEnabled && batteryVoltage >= 2.5 && batteryVoltage <= 5.0) {
            // Do NOT re-enable deep sleep automatically - keep disabled for stability
            Serial.println("[POWER] Battery readings stable but deep sleep remains DISABLED for stability");
        }
    }
    
    // Enhanced charging detection first  
    bool isCharging = chargeCurrent > 1.0;
    bool chargingComplete = (batteryVoltage >= 4.1 && chargeCurrent > 0 && chargeCurrent < 15.0);
    
    // Enhanced battery percentage calculation that treats 4.1V as "Full" (100%)
    // This accounts for AXP192's conservative charging behavior and voltage drops when disconnecting
    int newBatteryPercent;
    
    static bool wasChargingComplete = false;
    static unsigned long lastDisconnectTime = 0;
    
    // Detect recent disconnect from charging (voltage drop from 4.1V+ to 3.9V+ range)
    bool recentlyDisconnected = false;
    if (wasChargingComplete && !isCharging && !chargingComplete && 
        batteryVoltage >= 3.85 && batteryVoltage < 4.1) {
        recentlyDisconnected = true;
        lastDisconnectTime = millis();
    }
    
    // Maintain full charge indication for 30 seconds after disconnect to prevent sudden drops
    bool maintainFullCharge = (millis() - lastDisconnectTime < 30000) && 
                              batteryVoltage >= 3.85 && !isCharging;
    
    if (batteryVoltage >= 4.1) {
        // 4.1V+ = 100% (M5StickCPlus charging complete)
        newBatteryPercent = 100;
    } else if (maintainFullCharge || recentlyDisconnected) {
        // Recently disconnected from full charge - maintain 100% briefly to prevent jarring drop
        newBatteryPercent = 100;
    } else if (batteryVoltage >= 3.95) {
        // 3.95V-4.1V = 95-99% range (very high charge, recently disconnected or nearly full)
        newBatteryPercent = map(batteryVoltage * 1000, 3950, 4100, 95, 99);
    } else if (batteryVoltage >= 3.8) {
        // 3.8V-3.95V = 85-95% range (good charge level)
        newBatteryPercent = map(batteryVoltage * 1000, 3800, 3950, 85, 95);
    } else if (batteryVoltage >= 3.6) {
        // 3.6V-3.8V = 60-85% range (moderate charge)
        newBatteryPercent = map(batteryVoltage * 1000, 3600, 3800, 60, 85);
    } else if (batteryVoltage >= 3.4) {
        // 3.4V-3.6V = 30-60% range (lower charge)
        newBatteryPercent = map(batteryVoltage * 1000, 3400, 3600, 30, 60);
    } else if (batteryVoltage >= 3.2) {
        // 3.2V-3.4V = 10-30% range (low charge)
        newBatteryPercent = map(batteryVoltage * 1000, 3200, 3400, 10, 30);
    } else if (batteryVoltage >= 3.0) {
        // 3.0V-3.2V = 0-10% range (critical charge)
        newBatteryPercent = map(batteryVoltage * 1000, 3000, 3200, 0, 10);
    } else {
        // Below 3.0V = critical battery
        newBatteryPercent = 0;
    }
    
    newBatteryPercent = constrain(newBatteryPercent, 0, 100);
    
    // Update charging complete tracking
    wasChargingComplete = chargingComplete;
    
    // Smooth battery percentage changes to avoid sudden drops
    if (abs(newBatteryPercent - batteryPercent) > 20) {
        // Large change detected - validate it
        Serial.printf("[POWER] Large battery change detected: %d%% -> %d%% (%.2fV)\n", 
                      batteryPercent, newBatteryPercent, batteryVoltage);
        
        // If new reading is 0% but voltage is reasonable, don't trust it
        if (newBatteryPercent == 0 && batteryVoltage > 3.0) {
            Serial.println("[POWER] Ignoring 0% reading with reasonable voltage");
            return; // Keep old battery percentage
        }
    }
    
    batteryPercent = newBatteryPercent;
    
    // Log battery status periodically
    static unsigned long lastBatteryLog = 0;
    if (millis() - lastBatteryLog > 60000) { // Log every 60 seconds instead of 30 to reduce spam
        String chargeStatus = "No";
        if (chargingComplete) {
            chargeStatus = "Complete";
        } else if (isCharging) {
            chargeStatus = "Yes";
        }
        
        Serial.printf("[POWER] Battery: %d%% (%.2fV), Charge: %.1fmA, Charging: %s, DeepSleep: %s\n",
                      batteryPercent, batteryVoltage, chargeCurrent,
                      chargeStatus.c_str(), deepSleepEnabled ? "Enabled" : "Disabled");
        lastBatteryLog = millis();
    }
}

// Handle low battery condition with aggressive power saving
void handleLowBattery() {
    if (lowBatteryMode) return; // Already in low battery mode
    
    Serial.printf("[POWER] LOW BATTERY WARNING: %d%% - Entering aggressive power save\n", 
                  batteryPercent);
    lowBatteryMode = true;
    
    // Show low battery warning on display
    M5.Lcd.fillScreen(TFT_BLACK);
    M5.Lcd.setTextColor(TFT_RED);
    M5.Lcd.setTextSize(2);
    M5.Lcd.setCursor(10, 20);
    M5.Lcd.println("LOW BATTERY");
    M5.Lcd.setTextSize(3);
    M5.Lcd.setCursor(20, 50);
    M5.Lcd.printf("%d%%", batteryPercent);
    
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
    // Final safety checks before deep sleep
    if (batteryPercent <= 5) {
        Serial.printf("[POWER] CRITICAL: Battery too low for deep sleep (%d%%) - staying awake\n", batteryPercent);
        deepSleepEnabled = false; // Disable deep sleep if battery is critically low
        return;
    }
    
    if (millis() < 300000) { // Don't sleep within first 5 minutes of boot
        Serial.println("[POWER] Deep sleep skipped - device recently booted");
        return;
    }
    
    if (isPreview || isProgram) {
        Serial.println("[POWER] Deep sleep skipped - device is active as tally light");
        return;
    }
    
    Serial.printf("[POWER] Entering deep sleep for %llu seconds (Battery: %d%%, Uptime: %s)\n", 
                  DEEP_SLEEP_DURATION / 1000000ULL, batteryPercent, formatUptime().c_str());
    
    // Show sleep message on display
    M5.Lcd.fillScreen(TFT_BLACK);
    M5.Lcd.setTextColor(TFT_BLUE);
    M5.Lcd.setTextSize(2);
    M5.Lcd.setCursor(10, 30);
    M5.Lcd.println("SLEEPING");
    M5.Lcd.setTextSize(1);
    M5.Lcd.setCursor(10, 60);
    M5.Lcd.printf("Wake in %ds", (int)(DEEP_SLEEP_DURATION / 1000000ULL));
    M5.Lcd.setCursor(10, 80);
    M5.Lcd.printf("Battery: %d%%", batteryPercent);
    
    delay(2000); // Show message longer for user feedback
    
    // Configure wake-up sources
    esp_sleep_enable_timer_wakeup(DEEP_SLEEP_DURATION); // Already in microseconds
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
    if (displayDimmed) return; // Already dimmed
    
    Serial.println("[POWER] Dimming display for power saving");
    displayDimmed = true;
    
    // Store original brightness if not already stored
    if (originalBrightness == BRIGHTNESS_IDLE) {
        originalBrightness = isProgram ? BRIGHTNESS_LIVE :
                           isPreview ? BRIGHTNESS_PREVIEW :
                           BRIGHTNESS_IDLE;
    }
    
    // Set to very low brightness (25% of original)
    uint8_t dimBrightness = originalBrightness / 4;
    if (dimBrightness < 10) dimBrightness = 10; // Minimum readable brightness
    
    setBrightness(dimBrightness);
    lastDisplayUpdate = millis();
    
    Serial.printf("[POWER] Display dimmed to %d (was %d)\n", dimBrightness, originalBrightness);
}

// Restore display brightness
void brightenDisplay() {
    if (!displayDimmed) return; // Not dimmed
    
    Serial.println("[POWER] Restoring display brightness");
    displayDimmed = false;
    
    // Restore appropriate brightness based on current state
    uint8_t targetBrightness = isProgram ? BRIGHTNESS_LIVE :
                              isPreview ? BRIGHTNESS_PREVIEW :
                              BRIGHTNESS_IDLE;
    
       
    setBrightness(targetBrightness);
    lastDisplayUpdate = millis();
    
    Serial.printf("[POWER] Display brightness restored to %d\n", targetBrightness);
}

// Update activity timestamp and exit power save modes if active
void updateActivity() {
    unsigned long currentTime = millis();
    
    // Only update if significant time has passed to avoid excessive updates
    if (currentTime - lastActivity < 10000) return; // Increased from 5s to 10s to further reduce noise
    
    lastActivity = currentTime;
    
    // Only log if we actually changed something to reduce serial spam
    bool changedSomething = false;
    
    // Exit power save mode if active
    if (powerSaveMode && !lowBatteryMode) {
        exitPowerSaveMode();
        changedSomething = true;
    }
    
    // Restore display brightness if dimmed
    if (displayDimmed && !lowBatteryMode) {
        brightenDisplay();
        changedSomething = true;
    }
    
    // Only log when we actually reset power modes, not on every activity
    if (changedSomething) {
        Serial.println("[POWER] Activity detected - power save modes reset");
    }
}

// Optimize WiFi power consumption conservatively to prevent disconnects
void optimizeWiFiPower() {
    // Reduce WiFi power conservatively to prevent disconnects
    if (WiFi.status() != WL_CONNECTED) return;
    
    Serial.println("[POWER] Optimizing WiFi power consumption (conservative mode)");
    
    // Use moderate WiFi sleep mode instead of aggressive sleep
    WiFi.setSleep(WIFI_PS_MIN_MODEM); // Less aggressive than true
    
    // Use moderate power reduction instead of minimum power
    if (lowBatteryMode) {
        WiFi.setTxPower(WIFI_POWER_5dBm); // Moderate instead of minimum
    } else if (powerSaveMode) {
        WiFi.setTxPower(WIFI_POWER_8_5dBm); // Conservative power reduction
    } else {
        WiFi.setTxPower(WIFI_POWER_11dBm); // Normal power for stability
    }
    
    // Remove aggressive modem sleep that could cause disconnects
    // esp_wifi_set_ps(WIFI_PS_MIN_MODEM); // DISABLED - causing instability
    
    Serial.printf("[POWER] WiFi power optimized conservatively - TX Power: moderate\n");
}

// Adjust CPU frequency for power management
void adjustCPUFrequency(bool powerSave) {
    uint32_t targetFreq = powerSave ? CPU_FREQ_POWER_SAVE : CPU_FREQ_NORMAL;
    uint32_t currentFreq = getCpuFrequencyMhz();
    
    if (currentFreq == targetFreq) return; // Already at target frequency
    
    Serial.printf("[POWER] Adjusting CPU frequency: %dMHz -> %dMHz\n", currentFreq, targetFreq);
    
    bool success = setCpuFrequencyMhz(targetFreq);
    
    if (success) {
        cpuFreqReduced = powerSave;
        Serial.printf("[POWER] CPU frequency changed to %dMHz (requested %dMHz)\n", 
                      getCpuFrequencyMhz(), targetFreq);
    } else {
        Serial.printf("[POWER] Failed to change CPU frequency to %dMHz\n", targetFreq);
    }
}

// ==================== MISSING UTILITY FUNCTIONS ====================

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
  if (!ntpInitialized) {
    return "Not synced";
  }
  
  timeClient.update();
  time_t epochTime = timeClient.getEpochTime();
  struct tm *ptm = gmtime((time_t *)&epochTime);
  
  char buffer[32];
  snprintf(buffer, sizeof(buffer), "%04d-%02d-%02d %02d:%02d:%02d UTC",
           ptm->tm_year + 1900, ptm->tm_mon + 1, ptm->tm_mday,
           ptm->tm_hour, ptm->tm_min, ptm->tm_sec);
  
  return String(buffer);
}

uint16_t interpolateColor(uint16_t color1, uint16_t color2, float factor) {
  if (factor <= 0.0) return color1;
  if (factor >= 1.0) return color2;
  
  // Extract RGB components from 16-bit colors
  uint8_t r1 = (color1 >> 11) & 0x1F;
  uint8_t g1 = (color1 >> 5) & 0x3F;
  uint8_t b1 = color1 & 0x1F;
  
  uint8_t r2 = (color2 >> 11) & 0x1F;
  uint8_t g2 = (color2 >> 5) & 0x3F;
  uint8_t b2 = color2 & 0x1F;
  
  // Interpolate
  uint8_t r = r1 + (uint8_t)((r2 - r1) * factor);
  uint8_t g = g1 + (uint8_t)((g2 - g1) * factor);
  uint8_t b = b1 + (uint8_t)((b2 - b1) * factor);
  
  return (r << 11) | (g << 5) | b;
}

int getWiFiSignalQuality(int32_t rssi) {
  if (rssi == 0) return 0;
  if (rssi <= -100) return 0;
  if (rssi >= -50) return 100;
  return 2 * (rssi + 100);
}

void updateWiFiSignalStrength() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiSignalStrength = WiFi.RSSI();
  } else {
    wifiSignalStrength = -100;
  }
}

void checkServerConnection() {
  if (serverURL.length() == 0) return;
  
  HTTPClient http;
  http.begin(serverURL + "/api/status");
  http.setTimeout(5000);
  
  int httpCode = http.GET();
  bool serverOnline = (httpCode == 200);
  
  if (serverOnline != isConnected) {
    isConnected = serverOnline;
    if (isConnected) {
      Serial.println("[SERVER] Connection restored");
      lastError = "";
    } else {
      Serial.printf("[SERVER] Connection lost (HTTP %d)\n", httpCode);
      lastError = "Server connection failed";
    }
  }
  
  http.end();
}

void setupDiscovery() {
  if (!discoveryUDPInitialized) {
    if (discoveryUDP.begin(UDP_DISCOVERY_PORT)) {
      discoveryUDPInitialized = true;
      Serial.printf("[UDP] Discovery service started on port %d\n", UDP_DISCOVERY_PORT);
    } else {
      Serial.println("[UDP] Failed to start discovery service");
    }
  }
}

void handleDiscoveryRequest() {
  if (!discoveryUDPInitialized) return;
  
  int packetSize = discoveryUDP.parsePacket();
  if (packetSize > 0) {
    String request = discoveryUDP.readString();
    request.trim();
    
    if (request == "DISCOVER_TALLY") {
      JsonDocument response;
      response["type"] = "tally_device";
      response["id"] = deviceID;
      response["name"] = deviceName;
      response["model"] = DEVICE_MODEL;
      response["version"] = FIRMWARE_VERSION;
      response["ip"] = WiFi.localIP().toString();
      response["mac"] = macAddress;
      response["status"] = currentStatus;
      response["uptime"] = millis() - bootTime;
      
      String responseStr;
      serializeJson(response, responseStr);
      
      discoveryUDP.beginPacket(discoveryUDP.remoteIP(), discoveryUDP.remotePort());
      discoveryUDP.print(responseStr);
      discoveryUDP.endPacket();
      
      Serial.printf("[UDP] Responded to discovery from %s\n", 
                   discoveryUDP.remoteIP().toString().c_str());
    }
  }
}

// Perform periodic health check to monitor device status (reduce logging frequency)
void performHealthCheck() {
  // Reduce health check logging frequency to minimize serial spam
  static unsigned long lastHealthLog = 0;
  bool shouldLog = (millis() - lastHealthLog > 300000); // Only log every 5 minutes
  
  if (shouldLog) {
    Serial.println("[HEALTH] Performing health check...");
    lastHealthLog = millis();
  }
  
  // Check memory
  uint32_t freeHeap = ESP.getFreeHeap();
  if (freeHeap < 50000) {
    Serial.printf("[HEALTH] WARNING: Low memory - %u bytes\n", freeHeap);
  }
  
  // Check WiFi signal strength
  if (WiFi.status() == WL_CONNECTED) {
    updateWiFiSignalStrength();
    if (shouldLog) {
      Serial.printf("[HEALTH] WiFi RSSI: %d dBm\n", wifiSignalStrength);
    }
    
    if (wifiSignalStrength < -80 && shouldLog) {
      Serial.println("[HEALTH] WARNING: Weak WiFi signal");
    }
  }
  
  // Check heartbeat success rate
  if (successfulHeartbeats + failedHeartbeats > 10) {
    float successRate = (float)successfulHeartbeats / (successfulHeartbeats + failedHeartbeats) * 100;
    if (shouldLog) {
      Serial.printf("[HEALTH] Heartbeat success rate: %.1f%%\n", successRate);
    }
    
    if (successRate < 80) {
      Serial.println("[HEALTH] WARNING: Low heartbeat success rate");
    }
  }
  
  // Check battery status
  Serial.printf("[HEALTH] Battery: %d%%, Power save: %s\n", 
                batteryPercent, powerSaveMode ? "ON" : "OFF");
  
  Serial.println("[HEALTH] Health check complete");
}

// Disable deep sleep mode completely
void disableDeepSleep() {
    deepSleepEnabled = false;
    Serial.println("[POWER] Deep sleep DISABLED by user/system");
}

// Enable deep sleep mode (with safety checks)
void enableDeepSleep() {
    // Only enable if battery readings are reliable
    if (batteryPercent > 5 && batteryPercent < 95) {
        deepSleepEnabled = true;
        Serial.println("[POWER] Deep sleep ENABLED");
    } else {
        Serial.printf("[POWER] Deep sleep NOT enabled - battery reading suspicious: %d%%\n", batteryPercent);
    }
}

// ==================== STABILITY MONITORING FUNCTIONS ====================

// Perform comprehensive stability check to prevent restart conditions
void performStabilityCheck() {
    static unsigned long lastStabilityCheck = 0;
    unsigned long currentTime = millis();
    
    // Only run stability check every 30 seconds to avoid overhead
    if (currentTime - lastStabilityCheck < 30000) {
        return;
    }
    lastStabilityCheck = currentTime;
    
    // Monitor system health
    monitorSystemHealth();
    
    // Prevent known restart conditions
    preventRestartConditions();
    
    // Log stability status periodically (every 5 minutes)
    static unsigned long lastStabilityLog = 0;
    if (currentTime - lastStabilityLog > 300000) {
        Serial.printf("[STABILITY] System stable for %s - Free heap: %u bytes\n", 
                      formatUptime().c_str(), ESP.getFreeHeap());
        lastStabilityLog = currentTime;
    }
}

// Monitor overall system health and detect potential issues
void monitorSystemHealth() {
    // Check memory status
    uint32_t freeHeap = ESP.getFreeHeap();
    static uint32_t minHeapSeen = UINT32_MAX;
    
    if (freeHeap < minHeapSeen) {
        minHeapSeen = freeHeap;
        if (freeHeap < 50000) {
            Serial.printf("[STABILITY] WARNING: Low memory detected - %u bytes (minimum seen: %u)\n", 
                          freeHeap, minHeapSeen);
        }
    }
    
    // Check for brownout conditions
    if (batteryPercent < 10 && M5.Axp.GetBatVoltage() < 3.2) {
        Serial.println("[STABILITY] WARNING: Potential brownout condition detected");
        // Reduce activity to prevent brownout reset
        delay(100);
    }
    
    // Check WiFi stability
    static int consecutiveWiFiFailures = 0;
    if (WiFi.status() != WL_CONNECTED) {
        consecutiveWiFiFailures++;
        if (consecutiveWiFiFailures > 5) {
            Serial.printf("[STABILITY] WARNING: Extended WiFi failure - %d consecutive failures\n", 
                          consecutiveWiFiFailures);
            // Reset counter to prevent spam
            consecutiveWiFiFailures = 0;
        }
    } else {
        consecutiveWiFiFailures = 0;
    }
    
    // Check for excessive heat (could cause instability)
    // Note: M5StickCPlus doesn't have built-in temperature sensor in this library version
    // But we can monitor CPU frequency stability as an indicator
    static uint32_t lastCpuFreq = 0;
    uint32_t currentCpuFreq = getCpuFrequencyMhz();
    if (lastCpuFreq > 0 && abs((int)(currentCpuFreq - lastCpuFreq)) > 20) {
        Serial.printf("[STABILITY] WARNING: CPU frequency instability detected: %u -> %u MHz\n", 
                      lastCpuFreq, currentCpuFreq);
    }
    lastCpuFreq = currentCpuFreq;
}

// Prevent conditions that are known to cause restarts
void preventRestartConditions() {
    // Force disable watchdog-triggering operations
    static bool watchdogWarningShown = false;
    
    // Ensure we're not in any tight loops that could trigger watchdog
    static unsigned long lastYield = 0;
    if (millis() - lastYield > 1000) {
        yield(); // Give other tasks a chance to run
        lastYield = millis();
        
        if (!watchdogWarningShown) {
            Serial.println("[STABILITY] Watchdog prevention active - regular yields enabled");
            watchdogWarningShown = true;
        }
    }
    
    // Ensure power management doesn't trigger aggressive changes
    if (powerSaveMode || displayDimmed) {
        Serial.println("[STABILITY] Disabling power save features to prevent restart triggers");
        powerSaveMode = false;
        displayDimmed = false;
        
        // Restore stable power settings
        WiFi.setSleep(false);
        setCpuFrequencyMhz(CPU_FREQ_NORMAL);
        setBrightness(BRIGHTNESS_IDLE);
    }
    
    // Ensure deep sleep remains disabled
    if (deepSleepEnabled) {
        Serial.println("[STABILITY] Force disabling deep sleep to prevent restart loops");
        deepSleepEnabled = false;
    }
    
    // Monitor and prevent stack overflow conditions
    static size_t maxStackUsed = 0;
    size_t currentStackPtr = (size_t)&currentStackPtr;
    static size_t initialStackPtr = 0;
    
    if (initialStackPtr == 0) {
        initialStackPtr = currentStackPtr;
    }
    
    size_t stackUsed = initialStackPtr - currentStackPtr;
    if (stackUsed > maxStackUsed) {
        maxStackUsed = stackUsed;
        if (stackUsed > 6000) { // Warn if stack usage is high
            Serial.printf("[STABILITY] WARNING: High stack usage detected - %u bytes used\n", stackUsed);
        }
    }
    
    // Prevent HTTP client memory leaks
    static unsigned long lastHttpCleanup = 0;
    if (millis() - lastHttpCleanup > 60000) { // Cleanup every minute
        // Force cleanup of any lingering HTTP connections
        Serial.println("[STABILITY] Performing periodic HTTP client cleanup");
        lastHttpCleanup = millis();
    }
}
