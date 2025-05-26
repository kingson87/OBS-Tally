```javascript
const WebSocket = require('ws');

// ...existing code...

// Modify the device connection handler
wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`New connection from ${ip}`);
  
  // Set initial status as online when connection is established
  ws.isAlive = true;
  
  // Store the device in our devices map
  const deviceId = getDeviceId(req);
  if (deviceId) {
    devices.set(deviceId, { ws, status: 'online', lastSeen: Date.now() });
    broadcastDeviceStatus(deviceId, 'online');
    console.log(`Device ${deviceId} connected and marked as online`);
  }
  
  // Setup ping-pong for connection health check
  ws.on('pong', () => {
    ws.isAlive = true;
    if (deviceId) {
      // Update last seen timestamp and ensure status is online
      const device = devices.get(deviceId);
      if (device) {
        device.lastSeen = Date.now();
        if (device.status !== 'online') {
          device.status = 'online';
          broadcastDeviceStatus(deviceId, 'online');
          console.log(`Device ${deviceId} status updated to online`);
        }
      }
    }
  });
  
  // Handle disconnection
  ws.on('close', () => {
    if (deviceId) {
      console.log(`Device ${deviceId} disconnected`);
      devices.delete(deviceId);
      broadcastDeviceStatus(deviceId, 'offline');
    }
  });

  // ...existing code...
});

// Add a function to broadcast device status to all clients
function broadcastDeviceStatus(deviceId, status) {
  const statusUpdate = JSON.stringify({
    type: 'device-status',
    deviceId: deviceId,
    status: status
  });
  
  // Send to all connected clients
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(statusUpdate);
    }
  });
}

// Make sure we have a periodic check for stale connections
const interval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) {
      // Handle timeout for non-responsive clients
      return ws.terminate();
    }
    
    ws.isAlive = false;
    ws.ping();
  });
  
  // Check for devices that haven't responded in a while
  devices.forEach((device, deviceId) => {
    const now = Date.now();
    // If device hasn't been seen in 30 seconds, mark as offline
    if (now - device.lastSeen > 30000 && device.status !== 'offline') {
      device.status = 'offline';
      broadcastDeviceStatus(deviceId, 'offline');
      console.log(`Device ${deviceId} marked as offline due to inactivity`);
    }
  });
}, 10000);

// ...existing code...
```