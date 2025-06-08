// Device Manager JavaScript
let devices = {};
let sources = [];
let socket;
let selectedDeviceId = null;

// Initialize when DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // Connect to WebSocket server
    initializeWebSocket();
    
    // Load initial device list
    loadDevices();
    
    // Load OBS sources for device configuration
    loadSources();
    
    // Set up event listeners
    document.getElementById('refreshDevicesBtn').addEventListener('click', loadDevices);
    document.getElementById('discoverBtn').addEventListener('click', discoverDevices);
    document.getElementById('addDeviceBtn').addEventListener('click', showAddDeviceForm);
    document.getElementById('registerDeviceBtn').addEventListener('click', registerDevice);
    document.getElementById('saveDeviceConfigBtn').addEventListener('click', saveDeviceConfig);
    document.getElementById('resetDeviceBtn').addEventListener('click', confirmResetDevice);
    document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

    // Set up device tabs
    setupTabNavigation();
});

// Initialize WebSocket connection
function initializeWebSocket() {
    if (typeof io !== 'undefined') {
        socket = io();
        
        // Add catch-all event listener for debugging
        socket.onAny((eventName, ...args) => {
            console.log('🔍 [DEBUG] WebSocket event received:', eventName, args);
        });
        
        socket.on('connect', () => {
            console.log('🔍 [DEBUG] Connected to server via WebSocket');
            showNotification('Connected to tally server', 'success');
        });
        
        socket.on('disconnect', () => {
            console.log('🔍 [DEBUG] Disconnected from server');
            showNotification('Disconnected from tally server', 'error');
        });
        
        // Handle OBS connection status updates
        socket.on('message', (data) => {
            console.log('🔍 [DEBUG] Raw message received:', data);
            try {
                // If data is already an object, use it directly, otherwise try to parse it
                const message = typeof data === 'string' ? JSON.parse(data) : data;
                
                // Check if this is an OBS connection status message
                if (message.obsConnectionStatus) {
                    console.log('OBS connection status changed:', message.obsConnectionStatus);
                    
                    // If OBS just connected, reload the sources
                    if (message.obsConnectionStatus === 'connected') {
                        console.log('OBS connected, reloading sources...');
                        loadSources();
                    }
                }
            } catch (err) {
                console.error('Error handling WebSocket message:', err);
            }
        });
        
        // Handle device updates from WebSocket
        socket.on('device-update', (data) => {
            if (data.device && data.device.deviceId) {
                updateDeviceInList(data.device);
            }
        });
        
        // Handle device heartbeats
        socket.on('device-heartbeat', (data) => {
            if (data.deviceId && devices[data.deviceId]) {
                devices[data.deviceId].online = true;
                devices[data.deviceId].lastSeen = new Date().toISOString();
                updateDeviceList();
            }
        });
        
        // Handle bulk device status updates
        socket.on('device-status-update', (data) => {
            if (data && data.devices) {
                Object.keys(data.devices).forEach(deviceId => {
                    if (devices[deviceId]) {
                        devices[deviceId].online = data.devices[deviceId].online;
                        devices[deviceId].lastSeen = data.devices[deviceId].lastSeen;
                    }
                });
                updateDeviceList();
            }
        });
        
        // Handle tally status updates
        socket.on('tally-status', (data) => {
            console.log('🔍 [DEBUG] Tally status update received:', data);
            console.log('🔍 [DEBUG] Current devices object:', devices);
            console.log('🔍 [DEBUG] Has data.deviceStatus?', !!data?.deviceStatus);
            console.log('🔍 [DEBUG] deviceStatus keys:', data?.deviceStatus ? Object.keys(data.deviceStatus) : 'N/A');
            
            if (data && data.deviceStatus) {
                console.log('🔍 [DEBUG] Processing deviceStatus updates...');
                Object.keys(data.deviceStatus).forEach(deviceId => {
                    if (devices[deviceId]) {
                        const oldState = devices[deviceId].tallyState;
                        const newState = data.deviceStatus[deviceId].state || 'idle';
                        console.log(`🔍 [DEBUG] Device ${deviceId}: ${oldState} -> ${newState}`);
                        
                        devices[deviceId].tallyState = newState;
                        devices[deviceId].sourceName = data.deviceStatus[deviceId].sourceName;
                        devices[deviceId].lastSeen = new Date().toISOString();
                        devices[deviceId].online = data.deviceStatus[deviceId].online;
                    } else {
                        console.log(`🔍 [DEBUG] Device ${deviceId} not found in local devices object`);
                    }
                });
                updateDeviceList();
            } else if (data && data.deviceId && devices[data.deviceId]) {
                console.log('🔍 [DEBUG] Processing single device update...');
                const oldState = devices[data.deviceId].tallyState;
                const newState = data.state || 'idle';
                console.log(`🔍 [DEBUG] Device ${data.deviceId}: ${oldState} -> ${newState}`);
                
                devices[data.deviceId].tallyState = newState;
                devices[data.deviceId].sourceName = data.sourceName;
                devices[data.deviceId].lastSeen = new Date().toISOString();
                devices[data.deviceId].online = true;
                updateDeviceList();
            }
        });
    } else {
        console.error('Socket.IO is not loaded. WebSocket functionality will not work.');
    }
}

