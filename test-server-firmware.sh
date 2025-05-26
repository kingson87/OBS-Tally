#!/bin/bash
# Test the server firmware upload functionality

# Set variables
DEVICE_ID="test-device-1"
FIRMWARE_VERSION="2.1.0"

# Create a test form data to simulate the API request with server firmware
echo "Testing server firmware upload API..."
echo "Device ID: $DEVICE_ID"
echo "Firmware Version: $FIRMWARE_VERSION"

# Create the multipart form data with curl
curl -X POST \
  -F "source=server" \
  -F "version=$FIRMWARE_VERSION" \
  "http://localhost:3005/api/esp32/upload-firmware/$DEVICE_ID" \
  -v

echo -e "\n\nTest completed!"
