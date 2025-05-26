#!/bin/bash
# Complete firmware management test script

# Set variables
SERVER_URL="http://localhost:3005"
DEVICE_ID="test-device-1" # Make sure this matches an existing device in your setup

echo "OBS Tally Firmware Management Test"
echo "=================================="

# Test 1: Get available firmware
echo -e "\n1. Testing firmware listing API..."
FIRMWARE_LIST=$(curl -s "$SERVER_URL/api/esp32/available-firmware")
echo "$FIRMWARE_LIST" | grep -q "success"
if [ $? -eq 0 ]; then
  echo "✅ Successfully retrieved firmware list"
  # Get the first firmware version
  FIRMWARE_VERSION=$(echo "$FIRMWARE_LIST" | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "   Latest firmware version: $FIRMWARE_VERSION"
else
  echo "❌ Failed to get firmware list"
  exit 1
fi

# Test 2: Get firmware info for a specific device
echo -e "\n2. Testing device firmware info API..."
curl -s "$SERVER_URL/api/esp32/firmware-info/$DEVICE_ID" | grep -q "success"
if [ $? -eq 0 ]; then
  echo "✅ Successfully retrieved device firmware info"
else
  echo "❌ Failed to get device firmware info (device may not be connected)"
fi

# Test 3: Test firmware download
echo -e "\n3. Testing firmware download API..."
curl -s -I "$SERVER_URL/api/esp32/firmware/$FIRMWARE_VERSION" | grep -q "200 OK"
if [ $? -eq 0 ]; then
  echo "✅ Firmware download API is working"
else
  echo "❌ Failed to download firmware"
fi

echo -e "\nTests completed!"
