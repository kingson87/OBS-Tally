#!/bin/bash

# Script to compile the ESP32 firmware and upload it to the device
# Created: May 28, 2025

# Configuration
ESP32_IP="192.168.0.64"
ESP32_DIR="/Users/prince/Projects/OBS-Tally/ESP32/ESP32-1732S019"
FIRMWARE_DIR="/Users/prince/Projects/OBS-Tally/firmware"
VERSION="2.3.4"  # Updated version number for recording status fix
BUILD_DATE=$(date +"%b %d %Y %H:%M:%S")

echo "🔧 ESP32 Firmware Compilation and Upload Script"
echo "==============================================="
echo "Target ESP32: $ESP32_IP"
echo "Version: $VERSION"
echo "Build Date: $BUILD_DATE"
echo

# Step 1: Update version number in the file
echo "📝 Updating firmware version to $VERSION..."
sed -i '' "s/#define FIRMWARE_VERSION \".*\"/#define FIRMWARE_VERSION \"$VERSION\"/" "$ESP32_DIR/src/obs_tally_ultimate.cpp"

# Step 2: Update build flags in platformio.ini
echo "📝 Updating build flags in platformio.ini..."
sed -i '' "s/-DFIRMWARE_VERSION=\"\\\"[0-9\\.]*\\\"\"/-DFIRMWARE_VERSION=\"\\\"$VERSION\\\"\"/" "$ESP32_DIR/platformio.ini"

# Step 3: Compile firmware
echo "🔨 Compiling firmware..."
cd "$ESP32_DIR" || exit 1
platformio run -e obs_tally_ultimate

# Check if compilation was successful
if [ $? -ne 0 ]; then
    echo "❌ Compilation failed!"
    exit 1
fi

echo "✅ Compilation successful!"

# Step 4: Copy firmware to firmware directory
echo "📦 Preparing firmware file..."
FIRMWARE_FILE="$ESP32_DIR/.pio/build/obs_tally_ultimate/firmware.bin"
NEW_FIRMWARE_FILE="$FIRMWARE_DIR/obs_tally_v${VERSION}.bin"

if [ ! -f "$FIRMWARE_FILE" ]; then
    echo "❌ Firmware binary not found at $FIRMWARE_FILE!"
    exit 1
fi

cp "$FIRMWARE_FILE" "$NEW_FIRMWARE_FILE"
echo "✅ Firmware saved to $NEW_FIRMWARE_FILE"

# Step 5: Update info.json
cat > "$FIRMWARE_DIR/info.json" << EOL
{
  "latest": "$VERSION",
  "builds": [
    {
      "version": "$VERSION",
      "file": "obs_tally_v${VERSION}.bin",
      "date": "$(date +"%Y-%m-%d")",
      "notes": "Fixed recording status display on ESP32 device"
    }
  ]
}
EOL
echo "✅ Updated firmware info.json"

# Step 6: Upload firmware to ESP32 using OTA
echo "📤 Uploading firmware to ESP32 at $ESP32_IP using OTA..."
echo "This may take a minute or two. Please don't interrupt the process."

# Using PlatformIO OTA upload
platformio run -e obs_tally_ultimate --target upload

if [ $? -eq 0 ]; then
    echo "✅ Upload successful! The device will reboot automatically."
else
    echo "❌ OTA upload failed. Trying HTTP upload as fallback..."
    # Fallback to HTTP upload
    curl -X POST -F "firmware=@$NEW_FIRMWARE_FILE" "http://$ESP32_IP/api/update"
fi

echo
echo "✅ Upload request sent. Check the ESP32 device for update status."
echo "The device will reboot automatically if the update is successful."
echo
echo "📊 To verify the update, wait about 30 seconds and run:"
echo "curl http://$ESP32_IP/api/device-info"
echo
echo "🎬 Testing recording status after update:"
echo "curl -X POST -H \"Content-Type: application/json\" -d '{\"recording\":{\"active\":true}}' http://$ESP32_IP/api/tally"
