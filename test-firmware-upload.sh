#!/bin/bash

# Test script for ESP32 firmware upload

cd "$(dirname "$0")"

echo "🔧 ESP32 Firmware Upload Test Tool"
echo "=================================="

if [ $# -lt 2 ]; then
    echo "Usage: $0 <device-id> <firmware-file.bin>"
    echo "Example: $0 esp32-tally-1 ./uploads/obs_tally_update.bin"
    exit 1
fi

DEVICE_ID=$1
FIRMWARE_FILE=$2

# Check if device exists
echo "🔎 Checking if device exists..."
DEVICE_CHECK=$(curl -s http://localhost:3005/api/esp32-devices | grep -c "\"$DEVICE_ID\"")

if [ "$DEVICE_CHECK" -eq 0 ]; then
    echo "❌ Device not found: $DEVICE_ID"
    exit 1
fi

# Check if firmware file exists
if [ ! -f "$FIRMWARE_FILE" ]; then
    echo "❌ Firmware file not found: $FIRMWARE_FILE"
    exit 1
fi

echo "📤 Uploading firmware to device $DEVICE_ID..."
echo "📄 Firmware file: $FIRMWARE_FILE ($(du -h "$FIRMWARE_FILE" | cut -f1))"

curl -X POST \
  -F "firmware=@$FIRMWARE_FILE" \
  "http://localhost:3005/api/esp32/upload-firmware/$DEVICE_ID"

echo ""
echo "✅ Upload request completed. Check the server logs for results."