// Load devices from the server
function loadDevices() {
    fetch('/api/esp32/device-status')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Convert array to object keyed by deviceId
                devices = {};
                (data.devices || []).forEach(device => {
                    // Normalize device data
                    devices[device.deviceId] = normalizeDeviceData(device);
                });
                updateDeviceList();
            } else {
                showEmptyDeviceList();
                console.error('Failed to load devices:', data.error || 'Unknown error');
            }
        })
        .catch(error => {
            console.error('Error loading devices:', error);
            showEmptyDeviceList();
            showNotification('Failed to load devices: Network error', 'error');
        });
}

// Helper function to normalize device data
function normalizeDeviceData(device) {
    if (!device || typeof device !== 'object') {
        console.warn('Invalid device data received for normalization:', device);
        return null;
    }
    
    const baseName = device.deviceName || device.name || device.deviceId || 'Unknown Device';
    const baseIp = device.ipAddress || device.ip || 'Unknown';
    const baseSource = device.assignedSource || device.source || 'None';
    const baseStatus = device.status ? device.status.toLowerCase() : 
                      (typeof device.online === 'boolean' ? (device.online ? 'online' : 'offline') : 'unknown');
    
    return {
        ...device,
        deviceId: device.deviceId,
        deviceName: baseName,
        name: baseName, // Alias for compatibility
        ipAddress: baseIp,
        ip: baseIp, // Alias for compatibility
        assignedSource: baseSource,
        source: baseSource, // Alias for compatibility
        status: baseStatus,
        tallyState: device.tallyState || device.state || 'idle',
        lastSeen: device.lastSeen || device.timestamp || null,
        online: baseStatus === 'online' || device.online === true
    };
}

