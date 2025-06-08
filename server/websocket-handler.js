const { Server } = require('socket.io');

let io = null;

// Initialize Socket.IO server
function initializeSocketIOServer(server) {
  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
  
  io.on('connection', (socket) => {
    console.log('New Socket.IO client connected:', socket.id);
    
    socket.on('message', (data) => {
      try {
        console.log('Received Socket.IO message:', data);
        
        // Handle client messages if needed
        if (data.type === 'ping') {
          socket.emit('message', { type: 'pong', timestamp: new Date().toISOString() });
        }
      } catch (error) {
        console.error('Error handling Socket.IO message:', error);
      }
    });
    
    socket.on('disconnect', () => {
      console.log('Socket.IO client disconnected:', socket.id);
    });
    
    socket.on('error', (error) => {
      console.error('Socket.IO error:', error);
    });
  });
  
  return io;
}

// Enhanced function to broadcast device status to all clients
function broadcastDeviceStatus(deviceId, status, additionalData = {}) {
  const statusUpdate = {
    type: 'device-status-update',
    deviceId: deviceId,
    status: status,
    timestamp: new Date().toISOString(),
    ...additionalData
  };
  
  console.log('Broadcasting device status:', deviceId, '->', status);
  
  if (io) {
    io.emit('device-status-update', statusUpdate);
  }
}

// Function to broadcast ESP32-specific connection status
function broadcastESP32Status(deviceId, status, details = {}) {
  const statusUpdate = {
    type: 'esp32-status',
    deviceId: deviceId,
    status: status,
    details: details,
    timestamp: new Date().toISOString()
  };
  
  console.log('Broadcasting ESP32 status:', deviceId, '->', status);
  
  if (io) {
    io.emit('esp32-status', statusUpdate);
  }
}

// Function to broadcast OBS-specific status updates
function broadcastOBSStatus(status, details = {}) {
  const statusUpdate = {
    type: 'obs-status',
    status: status,
    details: details,
    timestamp: new Date().toISOString()
  };
  
  console.log('Broadcasting OBS status:', status);
  
  if (io) {
    io.emit('obs-status', statusUpdate);
  }
}

// Export functions for use in main application
module.exports = {
  initializeSocketIOServer,
  broadcastDeviceStatus,
  broadcastESP32Status,
  broadcastOBSStatus
};