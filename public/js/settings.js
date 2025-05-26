// Add or modify the device name update function

// Find the function that handles device name updates
function updateDeviceName(deviceId, newName) {
    // Send the update to the server
    socket.emit('updateDeviceName', { deviceId, newName });
}

// Make sure this is called when the name field changes
// For example, if you have a form for editing device names:
document.addEventListener('DOMContentLoaded', () => {
    // Set up device name input handlers
    const deviceList = document.getElementById('device-list') || document.getElementById('esp32-devices');
    
    if (deviceList) {
        deviceList.addEventListener('change', (event) => {
            const target = event.target;
            
            if (target.classList.contains('device-name-input')) {
                const deviceId = target.closest('.device-item').dataset.deviceId;
                updateDeviceName(deviceId, target.value);
            }
        });
    }
    
    // Load saved device ID from localStorage if it exists
    const savedDeviceId = localStorage.getItem('deviceId');
    if (savedDeviceId) {
        document.getElementById('deviceId').value = savedDeviceId;
    }
    
    // Update the ESP status display
    updateESPStatus();
});

// Modify the saveSettings function to store deviceId in localStorage
function saveSettings() {
    // Save device ID to localStorage for persistence
    const deviceId = document.getElementById('deviceId').value;
    if (deviceId) {
        localStorage.setItem('deviceId', deviceId);
    }
}

// Update the updateESPStatus function to use the new styling
function updateESPStatus() {
    // Example update (modify according to your actual implementation):
    socket.on('espStatus', function(status) {
        const espStatusIndicator = document.getElementById('espStatus');
        const espStatusText = document.getElementById('espStatusText');
        
        if (status === 'online') {
            espStatusIndicator.style.backgroundColor = 'green';
            espStatusText.textContent = 'Online';
        } else {
            espStatusIndicator.style.backgroundColor = 'red';
            espStatusText.textContent = 'Offline';
        }
    });
}