// Update device list in the UI
function updateDeviceList() {
    const deviceGrid = document.getElementById('deviceGrid');
    
    if (!deviceGrid) return;
    
    if (!devices || Object.keys(devices).length === 0) {
        showEmptyDeviceList();
        return;
    }
    
    // Sort devices by name
    const sortedDevices = Object.values(devices).sort((a, b) => {
        const nameA = (a.deviceName || '').toLowerCase();
        const nameB = (b.deviceName || '').toLowerCase();
        return nameA.localeCompare(nameB);
    });
    
    deviceGrid.innerHTML = sortedDevices
        .map(device => {
            // Check if device is online based on recent activity
            const lastSeenTime = device.lastSeen ? new Date(device.lastSeen) : null;
            const isRecentlyActive = lastSeenTime && ((new Date() - lastSeenTime) < 30000); // 30 seconds threshold
            const isOnline = isRecentlyActive || device.online;
            const status = isOnline ? 'online' : 'offline';
            
            // Format last seen time
            const timeSinceLastSeen = lastSeenTime ? getTimeSinceLastSeen(lastSeenTime) : 'Never';
            
            // Get tally state and normalize it for consistent display
            const tallyState = (device.tallyState || 'idle').toLowerCase();
            console.log(`Device ${device.deviceName} tally state: ${device.tallyState} (normalized: ${tallyState})`);
            
            return `
                <div class="device-card" data-device-id="${device.deviceId}">
                    <div class="device-header">
                        <div class="device-name">${device.deviceName}</div>
                        <div class="device-status-badge status-${status}">
                            ${status === 'online' ? 'Online' : 'Offline'}
                        </div>
                    </div>
                    
                    <div class="device-tally tally-${tallyState}">
                        ${formatTallyState(tallyState)} ${device.sourceName ? '- ' + device.sourceName : ''}
                    </div>
                    
                    <div class="device-info">
                        <p><strong>Device ID:</strong> ${device.deviceId}</p>
                        <p><strong>IP Address:</strong> ${device.ipAddress}</p>
                        <p><strong>MAC Address:</strong> ${device.mac || 'Unknown'}</p>
                        <p><strong>Last Seen:</strong> ${timeSinceLastSeen}</p>
                        <p><strong>Source:</strong> ${device.assignedSource !== 'None' ? device.assignedSource : 'None assigned'}</p>
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
        })
        .join('');
    
    // Add event listeners for device actions
    addDeviceEventListeners();
}

// Show empty device list message
function showEmptyDeviceList() {
    const deviceGrid = document.getElementById('deviceGrid');
    
    if (deviceGrid) {
        deviceGrid.innerHTML = `
            <div style="text-align: center; color: var(--text-secondary); grid-column: 1 / -1; padding: 40px 0;">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5; margin-bottom: 10px;">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                </svg>
                <p>No devices registered</p>
                <p style="font-size: 0.9em; opacity: 0.7; margin-top: 10px;">Use auto-discover button or register a device manually</p>
            </div>
        `;
    }
}

// Update a single device in the list
function updateDeviceInList(deviceData) {
    if (!deviceData || !deviceData.deviceId) return;
    
    const deviceId = deviceData.deviceId;
    const existingDevice = devices[deviceId] || {};
    const mergedDevice = { ...existingDevice, ...deviceData };
    devices[deviceId] = normalizeDeviceData(mergedDevice);
    
    updateDeviceList();
}

// Format time since last seen
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
    // Normalize state to lowercase for case-insensitive comparison
    const normalizedState = (state || '').toLowerCase();
    
    const stateMap = {
        'idle': 'Idle',
        'program': 'Program (Live)',
        'live': 'Program (Live)',    // Handle 'Live' status from server
        'preview': 'Preview',
        'transition': 'Transition',
    };
    return stateMap[normalizedState] || 'Idle';
}

// Add event listeners to device buttons
function addDeviceEventListeners() {
    // Configure button
    const configButtons = document.querySelectorAll('.configure-device-btn');
    configButtons.forEach(button => {
        button.addEventListener('click', function() {
            const deviceId = this.getAttribute('data-device-id');
            configureDevice(deviceId);
        });
    });
    
    // Delete button
    const deleteButtons = document.querySelectorAll('.delete-device-btn');
    deleteButtons.forEach(button => {
        button.addEventListener('click', function() {
            const deviceId = this.getAttribute('data-device-id');
            if (confirm(`Are you sure you want to delete device ${deviceId}?`)) {
                deleteDevice(deviceId);
            }
        });
    });
}

// Auto-discover devices on the network
function discoverDevices() {
    const statusEl = document.getElementById('discoveryStatus');
    statusEl.textContent = 'Scanning for devices...';

    fetch('/api/esp32/discover', { method: 'POST' })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                statusEl.textContent = `${data.devicesFound || 0} devices found.`;
                loadDevices(); // Refresh the device list
                showNotification(`Discovered ${data.devicesFound || 0} ESP32 devices`, 'success');
            } else {
                statusEl.textContent = `Error: ${data.error || 'Unknown error'}`;
                showNotification('Failed to discover devices', 'error');
            }
        })
        .catch(error => {
            console.error('Error discovering devices:', error);
            statusEl.textContent = 'Error: Network error while discovering devices';
            showNotification('Network error while discovering devices', 'error');
        });
}

// Show add device form
function showAddDeviceForm() {
    // The form is always visible in this implementation
    // Just scroll to the form
    const registrationSection = document.querySelectorAll('.settings-card')[1];
    registrationSection.scrollIntoView({ behavior: 'smooth' });
}

// Register a new device manually
function registerDevice() {
    const deviceId = document.getElementById('deviceId').value.trim();
    const deviceName = document.getElementById('deviceName').value.trim();
    const deviceIp = document.getElementById('deviceIp').value.trim();
    
    if (!deviceId) {
        showNotification('Device ID is required', 'error');
        return;
    }
    
    const deviceData = {
        deviceId: deviceId,
        deviceName: deviceName || deviceId,
    };
    
    if (deviceIp) {
        deviceData.ipAddress = deviceIp;
    }
    
    fetch('/api/esp32/devices', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(deviceData)
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification('Device registered successfully', 'success');
                loadDevices(); // Refresh device list
                
                // Clear form
                document.getElementById('deviceId').value = '';
                document.getElementById('deviceName').value = '';
                document.getElementById('deviceIp').value = '';
            } else {
                showNotification(`Failed to register device: ${data.error || 'Unknown error'}`, 'error');
            }
        })
        .catch(error => {
            console.error('Error registering device:', error);
            showNotification('Network error while registering device', 'error');
        });
}

// Configure a device (open modal with device settings)
function configureDevice(deviceId) {
    const device = devices[deviceId];
    if (!device) {
        showNotification('Device not found', 'error');
        return;
    }
    
    selectedDeviceId = deviceId;
    
    // Fill the modal with device info
    document.getElementById('configDeviceName').value = device.deviceName || '';
    document.getElementById('configDeviceId').textContent = device.deviceId;
    document.getElementById('configDeviceIp').textContent = device.ipAddress || 'Unknown';
    document.getElementById('configDeviceMac').textContent = device.mac || 'Unknown';
    document.getElementById('configDeviceLastSeen').textContent = 
        device.lastSeen ? getTimeSinceLastSeen(new Date(device.lastSeen)) : 'Never';
    
    // Set selected source
    const sourceSelect = document.getElementById('configSourceSelect');
    if (sourceSelect) {
        for (let i = 0; i < sourceSelect.options.length; i++) {
            if (sourceSelect.options[i].value === device.assignedSource) {
                sourceSelect.selectedIndex = i;
                break;
            }
        }
    }
    

    
    // Reset tabs to default
    const tabs = document.querySelectorAll('.device-tab');
    tabs.forEach(tab => tab.classList.remove('active'));
    document.querySelector('[data-tab="device-info"]').classList.add('active');
    
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(content => content.classList.remove('active'));
    document.getElementById('device-info').classList.add('active');
    
    // Show the modal
    const modal = document.getElementById('configureModal');
    modal.style.display = 'flex';
}

// Save device configuration
function saveDeviceConfig() {
    if (!selectedDeviceId) {
        showNotification('No device selected', 'error');
        return;
    }
    
    const deviceName = document.getElementById('configDeviceName').value.trim();
    const assignedSource = document.getElementById('configSourceSelect').value;
    
    // Get settings from active tab
    const activeTab = document.querySelector('.device-tab.active').getAttribute('data-tab');
    let updateData = {
        deviceName: deviceName
    };
    
    if (assignedSource) {
        updateData.assignedSource = assignedSource;
        
        // Check if this source is from OBS but might not be in the monitored sources list
        fetch('/api/sources')
            .then(response => response.json())
            .then(data => {
                if (Array.isArray(data.sources) && !data.sources.includes(assignedSource)) {
                    console.log(`Source "${assignedSource}" not found in monitored sources list, but will be added automatically`);
                    showNotification(`Note: Source "${assignedSource}" will be added to monitored sources`, 'info', 5000);
                }
            })
            .catch(err => console.error('Error checking sources:', err));
    }
    
    // If settings tab is active, get custom device settings
    if (activeTab === 'settings') {
        const wifiSsid = document.getElementById('deviceWifiSsid').value.trim();
        const wifiPassword = document.getElementById('deviceWifiPassword').value;
        const serverAddress = document.getElementById('deviceServerAddress').value.trim();
        
        if (wifiSsid) updateData.wifiSsid = wifiSsid;
        if (wifiPassword) updateData.wifiPassword = wifiPassword;
        if (serverAddress) updateData.serverAddress = serverAddress;
    }
    
    fetch(`/api/esp32/update-device/${selectedDeviceId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateData)
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                if (data.device) {
                    updateDeviceInList(data.device);
                }
                showNotification('Device updated successfully', 'success');
                closeModal('configureModal');
            } else {
                showNotification(`Failed to update device: ${data.error || 'Unknown error'}`, 'error');
            }
        })
        .catch(error => {
            console.error('Error updating device:', error);
            showNotification('Network error while updating device', 'error');
        });
}

