/*
 * TFT_eSPI User_Setup.h configuration for ESP32-1732S019
 * 
 * This file should be copied to your TFT_eSPI library folder:
 * ~/Documents/Arduino/libraries/TFT_eSPI/User_Setup.h
 * 
 * OR create as a separate setup file and include it in your main sketch
 * with: #include <User_Setups/Setup_ESP32_1732S019.h>
 */

// Driver selection
#define ST7789_DRIVER      // Configure for ST7789V display controller

// Resolution
#define TFT_WIDTH  170
#define TFT_HEIGHT 320

// Color order (may need adjustment based on your specific panel)
#define TFT_RGB_ORDER TFT_BGR  // Color order Blue-Green-Red

// ESP32-1732S019 pin definitions for 8-bit parallel interface
#define TFT_CS   5   // Chip select control pin
#define TFT_DC   6   // Data Command control pin
#define TFT_RST  9   // Reset pin
#define TFT_WR   7   // Write strobe for 8-bit parallel interface
#define TFT_RD   8   // Read strobe for 8-bit parallel interface

// 8-bit parallel data pins
#define TFT_D0   39  // Data bit 0
#define TFT_D1   40  // Data bit 1
#define TFT_D2   41  // Data bit 2
#define TFT_D3   42  // Data bit 3
#define TFT_D4   43  // Data bit 4  
#define TFT_D5   44  // Data bit 5
#define TFT_D6   45  // Data bit 6
#define TFT_D7   46  // Data bit 7

// Backlight control
#define TFT_BL   38  // LED back-light control pin
#define TFT_BACKLIGHT_ON HIGH  // Level to turn ON back-light (HIGH or LOW)

// Enable 8-bit parallel interface
#define TFT_PARALLEL_8_BIT

// Fonts to be available
#define LOAD_GLCD   // Font 1. Original Adafruit 8 pixel font needs ~1820 bytes in FLASH
#define LOAD_FONT2  // Font 2. Small 16 pixel high font, needs ~3534 bytes in FLASH, 96 characters
#define LOAD_FONT4  // Font 4. Medium 26 pixel high font, needs ~5848 bytes in FLASH, 96 characters
#define LOAD_FONT6  // Font 6. Large 48 pixel font, needs ~2666 bytes in FLASH, only characters 1234567890:-.apm
#define LOAD_FONT7  // Font 7. 7 segment 48 pixel font, needs ~2438 bytes in FLASH, only characters 1234567890:-.
#define LOAD_FONT8  // Font 8. Large 75 pixel font needs ~3256 bytes in FLASH, only characters 1234567890:-.
#define LOAD_GFXFF  // FreeFonts. Include access to the 48 Adafruit_GFX free fonts FF1 to FF48 and custom fonts

// Other options
#define SMOOTH_FONT

// ESP32 specific optimizations
#ifdef ESP32
  #define SUPPORT_TRANSACTIONS
#endif

/*
 * Alternative SPI pin configuration (if parallel interface doesn't work):
 * Uncomment the following lines and comment out the parallel interface definitions above
 * 
 * #define TFT_MISO -1    // Not connected
 * #define TFT_MOSI 13    // SDA
 * #define TFT_SCLK 12    // SCL
 * #define TFT_CS   10    // Chip select
 * #define TFT_DC   11    // Data/Command
 * #define TFT_RST  1     // Reset
 * #define TFT_BL   14    // Backlight
 * 
 * #define SPI_FREQUENCY       40000000  // 40MHz
 * #define SPI_READ_FREQUENCY  20000000  // 20MHz
 */
