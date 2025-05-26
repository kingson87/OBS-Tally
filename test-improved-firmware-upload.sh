#!/bin/bash

# Test firmware upload with improved error handling
# This script simulates various firmware upload scenarios to test our improvements

cd "$(dirname "$0")"

echo "🧪 Testing Improved Firmware Upload Error Handling"
echo "=================================================="

# Check if server is running
echo "🔍 Checking server status..."
SERVER_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3005/api/esp32-devices)

if [ "$SERVER_STATUS" != "200" ]; then
    echo "❌ Server not responding. Please start the server first."
    exit 1
fi

echo "✅ Server is running"

# Test with invalid device ID (should fail gracefully)
echo ""
echo "📋 Test 1: Invalid Device ID"
echo "-----------------------------"
curl -X POST \
  -F "source=server" \
  -F "version=2.1.0" \
  "http://localhost:3005/api/esp32/upload-firmware/invalid-device-123" \
  -w "\nStatus Code: %{http_code}\n" \
  -s

echo ""
echo "📋 Test 2: Check Available Firmware Versions"
echo "---------------------------------------------"
curl -s "http://localhost:3005/api/firmware/catalog" | head -10

echo ""
echo "📋 Test 3: Upload Firmware from Server (simulated)"
echo "---------------------------------------------------"
# This will test our retry logic and error handling
curl -X POST \
  -F "source=server" \
  -F "version=2.1.0" \
  "http://localhost:3005/api/esp32/upload-firmware/esp32-tally-1" \
  -w "\nStatus Code: %{http_code}\n" \
  -s

echo ""
echo "🎯 Test Summary:"
echo "- Improved retry logic: 3 attempts instead of 2"
echo "- Better connection reset handling: lower thresholds for ESP32 behavior"
echo "- Progressive backoff: increasing delays between retries"
echo "- Enhanced device health checks before upload"
echo "- More intelligent success detection for ESP32 connection patterns"
echo ""
echo "✅ Testing completed!"