// Delete a device
function deleteDevice(deviceId) {
    fetch(`/api/esp32/devices/${deviceId}`, {
        method: 'DELETE'
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                delete devices[deviceId];
                updateDeviceList();
                showNotification('Device deleted successfully', 'success');
            } else {
                showNotification(`Failed to delete device: ${data.error || 'Unknown error'}`, 'error');
            }
        })
        .catch(error => {
            console.error('Error deleting device:', error);
            showNotification('Network error while deleting device', 'error');
        });
}

// Reset a device
function confirmResetDevice() {
    if (!selectedDeviceId) {
        showNotification('No device selected', 'error');
        return;
    }
    
    if (confirm('Are you sure you want to reset this device? This will restart the device and may interrupt any active connections.')) {
        const device = devices[selectedDeviceId];
        
        if (!device || !device.ipAddress || device.ipAddress === 'Unknown') {
            showNotification('Cannot reset device with unknown IP address', 'error');
            return;
        }
        
        fetch(`/api/esp32/reset-device/${selectedDeviceId}`, {
            method: 'POST'
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    showNotification('Device reset command sent', 'success');
                    closeModal('configureModal');
                } else {
                    showNotification(`Failed to reset device: ${data.error || 'Unknown error'}`, 'error');
                }
            })
            .catch(error => {
                console.error('Error resetting device:', error);
                showNotification('Network error while resetting device', 'error');
            });
    }
}

