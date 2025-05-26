const WebSocket = require('ws');

let wss = null;

// Initialize WebSocket server
function initializeWebSocketServer(server) {
  wss = new WebSocket.Server({ server });
  
  wss.on('connection', (ws) => {
    console.log('New WebSocket client connected');
    
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        console.log('Received WebSocket message:', data);
        
        // Handle client messages if needed
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    });
    
    ws.on('close', () => {
      console.log('WebSocket client disconnected');
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });
  
  return wss;
}

// Enhanced function to broadcast device status to all clients
function broadcastDeviceStatus(deviceId, status, additionalData = {}) {
  const statusUpdate = JSON.stringify({
    type: 'device-status-update',
    deviceId: deviceId,
    status: status,
    timestamp: new Date().toISOString(),
    ...additionalData
  });
  
  console.log('Broadcasting device status:', deviceId, '->', status);
  
  if (wss) {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(statusUpdate);
      }
    });
  }
}

// Enhanced function to broadcast firmware update progress
function broadcastFirmwareProgress(deviceId, stage, progress = null, message = null, error = null) {
  const progressUpdate = JSON.stringify({
    type: 'firmware-progress',
    deviceId: deviceId,
    stage: stage,
    progress: progress,
    message: message,
    error: error,
    timestamp: new Date().toISOString(),
    retry: stage === 'retrying'
  });
  
  console.log('Broadcasting firmware progress:', deviceId, '->', stage, progress ? `(${progress}%)` : '', message || '');
  
  if (wss) {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(progressUpdate);
      }
    });
  }
}

// Function to broadcast ESP32-specific connection status
function broadcastESP32Status(deviceId, status, details = {}) {
  const statusUpdate = JSON.stringify({
    type: 'esp32-status',
    deviceId: deviceId,
    status: status,
    details: details,
    timestamp: new Date().toISOString()
  });
  
  console.log('Broadcasting ESP32 status:', deviceId, '->', status);
  
  if (wss) {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(statusUpdate);
      }
    });
  }
}

// Function to broadcast OBS-specific status updates
function broadcastOBSStatus(status, details = {}) {
  const statusUpdate = JSON.stringify({
    type: 'obs-status',
    status: status,
    details: details,
    timestamp: new Date().toISOString()
  });
  
  console.log('Broadcasting OBS status:', status);
  
  if (wss) {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(statusUpdate);
      }
    });
  }
}

// Export functions for use in main application
module.exports = {
  initializeWebSocketServer,
  broadcastDeviceStatus,
  broadcastFirmwareProgress,
  broadcastESP32Status,
  broadcastOBSStatus
};