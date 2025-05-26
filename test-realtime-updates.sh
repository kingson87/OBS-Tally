#!/bin/bash
# Test script to demonstrate real-time WebSocket updates

echo "🧪 Testing Real-time WebSocket Updates for ESP32 Tally System"
echo "============================================================="
echo ""

# Test 1: Device Heartbeat
echo "1️⃣ Testing device heartbeat (should update lastSeen timestamp in real-time)..."
curl -X POST http://localhost:3005/api/heartbeat \
  -H "Content-Type: application/json" \
  -d '{"id": "tally-f09e9e1079e8", "status": "online", "uptime": 700000, "ip": "192.168.0.64"}' \
  -s > /dev/null
echo "✅ Heartbeat sent - check the web interface for real-time update!"
sleep 2

# Test 2: Device Configuration Update
echo ""
echo "2️⃣ Testing device configuration update (should update device name in real-time)..."
curl -X POST http://localhost:3005/api/esp32/devices/tally-f09e9e1079e8/config \
  -H "Content-Type: application/json" \
  -d '{"deviceName": "ESP32 Tally Camera 1 (Real-time Test)", "assignedSource": "Camera 1"}' \
  -s > /dev/null
echo "✅ Configuration updated - check the web interface for real-time update!"
sleep 2

# Test 3: Device Registration
echo ""
echo "3️⃣ Testing device registration (should appear in device list in real-time)..."
curl -X POST http://localhost:3005/api/esp32/register \
  -H "Content-Type: application/json" \
  -d '{"deviceId": "tally-realtime-test", "deviceName": "Real-time Test Device", "macAddress": "11:22:33:44:55:66", "ipAddress": "192.168.0.200", "firmware": "2.1.0"}' \
  -s > /dev/null
echo "✅ Device registered - check the web interface for new device!"
sleep 3

# Test 4: Device Deletion
echo ""
echo "4️⃣ Testing device deletion (should disappear from device list in real-time)..."
curl -X DELETE http://localhost:3005/api/esp32/devices/tally-realtime-test -s > /dev/null
echo "✅ Device deleted - check the web interface for device removal!"

echo ""
echo "🎉 All tests completed!"
echo ""
echo "📱 Open http://localhost:3005/settings.html to see the real-time ESP32 device updates"
echo "🔍 Look for:"
echo "   • Connection status indicator (🟢 Real-time Updates)"
echo "   • Instant device list updates without page refresh"
echo "   • Real-time timestamp updates"
echo "   • No more 2-second polling delays!"
