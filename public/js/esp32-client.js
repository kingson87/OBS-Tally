// ESP32 WebSocket client code

const socket = io();
let deviceId = localStorage.getItem('deviceId') || generateDeviceId();

// Generate a unique device ID if needed
function generateDeviceId() {
    const newId = 'esp32-' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('deviceId', newId);
    return newId;
}

// Register the ESP32 with the server
function registerDevice() {
    socket.emit('registerESP32', deviceId);
}

// Handle config updates from server
socket.on('deviceConfig', (config) => {
    console.log('Received device config:', config);
    
    if (config.name) {
        // Update the device name stored locally
        localStorage.setItem('deviceName', config.name);
        document.getElementById('device-name').textContent = config.name;
        
        // If using an OLED display or other interface, update it here
        updateDisplayWithName(config.name);
    }
    
    // Handle other configuration settings
});

// Update local display with new name
function updateDisplayWithName(name) {
    // Code to update OLED or other display with the new name
    console.log(`Updating display with name: ${name}`);
    // Example: send to ESP32 display
}

// Connect when the page loads
document.addEventListener('DOMContentLoaded', () => {
    registerDevice();
});
