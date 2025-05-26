#!/bin/bash

# Test script to update the device name of a specific ESP32 device

# Get the device ID from command line or use the default one
DEVICE_ID=${1:-"tally-f09e9e1079e8"}
NEW_NAME=${2:-"Tally-${RANDOM}"}

echo "Updating device name for $DEVICE_ID to: $NEW_NAME"

# Send the device name update request
curl -X POST http://localhost:3000/api/esp32/devices/$DEVICE_ID/config \
  -H "Content-Type: application/json" \
  -d "{\"deviceName\": \"$NEW_NAME\"}"

echo -e "\n\nVerify the device name was updated on server:"
curl -s http://localhost:3000/api/esp32/devices | grep -A 3 "\"deviceId\": \"$DEVICE_ID\""

echo -e "\n\nNow check the ESP32 device display or serial console to verify the name was updated."