// Load available OBS sources
function loadSources() {
    // First try to get the real sources from OBS
    fetch('/api/obs/all-sources')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.sources && data.sources.length > 0) {
                console.log('Loaded actual sources from OBS:', data.sources.length);
                sources = data.sources || [];
                updateSourceDropdown();
            } else {
                // Fall back to the configured sources if OBS sources can't be loaded
                console.log('Could not load OBS sources, falling back to configured sources');
                fetch('/api/sources')
                    .then(response => response.json())
                    .then(fallbackData => {
                        if (fallbackData.sources) {
                            sources = fallbackData.sources.map(name => ({ name })) || [];
                            updateSourceDropdown();
                        }
                    })
                    .catch(fallbackError => {
                        console.error('Error loading fallback sources:', fallbackError);
                    });
            }
        })
        .catch(error => {
            console.error('Error loading sources from OBS:', error);
            // Also try the fallback
            fetch('/api/sources')
                .then(response => response.json())
                .then(fallbackData => {
                    if (fallbackData.sources) {
                        sources = fallbackData.sources.map(name => ({ name })) || [];
                        updateSourceDropdown();
                    }
                })
                .catch(fallbackError => {
                    console.error('Error loading fallback sources:', fallbackError);
                });
        });
}

// Update source dropdown in the configure modal
function updateSourceDropdown() {
    const sourceSelect = document.getElementById('configSourceSelect');
    
    if (sourceSelect) {
        // Keep the "No source" option
        sourceSelect.innerHTML = '<option value="">No source (Idle)</option>';
        
        // Add all available sources
        sources.forEach(source => {
            const option = document.createElement('option');
            option.value = source.name;
            option.textContent = source.name;
            sourceSelect.appendChild(option);
        });
    }
}

// Set up tab navigation
function setupTabNavigation() {
    const tabs = document.querySelectorAll('.device-tab');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const tabId = this.getAttribute('data-tab');
            
            // Deactivate all tabs
            tabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            // Activate selected tab
            this.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        });
    });
}

// Close a modal
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.style.display = 'none';
    selectedDeviceId = null;
}

// Show notification
function showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    const notificationText = notification.querySelector('.notification-text');
    
    notification.className = 'notification notification-' + type;
    notificationText.textContent = message;
    
    notification.classList.add('show');
    
    // Auto-hide after 5 seconds
    setTimeout(hideNotification, 5000);
}

// Hide notification
function hideNotification() {
    const notification = document.getElementById('notification');
    notification.classList.remove('show');
}

// Toggle dark/light theme
function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    
    // Save preference to localStorage
    if (document.body.classList.contains('dark-mode')) {
        localStorage.setItem('theme', 'dark');
    } else {
        localStorage.setItem('theme', 'light');
    }
}

// Apply saved theme on load
(function applyTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
    }
})();
