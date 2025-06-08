// ESP32 Device Management
let devices = {};

// Helper function to normalize device data structure
function normalizeDeviceData(device) {
    if (!device || typeof device !== 'object') {
        console.warn('Invalid device data received for normalization:', device);
        return null; // Or return a default empty structure
    }
    const baseName = device.deviceName || device.name || device.deviceId || 'Unknown Device';
    const baseIp = device.ipAddress || device.ip || 'Unknown';
    const baseSource = device.assignedSource || device.source || 'None';
    const baseStatus = device.status ? device.status.toLowerCase() : (typeof device.online === 'boolean' ? (device.online ? 'online' : 'offline') : 'unknown');
    
    return {
        ...device, // Spread original device first to keep any other properties
        deviceId: device.deviceId, // Ensure deviceId is present
        deviceName: baseName,
        name: baseName, // Alias for compatibility
        ipAddress: baseIp,
        ip: baseIp, // Alias for compatibility
        assignedSource: baseSource,
        source: baseSource, // Alias for compatibility
        status: baseStatus,
        // Preserve specific tally properties
        tallyState: device.tallyState || device.state || 'idle',
        // Timestamps are critical for online detection
        lastSeen: device.lastSeen || device.timestamp || null
    };
}

// Function to update the device name
function updateDeviceName(deviceId, newName) {
    console.log(`Updating device ${deviceId} with name: ${newName}`);
    
    fetch(`/api/esp32/update-device/${deviceId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deviceName: newName })
    })
    .then(async response => {
        const data = await response.json();
        
        if (!response.ok) {
            // Handle HTTP error responses
            const errorMsg = data.details || data.error || `HTTP ${response.status}: ${response.statusText}`;
            console.error('Device update failed:', { 
                status: response.status, 
                error: data.error,
                details: data.details,
                deviceId, 
                newName 
            });
            
            // Show user-friendly error message
            if (typeof showNotification === 'function') {
                showNotification(`Failed to update device: ${errorMsg}`, 'error');
            } else {
                alert(`Failed to update device: ${errorMsg}`);
            }
            return;
        }
        
        if (data.success) {
            console.log(`Device name updated successfully:`, data.device);
            
            // Update local device data with all data from the server response
            if (devices[deviceId]) {
                // Ensure we update with the full device object from the server
                if (data.device) {
                    devices[deviceId] = normalizeDeviceData(data.device);
                } else {
                    // Fallback: server only confirmed name change, update locally
                    const currentDevice = devices[deviceId] || { deviceId };
                    const updatedDevice = { ...currentDevice, deviceName: newName, name: newName };
                    devices[deviceId] = normalizeDeviceData(updatedDevice);
                }
            }
            
            // Show success message
            if (typeof showNotification === 'function') {
                showNotification(`Device updated successfully to "${newName}"`, 'success');
            }
            
            // Update the device list in the UI instead of reloading
            updateDeviceList();
        } else {
            // Handle API-level errors (when HTTP status is OK but success is false)
            const errorMsg = data.details || data.error || 'Unknown error occurred';
            console.error('API returned error:', data);
            
            if (typeof showNotification === 'function') {
                showNotification(`Failed to update device: ${errorMsg}`, 'error');
            } else {
                alert(`Failed to update device: ${errorMsg}`);
            }
        }
    })
    .catch(error => {
        console.error('Network error updating device name:', error);
        
        // Handle network errors
        if (typeof showNotification === 'function') {
            showNotification(`Network error: Failed to connect to server`, 'error');
        } else {
            alert(`Network error: Failed to connect to server`);
        }
    });
}

// Function to load and display ESP32 devices
function loadDevices() {
    fetch('/api/esp32/device-status')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Convert array to object keyed by deviceId for compatibility
                devices = {};
                (data.devices || []).forEach(rawDevice => {
                    const normalizedDevice = normalizeDeviceData(rawDevice);
                    if (normalizedDevice && normalizedDevice.deviceId) {
                        devices[normalizedDevice.deviceId] = normalizedDevice;
                    }
                });
                updateDeviceList();
            } else {
                showNoDevicesMessage();
            }
        })
        .catch(error => {
            console.error('Error loading devices:', error);
            showNoDevicesMessage();
        });
}

function updateDeviceList() {
    const deviceList = document.getElementById('deviceGrid');
    const noDevicesMessage = document.querySelector('.no-devices-message');
    
    if (!deviceList) return;
    
    if (!devices || Object.keys(devices).length === 0) {
        deviceList.innerHTML = '';
        if (noDevicesMessage) {
            noDevicesMessage.style.display = 'block';
        }
        return;
    }
    
    if (noDevicesMessage) {
        noDevicesMessage.style.display = 'none';
    }
    
    // Sort devices by name for consistent display
    const sortedDevices = Object.values(devices).sort((a, b) => {
        // deviceName is guaranteed by normalization
        const nameA = (a.deviceName || a.deviceId || '').toLowerCase();
        const nameB = (b.deviceName || b.deviceId || '').toLowerCase();
        return nameA.localeCompare(nameB);
    });
    
    deviceList.innerHTML = sortedDevices
        .map(device => {
            // Better handling of device status with timestamp check for more accurate online/offline detection
            const lastSeenTime = device.lastSeen ? new Date(device.lastSeen) : null;
            const isRecentlyActive = lastSeenTime && ((new Date() - lastSeenTime) < 30000); // Consider active if seen in last 30 seconds
            const isOnline = isRecentlyActive || device.online;
            const status = isOnline ? 'online' : 'offline';
            
            // Get the device name with fallbacks
            const deviceName = device.deviceName || device.name || device.deviceId;
            
            // Get IP address with fallbacks
            const ipAddress = device.ipAddress || device.ip || 'Unknown';
            
            // Get assigned source with fallbacks
            const assignedSource = device.assignedSource || device.source || 'None';
            
            // Get tally state with proper fallbacks
            const tallyState = device.tallyState || device.state || 'idle';
            
            // Calculate time since last seen
            const timeSinceLastSeen = lastSeenTime ? getTimeSinceLastSeen(lastSeenTime) : 'Never';
            
            // Create device card HTML matching the rendered structure
            return `
                <div class="device-card" data-device-id="${device.deviceId}">
                    <div class="device-header">
                        <div class="device-name">${deviceName}</div>
                        <div class="device-status-badge status-${status}">
                            ${status === 'online' ? 'Online' : 'Offline'}
                        </div>
                    </div>
                    
                    <div class="device-tally tally-${tallyState}">
                        ${formatTallyState(tallyState)} ${device.sourceName ? '- ' + device.sourceName : ''}
                    </div>
                    
                    <div class="device-info">
                        <p><strong>Device ID:</strong> ${device.deviceId}</p>
                        <p><strong>IP Address:</strong> ${ipAddress}</p>
                        <p><strong>MAC Address:</strong> ${device.mac || 'Unknown'}</p>
                        <p><strong>Last Seen:</strong> ${timeSinceLastSeen}</p>
                        <p><strong>Source:</strong> ${assignedSource !== 'None' ? assignedSource : 'None assigned'}</p>
                    </div>
                    
                    <div class="device-actions">
                        <button class="btn configure-device-btn" data-device-id="${device.deviceId}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="3"></circle>
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                            </svg>
                            Configure
                        </button>
                        <button class="btn btn-danger delete-device-btn" data-device-id="${device.deviceId}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                            Delete
                        </button>
                    </div>
                </div>
            `;
        }).join('');
}

function showNoDevicesMessage() {
    const deviceList = document.getElementById('deviceGrid');
    const noDevicesMessage = document.querySelector('.no-devices-message');
    
    if (deviceList) {
        deviceList.innerHTML = '';
    }
    if (noDevicesMessage) {
        noDevicesMessage.style.display = 'block';
    }
}

// Format time since last seen in human-readable format
function getTimeSinceLastSeen(lastSeenDate) {
    const now = new Date();
    const diffMs = now - lastSeenDate;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffSec < 5) {
        return 'Just now';
    } else if (diffSec < 60) {
        return `${diffSec} seconds ago`;
    } else if (diffMin < 60) {
        return `${diffMin} ${diffMin === 1 ? 'minute' : 'minutes'} ago`;
    } else if (diffHours < 24) {
        return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    } else {
        return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
    }
}

// Format tally state in a user-friendly way
function formatTallyState(state) {
    const stateMap = {
        'idle': 'Idle',
        'program': 'Program (Live)',
        'preview': 'Preview',
        'transition': 'Transition',
    };
    return stateMap[state] || 'Idle';
}

// Initialize device management when the page loads
document.addEventListener('DOMContentLoaded', () => {
    // Load initial device list
    loadDevices();
    
    // Set up interval to check device online status every 10 seconds
    const statusCheckInterval = setInterval(updateDeviceOnlineStatus, 10000);
    
    // Set up WebSocket listeners for real-time updates
    if (typeof socket !== 'undefined') {
        socket.on('device-update', (data) => {
            if (data.device && data.device.deviceId) {
                const deviceId = data.device.deviceId;
                const existingDevice = devices[deviceId] || {};
                const mergedDeviceData = { ...existingDevice, ...data.device };
                const normalized = normalizeDeviceData(mergedDeviceData);
                if (normalized) {
                    devices[deviceId] = normalized;
                    updateDeviceList();
                }
            } else if (data.deviceId && data.status) { // Handle simple status-only updates
                if (devices[data.deviceId]) {
                    devices[data.deviceId].status = data.status.toLowerCase();
                    devices[data.deviceId].online = data.status.toLowerCase() === 'online';
                    devices[data.deviceId].lastSeen = new Date().toISOString();
                    updateDeviceList();
                }
            }
        });
        
        // Handle device-updated events specifically
        socket.on('device-updated', (data) => {
            if (data.device && data.device.deviceId) {
                const deviceId = data.device.deviceId;
                const existingDevice = devices[deviceId] || {};
                const mergedDeviceData = { ...existingDevice, ...data.device };
                const normalized = normalizeDeviceData(mergedDeviceData);
                if (normalized) {
                    devices[deviceId] = normalized;
                    updateDeviceList();
                }
            }
        });
        
        // Add listener for tally status updates
        socket.on('tally-status', (data) => {
            console.log('Received tally status update:', data);
            let updated = false;
            
            // Handle individual device update format
            if (data && data.deviceId && devices[data.deviceId]) {
                const deviceId = data.deviceId;
                const existingDevice = devices[deviceId];
                const mergedDevice = {
                    ...existingDevice,
                    tallyState: data.state || 'idle',
                    sourceName: data.sourceName || null,
                    lastSeen: new Date().toISOString(),
                    online: true // If we get a tally update, the device is online
                };
                devices[deviceId] = normalizeDeviceData(mergedDevice);
                updated = true;
            } 
            // Handle bulk status updates format
            else if (data && data.deviceStatus) {
                Object.keys(data.deviceStatus).forEach(deviceId => {
                    if (devices[deviceId]) {
                        const existingDevice = devices[deviceId];
                        const updateData = data.deviceStatus[deviceId];
                        const mergedDevice = {
                            ...existingDevice,
                            tallyState: updateData.state || 'idle',
                            sourceName: updateData.sourceName || null,
                            lastSeen: new Date().toISOString(),
                            online: updateData.online
                        };
                        devices[deviceId] = normalizeDeviceData(mergedDevice);
                        updated = true;
                    }
                });
            }
            // Handle array format (for backward compatibility)
            else if (Array.isArray(data)) {
                data.forEach(item => {
                    if (item && item.deviceId && devices[item.deviceId]) {
                        const deviceId = item.deviceId;
                        const existingDevice = devices[deviceId];
                        const mergedDevice = {
                            ...existingDevice,
                            tallyState: item.state || 'idle',
                            sourceName: item.sourceName || null,
                            lastSeen: new Date().toISOString(),
                            online: true
                        };
                        devices[deviceId] = normalizeDeviceData(mergedDevice);
                        updated = true;
                    }
                });
            }
            
            // Update the UI only if needed
            if (updated) {
                console.log('Updating device list with new tally states');
                updateDeviceList();
            }
        });
        
        // Add handler for device heartbeats
        socket.on('device-heartbeat', (data) => {
            if (data && data.deviceId) {
                console.log('Received device heartbeat:', data.deviceId);
                // Update last seen time and ensure device is marked as online
                if (devices[data.deviceId]) {
                    const existingDevice = devices[data.deviceId];
                    const mergedDevice = {
                        ...existingDevice,
                        lastSeen: data.timestamp || new Date().toISOString(),
                        online: true
                    };
                    devices[data.deviceId] = normalizeDeviceData(mergedDevice);
                    updateDeviceList();
                }
            }
        });
    }
    
    // Set up device grid event handlers
    const deviceList = document.getElementById('deviceGrid');
    
    if (deviceList) {
        // Handle click events for configure and delete buttons
        deviceList.addEventListener('click', (event) => {
            const target = event.target;
            
            // Handle configure button clicks
            if (target.closest('.configure-device-btn')) {
                const deviceId = target.closest('.device-card').dataset.deviceId;
                console.log(`Configure device ${deviceId}`);
                openDeviceConfigModal(deviceId);
            }
            
            // Handle delete button clicks
            if (target.closest('.delete-device-btn')) {
                const deviceId = target.closest('.device-card').dataset.deviceId;
                console.log(`Delete device ${deviceId}`);
                if (confirm(`Are you sure you want to delete device ${deviceId}?`)) {
                    deleteDevice(deviceId);
                }
            }
        });
        
        // Handle device name edits - add later if needed
        deviceList.addEventListener('dblclick', (event) => {
            const target = event.target;
            
            // If user double-clicks on device name, make it editable
            if (target.closest('.device-name')) {
                const deviceName = target.closest('.device-name');
                const deviceId = target.closest('.device-card').dataset.deviceId;
                const currentName = deviceName.textContent;
                
                // Create an input for editing
                const input = document.createElement('input');
                input.type = 'text';
                input.value = currentName;
                input.className = 'device-name-input';
                
                // Replace the name with the input
                deviceName.innerHTML = '';
                deviceName.appendChild(input);
                input.focus();
                input.select();
                
                // Handle saving on enter or blur
                const saveDeviceName = () => {
                    const newName = input.value.trim();
                    if (newName && newName !== devices[deviceId]?.deviceName) {
                        updateDeviceName(deviceId, newName);
                    } else {
                        deviceName.textContent = currentName;
                    }
                };
                
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        saveDeviceName();
                        e.preventDefault();
                    } else if (e.key === 'Escape') {
                        deviceName.textContent = currentName;
                        e.preventDefault();
                    }
                });
                
                input.addEventListener('blur', saveDeviceName);
            }
        });
        
        deviceList.addEventListener('blur', (event) => {
            const target = event.target;
            
            if (target.classList.contains('device-name-input')) {
                clearTimeout(target.updateTimeout);
                const deviceItem = target.closest('.device-item');
                if (!deviceItem) return;
                
                const deviceId = deviceItem.dataset.deviceId;
                const newName = target.value.trim();
                
                // Only update if name is valid and has actually changed from the stored version
                if (deviceId && newName && newName !== (devices[deviceId]?.deviceName || '')) {
                    updateDeviceName(deviceId, newName);
                }
            }
        }, false); // Use bubbling phase (default, false) instead of capture
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
    // Save device ID to localStorage for persistence (controller device ID)
    const deviceIdInput = document.getElementById('deviceId');
    if (deviceIdInput) {
        const deviceIdValue = deviceIdInput.value;
        if (deviceIdValue) {
            localStorage.setItem('deviceId', deviceIdValue);
        }
    }
    // Add other settings saving logic here if needed
}

// Update the updateESPStatus function to use the new styling with CSS classes
function updateESPStatus() {
    if (typeof socket === 'undefined') return;
    
    // Using the CSS classes from the redesigned UI for consistency
    socket.on('espStatus', function(status) {
        const espStatusIndicator = document.getElementById('espStatus');
        const espStatusText = document.getElementById('espStatusText');
        
        if (!espStatusIndicator || !espStatusText) {
            console.warn('ESP status elements not found in the DOM');
            return;
        }
        
        if (status === 'online') {
            espStatusIndicator.className = 'status-indicator status-connected';
            espStatusText.textContent = 'Online';
            espStatusText.className = 'status-text status-text-online'; // Use class for color
            console.log('ESP32 service is online');
        } else {
            espStatusIndicator.className = 'status-indicator status-disconnected';
            espStatusText.textContent = 'Offline';
            espStatusText.className = 'status-text status-text-offline'; // Use class for color
            console.log('ESP32 service is offline');
        }
    });
    
    // Also listen for ESP32 device-specific events
    socket.on('esp32-status', function(data) {
        if (data && data.deviceId && devices[data.deviceId]) {
            console.log('ESP32 device status update:', data.deviceId, data.status);
            devices[data.deviceId].online = data.status === 'online';
            devices[data.deviceId].lastSeen = new Date().toISOString();
            updateDeviceList();
        }
    });
}

// Function to delete a device
function deleteDevice(deviceId) {
    console.log(`Deleting device ${deviceId}`);
    
    fetch(`/api/esp32/delete-device/${deviceId}`, {
        method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            console.log(`Device ${deviceId} deleted successfully`);
            
            // Remove device from local collection
            if (devices[deviceId]) {
                delete devices[deviceId];
                updateDeviceList();
            }
            
            // Show success message
            if (typeof showNotification === 'function') {
                showNotification(`Device ${deviceId} deleted successfully`, 'success');
            }
        } else {
            console.error(`Failed to delete device ${deviceId}:`, data.error);
            
            // Show error message
            if (typeof showNotification === 'function') {
                showNotification(`Failed to delete device: ${data.error || 'Unknown error'}`, 'error');
            }
        }
    })
    .catch(error => {
        console.error(`Network error deleting device ${deviceId}:`, error);
        
        // Show error message
        if (typeof showNotification === 'function') {
            showNotification(`Network error: Failed to connect to server`, 'error');
        }
    });
}

// Function to check and update device online status based on last heartbeat time
function updateDeviceOnlineStatus() {
    const now = new Date();
    let hasChanges = false;
    
    Object.keys(devices).forEach(deviceId => {
        const device = devices[deviceId];
        if (device.lastSeen) {
            const lastSeen = new Date(device.lastSeen);
            const timeSinceLastSeen = now - lastSeen;
            
            // If device hasn't been seen in 30 seconds, mark as offline
            if (timeSinceLastSeen > 30000 && device.online) {
                console.log(`Device ${deviceId} went offline (no heartbeat for ${Math.round(timeSinceLastSeen/1000)}s)`);
                device.online = false;
                hasChanges = true;
            }
        }
    });
    
    if (hasChanges) {
        updateDeviceList();
    }
}

// Device Configuration Modal Functions
let currentConfigDeviceId = null;

function openDeviceConfigModal(deviceId) {
    console.log(`Opening configuration modal for device: ${deviceId}`);
    currentConfigDeviceId = deviceId;
    
    const device = devices[deviceId];
    if (!device) {
        console.error(`Device ${deviceId} not found`);
        if (typeof showNotification === 'function') {
            showNotification(`Device ${deviceId} not found`, 'error');
        }
        return;
    }
    
  // Populate modal with device data
  document.getElementById('configDeviceName').value = device.deviceName || device.deviceId;
  document.getElementById('configAssignedSource').value = device.assignedSource || 'None';
  
  // Update status indicator
  const statusIndicator = document.getElementById('configStatusIndicator');
  const statusText = document.getElementById('configStatusText');
  const isOnline = device.online;
  
  statusIndicator.className = `status-indicator ${isOnline ? 'online' : 'offline'}`;
  statusText.textContent = isOnline ? 'Online' : 'Offline';
    
    // Load available sources and show modal
    loadAvailableSources(() => {
        document.getElementById('deviceConfigModal').style.display = 'flex';
    });
}

function closeDeviceConfigModal() {
    document.getElementById('deviceConfigModal').style.display = 'none';
    currentConfigDeviceId = null;
}

function loadAvailableSources(callback) {
    fetch('/api/obs/all-sources')
        .then(response => response.json())
        .then(data => {
            const select = document.getElementById('configAssignedSource');
            const currentValue = select.value;
            
            // Clear existing options except "None"
            select.innerHTML = '<option value="None">None</option>';
            
            if (data.success && data.sources) {
                data.sources.forEach(source => {
                    const option = document.createElement('option');
                    option.value = source.name;
                    option.textContent = source.name;
                    select.appendChild(option);
                });
                
                // Restore selected value
                select.value = currentValue;
            }
            
            if (callback) callback();
        })
        .catch(error => {
            console.error('Error loading sources:', error);
            if (typeof showNotification === 'function') {
                showNotification('Failed to load OBS sources', 'error');
            }
            if (callback) callback();
        });
}

function saveDeviceConfiguration() {
    if (!currentConfigDeviceId) {
        console.error('No device selected for configuration');
        return;
    }
    
  const deviceName = document.getElementById('configDeviceName').value.trim();
  const assignedSource = document.getElementById('configAssignedSource').value;
  
  if (!deviceName) {
    if (typeof showNotification === 'function') {
      showNotification('Device name cannot be empty', 'error');
    }
    return;
  }
  
  console.log(`Saving configuration for device ${currentConfigDeviceId}:`, {
    deviceName,
    assignedSource
  });
  
  // Prepare update data
  const updateData = {
    deviceName: deviceName
  };
    
    // Only include assignedSource if it's not "None"
    if (assignedSource && assignedSource !== 'None') {
        updateData.assignedSource = assignedSource;
    }
    
    // Send update request
    fetch(`/api/esp32/update-device/${currentConfigDeviceId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData)
    })
    .then(async response => {
        const data = await response.json();
        
        if (!response.ok) {
            const errorMsg = data.details || data.error || `HTTP ${response.status}: ${response.statusText}`;
            console.error('Device configuration update failed:', { 
                status: response.status, 
                error: data.error,
                details: data.details,
                deviceId: currentConfigDeviceId,
                updateData
            });
            
            if (typeof showNotification === 'function') {
                showNotification(`Failed to update device: ${errorMsg}`, 'error');
            }
            return;
        }
        
        console.log(`Device ${currentConfigDeviceId} configuration updated successfully`);
        
    // Update local device data
    if (devices[currentConfigDeviceId]) {
      devices[currentConfigDeviceId].deviceName = deviceName;
      if (assignedSource && assignedSource !== 'None') {
        devices[currentConfigDeviceId].assignedSource = assignedSource;
      } else {
        devices[currentConfigDeviceId].assignedSource = 'None';
      }
      updateDeviceList();
    }
        
        // Show success message
        if (typeof showNotification === 'function') {
            showNotification(`Device configuration updated successfully`, 'success');
        }
        
        // Close modal
        closeDeviceConfigModal();
        
        // Reload devices to get fresh data from server
        setTimeout(() => {
            loadDevices();
        }, 1000);
        
    })
    .catch(error => {
        console.error(`Network error updating device ${currentConfigDeviceId}:`, error);
        
        if (typeof showNotification === 'function') {
            showNotification(`Network error: Failed to connect to server`, 'error');
        }
    });
}

// Close modal when clicking outside
document.addEventListener('click', (event) => {
    const modal = document.getElementById('deviceConfigModal');
    if (event.target === modal) {
        closeDeviceConfigModal();
    }
});

// Close modal on Escape key
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        const modal = document.getElementById('deviceConfigModal');
        if (modal && modal.style.display === 'flex') {
            closeDeviceConfigModal();
        }
    }
});