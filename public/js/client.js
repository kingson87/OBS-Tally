// ...existing code...

// Add or modify the WebSocket message handler
socket.onmessage = function(event) {
  const data = JSON.parse(event.data);
  
  // Handle device status updates
  if (data.type === 'device-status') {
    updateDeviceStatus(data.deviceId, data.status);
    console.log(`Device ${data.deviceId} status: ${data.status}`);
  }
  
  // Handle other message types
  // ...existing code...
};

// Add this function to update device status in the UI
function updateDeviceStatus(deviceId, status) {
  const deviceElement = document.querySelector(`[data-device-id="${deviceId}"]`);
  
  if (deviceElement) {
    // Remove old status classes
    deviceElement.classList.remove('online', 'offline');
    
    // Add new status class
    deviceElement.classList.add(status);
    
    // Update status text
    const statusElement = deviceElement.querySelector('.device-status');
    if (statusElement) {
      statusElement.textContent = status.charAt(0).toUpperCase() + status.slice(1);
      statusElement.className = `device-status ${status}`;
    }
  }
}

// Optional: Add function to request device statuses when page loads
function requestDeviceStatuses() {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'get-device-statuses'
    }));
  }
}

// Call when page loads
window.addEventListener('load', () => {
  // Wait for socket connection to be established
  setTimeout(requestDeviceStatuses, 1000);
});

// ...existing code...