// (moved below app initialization)
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const OBSWebSocket = require('obs-websocket-js').default;
const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');
const QRCode = require('qrcode');
const multer = require('multer');
const dgram = require('dgram');
const FormData = require('form-data');

// Server configuration - allow port to be set via environment variable
const DEFAULT_PORT = 3005;
const PORT = process.env.PORT || DEFAULT_PORT;

// Check if port is available before starting server
function checkPort(port) {
    return new Promise((resolve, reject) => {
        const tester = net.createServer()
            .once('error', err => {
                if (err.code === 'EADDRINUSE') {
                    resolve(false);
                } else {
                    reject(err);
                }
            })
            .once('listening', () => {
                tester.once('close', () => resolve(true))
                    .close();
            })
            .listen(port);
    });
}

// Kill any process running on the specified port
async function killProcessOnPort(port) {
    const { exec } = require('child_process');
    return new Promise((resolve) => {
        // Find process using lsof and kill it
        exec(`lsof -ti:${port}`, (error, stdout) => {
            if (error || !stdout.trim()) {
                // No process found on port or error occurred
                resolve();
                return;
            }
            
            // Split PIDs by newlines and filter out empty lines
            const pids = stdout.trim().split('\n').filter(pid => pid.trim());
            
            if (pids.length === 0) {
                resolve();
                return;
            }
            
            console.log(`Found ${pids.length} process(es) running on port ${port}: ${pids.join(', ')}`);
            
            // Kill all processes
            let killedCount = 0;
            let totalPids = pids.length;
            
            pids.forEach(pid => {
                exec(`kill -9 ${pid.trim()}`, (killError) => {
                    killedCount++;
                    
                    if (killError) {
                        console.log(`Could not kill process ${pid}: ${killError.message}`);
                    } else {
                        console.log(`Successfully killed process ${pid} on port ${port}`);
                    }
                    
                    // Resolve when all processes have been attempted
                    if (killedCount === totalPids) {
                        resolve();
                    }
                });
            });
        });
    });
}

// Get local network IP address
function getLocalNetworkIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const interface of interfaces[name]) {
            // Skip loopback and non-IPv4 addresses
            if (!interface.internal && interface.family === 'IPv4') {
                // Prioritize common network interfaces
                if (name.toLowerCase().includes('wifi') || 
                    name.toLowerCase().includes('wireless') ||
                    name.toLowerCase().includes('ethernet') ||
                    name.toLowerCase().includes('en0') ||
                    name.toLowerCase().includes('en1')) {
                    return interface.address;
                }
            }
        }
    }
    
    // Fallback: return first non-internal IPv4 address
    for (const name of Object.keys(interfaces)) {
        for (const interface of interfaces[name]) {
            if (!interface.internal && interface.family === 'IPv4') {
                return interface.address;
            }
        }
    }
    
    return null;
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Get system info for logging and diagnostics
const systemInfo = {
  platform: process.platform,
  arch: process.arch,
  isAppleSilicon: process.arch === 'arm64' && process.platform === 'darwin',
  nodeVersion: process.version
};

console.log('System information:', systemInfo);

// Serve documentation files
app.get('/docs/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'docs', filename);
  
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // For markdown files, convert to HTML
    if (filename.endsWith('.md')) {
      res.set('Content-Type', 'text/plain'); // Show as plain text instead of downloading
      res.send(content);
    } else {
      res.sendFile(filePath);
    }
  } else {
    res.status(404).send('File not found');
  }
});

// OBS WebSocket setup
let obs = new OBSWebSocket();
let obsConfig = { address: 'ws://127.0.0.1:4455', password: '' };
const obsConfigPath = path.join(__dirname, 'obs-config.json');
let obsConnectionStatus = 'disconnected';
let obsConnectionError = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3; // Reduced number of attempts
const RECONNECT_DELAY = 10000; // Increased to 10 seconds
let reconnectTimer = null;

// Load OBS config from file
function loadOBSConfig() {
  try {
    if (fs.existsSync(obsConfigPath)) {
      const raw = fs.readFileSync(obsConfigPath, 'utf8');
      obsConfig = JSON.parse(raw);
      console.log('Loaded OBS config from file:', obsConfigPath);
    } else {
      // Create default config file if it doesn't exist
      fs.writeFileSync(obsConfigPath, JSON.stringify(obsConfig, null, 2));
      console.log('Created default OBS config file:', obsConfigPath);
    }
  } catch (e) {
    console.error('Error loading OBS config:', e.message);
    // Use defaults if file missing or invalid
    obsConfig = { address: 'ws://127.0.0.1:4455', password: '' };
  }
}
loadOBSConfig();

// ESP32 device management
let esp32Devices = {};
const esp32DevicesConfigPath = path.join(__dirname, 'esp32-devices.json');

// Load ESP32 devices from config file
function loadESP32Devices() {
  try {
    if (fs.existsSync(esp32DevicesConfigPath)) {
      const raw = fs.readFileSync(esp32DevicesConfigPath, 'utf8');
      esp32Devices = JSON.parse(raw);
      console.log('Loaded ESP32 devices from file:', esp32DevicesConfigPath);
    } else {
      // Create default config file if it doesn't exist
      esp32Devices = {};
      saveESP32Devices();
      console.log('Created default ESP32 devices file:', esp32DevicesConfigPath);
    }
  } catch (e) {
    console.error('Error loading ESP32 devices config:', e.message);
    // Use empty object if file is missing or invalid
    esp32Devices = {};
  }
}

// Save ESP32 devices to config file
function saveESP32Devices() {
  try {
    fs.writeFileSync(esp32DevicesConfigPath, JSON.stringify(esp32Devices, null, 2));
  } catch (e) {
    console.error('Error saving ESP32 devices config:', e.message);
  }
}

// Broadcast device update to all connected WebSocket clients
function broadcastDeviceUpdate(device, eventType = 'device-update') {
  const message = {
    type: eventType,
    device: {
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      ipAddress: device.ipAddress,
      assignedSource: device.assignedSource,
      status: device.status,
      lastHealthCheck: device.lastHealthCheck,
      responseTime: device.responseTime
    }
  };

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// Initialize ESP32 devices on startup
loadESP32Devices();

// Multi-source tally: status for each source
let tallySources = ['Camera 1']; // Default source list
let tallyStatus = {};
let currentScene = null;
let currentPreviewScene = null;

// Initialize tallyStatus for each source
function initTallyStatus() {
  tallySources.forEach(source => {
    tallyStatus[source] = { source, status: 'Idle' };
  });
}
initTallyStatus();

async function connectOBS() {
  try {
    // Clear any existing reconnect timer
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    
    updateObsConnectionStatus('connecting');
    console.log('Attempting to connect to OBS WebSocket at', obsConfig.address);
    await obs.connect(obsConfig.address, obsConfig.password ? { password: obsConfig.password } : undefined);
    console.log('\x1b[32m%s\x1b[0m', '✓ OBS WebSocket connection successful');
    updateObsConnectionStatus('connected');
    obsConnectionError = null;
    reconnectAttempts = 0;
    
    // Immediately broadcast status update to all clients
    broadcastTally();
  } catch (err) {
    console.error('\x1b[31m%s\x1b[0m', '✗ Failed to connect to OBS:', err.message);
    obsConnectionError = err.message;
    updateObsConnectionStatus('disconnected');
    
    // Increment reconnect attempts
    reconnectAttempts++;
    
    // Only retry up to MAX_RECONNECT_ATTEMPTS
    if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
      console.log(`Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${RECONNECT_DELAY/1000} seconds`);
      reconnectTimer = setTimeout(connectOBS, RECONNECT_DELAY);
    } else {
      console.log('Auto-reconnection stopped. Manual reconnect available.');
      // Still broadcast the current status to clients
      broadcastTally();
    }
  }
}

// Reconnect OBS with new config
async function reconnectOBS() {
  try {
    // Clear any existing reconnect timer
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    
    // Reset reconnect attempts
    reconnectAttempts = 0;
    
    if (obs && obs.disconnect) {
      await obs.disconnect();
    }
  } catch (err) {
    console.error('Error disconnecting from OBS:', err.message);
  }
  
  obs = new OBSWebSocket();
  setupOBSHandlers();
  await connectOBS();
}

function updateObsConnectionStatus(status) {
  obsConnectionStatus = status;
  broadcastObsStatus();
}

function broadcastObsStatus() {
  const msg = JSON.stringify({ 
    obsConnectionStatus,
    obsConnectionError
  });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function setupOBSHandlers() {
  obs.on('ConnectionClosed', () => {
    console.log('OBS WebSocket connection closed');
    obsConnectionError = 'Connection to OBS was closed';
    updateObsConnectionStatus('disconnected');
    
    // Clear any existing reconnect timer
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    
    // Try to reconnect after a delay
    reconnectTimer = setTimeout(connectOBS, 5000);
  });
  
  obs.on('ConnectionError', (err) => {
    console.error('OBS WebSocket connection error:', err.message);
    obsConnectionError = err.message || 'Connection error';
    updateObsConnectionStatus('disconnected');
  });

  obs.on('CurrentProgramSceneChanged', data => {
    currentScene = data.sceneName;
    console.log(`🎬 Program scene changed to: ${data.sceneName}`);
    updateTallyForSourcesThrottled(); // Use throttled version
  });
   obs.on('CurrentPreviewSceneChanged', data => {
    currentPreviewScene = data.sceneName;
    console.log(`🎬 Preview scene changed to: ${data.sceneName}`);
    updateTallyForSourcesThrottled(); // Use throttled version
  });

  // Listen for scene item visibility changes - crucial for real-time tally updates
  obs.on('SceneItemEnableStateChanged', data => {
    console.log(`🎬 Scene item visibility changed: ${data.sourceName} -> ${data.sceneItemEnabled ? 'visible' : 'hidden'}`);
    updateTallyForSourcesThrottled(); // Use throttled version
  });

  // Listen for scene item added/removed
  obs.on('SceneItemCreated', data => {
    console.log(`🎬 Scene item created: ${data.sourceName}`);
    updateTallyForSourcesThrottled(); // Use throttled version
  });

  obs.on('SceneItemRemoved', data => {
    console.log(`🎬 Scene item removed: ${data.sourceName}`);
    updateTallyForSourcesThrottled(); // Use throttled version
  });

  // Listen for source state changes
  obs.on('SourceActiveStateChanged', data => {
    console.log(`🎬 Source active state changed: ${data.sourceName} -> ${data.videoActive ? 'active' : 'inactive'}`);
    updateTallyForSourcesThrottled(); // Use throttled version
  });

  obs.on('Identified', async () => {
    try {
      const { currentProgramSceneName } = await obs.call('GetCurrentProgramScene');
      const { currentPreviewSceneName } = await obs.call('GetCurrentPreviewScene');
      currentScene = currentProgramSceneName;
      currentPreviewScene = currentPreviewSceneName;
      console.log(`🎬 Initial scenes - Program: ${currentScene}, Preview: ${currentPreviewScene}`);
      updateTallyForSources(); // Use direct version for initial load
    } catch (err) {
      console.error('Error getting current scene:', err.message);
    }
  });
}
setupOBSHandlers();

// Throttling mechanism to prevent excessive OBS API calls
let updateTallyTimeout = null;
let pendingUpdateCount = 0;
const UPDATE_THROTTLE_MS = 50; // Maximum 20 updates per second

// Helper to check if each source is visible in the current program or preview scene
async function updateTallyForSources() {
  if (!currentScene) return;
  
  try {
    // Get both program and preview scenes
    const { sceneItems: programItems } = await obs.call('GetSceneItemList', { sceneName: currentScene });
    let previewItems = [];
    if (currentPreviewScene && currentPreviewScene !== currentScene) {
      const previewRes = await obs.call('GetSceneItemList', { sceneName: currentPreviewScene });
      previewItems = previewRes.sceneItems;
    }
    
    // Track changes for performance monitoring
    const oldStatus = { ...tallyStatus };
    let changesDetected = 0;
    
    // Update status for each source
    for (const source of tallySources) {
      const inProgram = programItems.some(item => 
        item.sourceName === source && item.sceneItemEnabled
      );
      const inPreview = previewItems.some(item => 
        item.sourceName === source && item.sceneItemEnabled
      );
      
      let newStatus = 'Idle';
      if (inProgram) {
        newStatus = 'Live';
      } else if (inPreview) {
        newStatus = 'Preview';
      }
      
      // Create source status if it doesn't exist
      if (!tallyStatus[source]) {
        tallyStatus[source] = { source, status: newStatus };
        changesDetected++;
      } 
      // Update if status changed
      else if (tallyStatus[source].status !== newStatus) {
        changesDetected++;
        console.log(`⚡ Status Change: ${source} ${tallyStatus[source].status} → ${newStatus}`);
        tallyStatus[source].status = newStatus;
      }
    }
    
    // Only broadcast if there were changes
    if (changesDetected > 0) {
      console.log('📡 Broadcasting tally status updates...');
      broadcastTally();
    }
    
  } catch (err) {
    console.error('Error updating tally sources:', err.message);
  }
}

// Throttled version of updateTallyForSources to prevent excessive OBS API calls
function updateTallyForSourcesThrottled() {
  if (updateTallyTimeout) {
    clearTimeout(updateTallyTimeout);
  }
  
  updateTallyTimeout = setTimeout(() => {
    updateTallyForSources();
    updateTallyTimeout = null;
  }, UPDATE_THROTTLE_MS);
}

function broadcastTally() {
  const anyEspDeviceOnline = Object.values(esp32Devices).some(device => device.status === 'online');
  
  const statusUpdate = {
    type: 'tally-status',
    sources: tallySources,
    status: tallyStatus,
    obsConnectionStatus,
    obsConnectionError: obsConnectionStatus === 'disconnected' ? obsConnectionError : null,
    espStatus: anyEspDeviceOnline ? 'online' : 'offline',
    timestamp: new Date().toISOString()
  };
  
  // Broadcast to all WebSocket clients
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(statusUpdate));
    }
  });
  
  // Update ESP32 devices
  notifyESP32Devices();
}

// ESP32 notification debouncing to prevent rapid duplicate updates
const esp32NotificationDebounce = new Map();
const ESP32_DEBOUNCE_MS = 100; // Minimum 100ms between notifications to the same device

// Notify ESP32 devices of tally status changes
async function notifyESP32Devices() {
  if (Object.keys(esp32Devices).length === 0) return;
  
  // Performance tracking for ESP32 notifications
  const notificationStartTime = performance.now();
  const notificationPromises = [];
  let devicesNotified = 0;
  let devicesSkipped = 0;
  
  for (const deviceId of Object.keys(esp32Devices)) {
    const device = esp32Devices[deviceId];
    if (device.assignedSource && device.status === 'online' && device.ipAddress) {
      const sourceStatus = tallyStatus[device.assignedSource];
      if (sourceStatus) {
        const newStatus = sourceStatus.status;
        
        // Check if status actually changed
        if (device.lastNotifiedStatus !== newStatus) {
          // Check debounce timing
          const now = Date.now();
          const lastNotification = esp32NotificationDebounce.get(deviceId) || 0;
          
          if (now - lastNotification >= ESP32_DEBOUNCE_MS) {
            device.lastNotifiedStatus = newStatus;
            esp32NotificationDebounce.set(deviceId, now);
            devicesNotified++;
            
            console.log(`⚡ ESP32 Real-time Update: ${device.deviceName} (${deviceId}): ${device.assignedSource} -> ${newStatus}`);
            
            // Send HTTP POST notification to ESP32 device (non-blocking)
            const notificationPromise = sendTallyUpdateToESP32(device, newStatus)
              .then(result => {
                if (result.success) {
                  // Update last successful notification time
                  device.lastSuccessfulNotification = new Date().toISOString();
                }
                return result;
              })
              .catch(error => {
                console.error(`❌ Real-time ESP32 notification failed for ${deviceId}:`, error.message);
                // Mark device as potentially offline if multiple failures
                if (!device.consecutiveFailures) device.consecutiveFailures = 0;
                device.consecutiveFailures++;
                
                if (device.consecutiveFailures >= 3) {
                  console.warn(`⚠️ ESP32 ${deviceId} has ${device.consecutiveFailures} consecutive failures - may be offline`);
                  device.status = 'unreachable';
                }
                return { success: false, error: error.message };
              });
            
            notificationPromises.push(notificationPromise);
          } else {
            devicesSkipped++;
            console.log(`🚀 ESP32 notification skipped for ${deviceId} (debouncing: ${ESP32_DEBOUNCE_MS - (now - lastNotification)}ms remaining)`);
          }
        }
      }
    }
  }
  
  // Process all notifications in parallel for maximum speed
  if (notificationPromises.length > 0) {
    try {
      const results = await Promise.allSettled(notificationPromises);
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      const failed = results.length - successful;
      
      const notificationDuration = performance.now() - notificationStartTime;
      console.log(`⚡ PERFORMANCE: ESP32 notifications completed in ${notificationDuration.toFixed(2)}ms`);
      console.log(`📊 ESP32 Status: ${successful} successful, ${failed} failed, ${devicesSkipped} debounced`);
      
      // Reset consecutive failures for successful devices
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.success) {
          const deviceId = Object.keys(esp32Devices)[index];
          const device = esp32Devices[deviceId];
          if (device) {
            device.consecutiveFailures = 0;
            if (device.status === 'unreachable') {
              device.status = 'online';
              console.log(`✅ ESP32 ${deviceId} back online`);
            }
          }
        }
      });
      
    } catch (error) {
      console.error('Error in parallel ESP32 notifications:', error);
    }
  }
}

// Send tally update to ESP32 device via HTTP POST with enhanced error handling and performance
async function sendTallyUpdateToESP32(device, tallyStatus) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      deviceId: device.deviceId,
      status: tallyStatus,
      assignedSource: device.assignedSource,
      deviceName: device.deviceName, // Add device name to the payload
      obsConnected: obsConnectionStatus === 'connected',
      timestamp: new Date().toISOString()
    });
    
    const options = {
      hostname: device.ipAddress,
      port: 80,
      path: '/api/tally',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Connection': 'close', // Force connection close for ESP32 compatibility
        'User-Agent': 'OBS-Tally-Server/2.0'
      },
      timeout: 1000 // Reduced to 1 second for ultra-fast response
    };
    
    const startTime = performance.now();
    const req = http.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        const duration = performance.now() - startTime;
        
        if (res.statusCode === 200) {
          console.log(`⚡ ULTRA-FAST tally update sent to ESP32 ${device.deviceId}: ${tallyStatus} (${duration.toFixed(1)}ms)`);
          resolve({ success: true, response: responseData, duration: duration });
        } else {
          console.warn(`⚠️ ESP32 ${device.deviceId} responded with status ${res.statusCode}: ${responseData} (${duration.toFixed(1)}ms)`);
          resolve({ success: false, status: res.statusCode, response: responseData, duration: duration });
        }
      });
    });
    
    req.on('error', (error) => {
      const duration = performance.now() - startTime;
      console.error(`❌ Failed to send tally update to ESP32 ${device.deviceId} (${duration.toFixed(1)}ms):`, error.message);
      reject(error);
    });
    
    req.on('timeout', () => {
      const duration = performance.now() - startTime;
      console.warn(`⏰ Timeout sending tally update to ESP32 ${device.deviceId} (${duration.toFixed(1)}ms)`);
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    // Set socket timeout for faster failure detection
    req.setTimeout(1000, () => {
      console.warn(`🚫 Socket timeout for ESP32 ${device.deviceId}`);
      req.destroy();
    });
    
    // Write data and end request
    req.write(postData);
    req.end();
  });
}


// ESP32 device health monitoring
const ESP32_HEALTH_CHECK_INTERVAL = 30000; // Check every 30 seconds
let esp32HealthTimer = null;

// Function to monitor ESP32 device health and performance
async function monitorESP32Health() {
  const healthStartTime = performance.now();
  const healthChecks = [];
  
  for (const deviceId of Object.keys(esp32Devices)) {
    const device = esp32Devices[deviceId];
    if (device.ipAddress) {
      const healthCheck = checkESP32DeviceHealth(device);
      healthChecks.push(healthCheck);
    }
  }
  
  if (healthChecks.length > 0) {
    try {
      const results = await Promise.allSettled(healthChecks);
      const healthy = results.filter(r => r.status === 'fulfilled' && r.value.healthy).length;
      const unhealthy = results.length - healthy;
      
      const healthDuration = performance.now() - healthStartTime;
      console.log(`🏥 HEALTH CHECK: ${healthy} healthy, ${unhealthy} unhealthy ESP32 devices (${healthDuration.toFixed(1)}ms)`);
      
      // Broadcast health status to WebSocket clients
      const healthStatus = {
        type: 'esp32-health-status',
        timestamp: new Date().toISOString(),
        totalDevices: results.length,
        healthyDevices: healthy,
        unhealthyDevices: unhealthy,
        checkDuration: healthDuration
      };
      
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(healthStatus));
        }
      });
      
    } catch (error) {
      console.error('Error in ESP32 health monitoring:', error);
    }
  }
}

// Check individual ESP32 device health
async function checkESP32DeviceHealth(device) {
  return new Promise((resolve) => {
    const startTime = performance.now();
    const req = http.request({
      hostname: device.ipAddress,
      port: 80,
      path: '/api/device-info',
      method: 'GET',
      timeout: 2000,
      headers: {
        'Connection': 'close',
        'User-Agent': 'OBS-Tally-Health-Check/2.0'
      }
    }, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        const duration = performance.now() - startTime;
        const healthy = res.statusCode === 200;
        
        const previousStatus = device.status;
        if (healthy) {
          device.status = 'online';
          device.lastHealthCheck = new Date().toISOString();
          device.responseTime = duration;
          device.consecutiveFailures = 0;
        } else {
          device.consecutiveFailures = (device.consecutiveFailures || 0) + 1;
          if (device.consecutiveFailures >= 2) {
            device.status = 'unreachable';
          }
        }
        
        // Broadcast status change if status changed
        if (previousStatus !== device.status) {
          saveESP32Devices(); // Save changes to disk
          broadcastDeviceUpdate(device, 'device-status-update');
        }
        
        resolve({ healthy, duration, status: res.statusCode });
      });
    });
    
    req.on('error', (error) => {
      const duration = performance.now() - startTime;
      device.consecutiveFailures = (device.consecutiveFailures || 0) + 1;
      device.lastError = error.message;
      
      const previousStatus = device.status;
      if (device.consecutiveFailures >= 2) {
        device.status = 'offline';
      }
      
      // Broadcast status change if status changed
      if (previousStatus !== device.status) {
        saveESP32Devices(); // Save changes to disk
        broadcastDeviceUpdate(device, 'device-status-update');
      }
      
      resolve({ healthy: false, duration, error: error.message });
    });
    
    req.on('timeout', () => {
      const duration = performance.now() - startTime;
      device.consecutiveFailures = (device.consecutiveFailures || 0) + 1;
      device.lastError = 'Health check timeout';
      
      const previousStatus = device.status;
      if (device.consecutiveFailures >= 2) {
        device.status = 'timeout';
      }
      
      // Broadcast status change if status changed
      if (previousStatus !== device.status) {
        saveESP32Devices(); // Save changes to disk
        broadcastDeviceUpdate(device, 'device-status-update');
      }
      
      req.destroy();
      resolve({ healthy: false, duration, error: 'timeout' });
    });
    
    req.end();
  });
}

// Start ESP32 health monitoring
function startESP32HealthMonitoring() {
  if (esp32HealthTimer) {
    clearInterval(esp32HealthTimer);
  }
  
  esp32HealthTimer = setInterval(monitorESP32Health, ESP32_HEALTH_CHECK_INTERVAL);
  console.log('🏥 ESP32 health monitoring started');
}

// Stop ESP32 health monitoring
function stopESP32HealthMonitoring() {
  if (esp32HealthTimer) {
    clearInterval(esp32HealthTimer);
    esp32HealthTimer = null;
    console.log('🏥 ESP32 health monitoring stopped');
  }
}

// Add express middleware
const fileUpload = require('express-fileupload');
app.use(express.json());
app.use(fileUpload({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max file size
  abortOnLimit: true,
  useTempFiles: true,
  tempFileDir: path.join(__dirname, 'uploads', 'temp')
}));
app.get('/api/sources', (req, res) => {
  res.json({ sources: tallySources });
});
app.post('/api/sources', (req, res) => {
  const { sources } = req.body;
  if (Array.isArray(sources)) {
    tallySources = sources;
    initTallyStatus();
    updateTallyForSources();
    res.json({ success: true, sources: tallySources });
  } else {
    res.status(400).json({ success: false, error: 'Invalid sources' });
  }
});

// API to get/set OBS config
app.get('/api/obs-config', (req, res) => {
  res.json({ address: obsConfig.address, password: obsConfig.password ? '********' : '' });
});
app.post('/api/obs-config', async (req, res) => {
  const { address, password } = req.body;
  if (typeof address === 'string' && address.startsWith('ws://')) {
    obsConfig.address = address;
    if (typeof password === 'string') obsConfig.password = password;
    fs.writeFileSync(obsConfigPath, JSON.stringify(obsConfig, null, 2));
    await reconnectOBS();
    res.json({ success: true, address: obsConfig.address });
  } else {
    res.status(400).json({ success: false, error: 'Invalid address' });
  }
});

// API to test OBS connection
app.get('/api/test-obs', async (req, res) => {
  try {
    if (obsConnectionStatus === 'connected') {
      res.json({ success: true, status: 'connected' });
    } else {
      // Try to connect once
      try {
        updateObsConnectionStatus('connecting');
        await obs.connect(obsConfig.address, obsConfig.password ? { password: obsConfig.password } : undefined);
        updateObsConnectionStatus('connected');
        res.json({ success: true, status: 'connected' });
      } catch (err) {
        updateObsConnectionStatus('disconnected');
        res.json({ success: false, status: 'disconnected', error: err.message });
      }
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API to force reconnection
app.get('/api/reconnect', async (req, res) => {
  try {
    // Reset reconnect attempts
    reconnectAttempts = 0;
    await reconnectOBS();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// OBS Discovery API endpoint
app.post('/api/discover-obs', async (req, res) => {
  try {
    console.log('🔍 Starting OBS WebSocket discovery...');
    
    const discoveredInstances = [];
    const commonPorts = [4455, 4444]; // OBS WebSocket common ports
    const networks = getLocalNetworks();
    const maxConcurrentScans = 50; // Limit concurrent connections
    
    // Scan local networks
    const scanPromises = [];
    
    for (const network of networks) {
      for (let i = 1; i <= 254; i++) {
        const ip = `${network.base}.${i}`;
        
        // Skip our own IP
        if (ip === network.localIP) continue;
        
        for (const port of commonPorts) {
          scanPromises.push(scanOBSInstance(ip, port));
        }
      }
    }
    
    // Also check localhost
    for (const port of commonPorts) {
      scanPromises.push(scanOBSInstance('127.0.0.1', port));
      scanPromises.push(scanOBSInstance('localhost', port));
    }
    
    console.log(`📡 Scanning ${scanPromises.length} potential OBS WebSocket addresses...`);
    
    // Execute scans in batches to avoid overwhelming the network
    const batchSize = maxConcurrentScans;
    for (let i = 0; i < scanPromises.length; i += batchSize) {
      const batch = scanPromises.slice(i, i + batchSize);
      const results = await Promise.allSettled(batch);
      
      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          discoveredInstances.push(result.value);
        }
      });
      
      // Small delay between batches
      if (i + batchSize < scanPromises.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`✅ OBS discovery complete. Found ${discoveredInstances.length} instances`);
    
    res.json({
      success: true,
      instances: discoveredInstances,
      count: discoveredInstances.length,
      message: `Discovery complete. Found ${discoveredInstances.length} OBS instance(s)`
    });
    
  } catch (error) {
    console.error('OBS discovery error:', error);
    res.status(500).json({
      success: false,
      error: 'OBS discovery failed',
      message: error.message
    });
  }
});

// Helper function to get local network ranges
function getLocalNetworks() {
  const networks = [];
  const interfaces = os.networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip non-IPv4 and internal interfaces
      if (iface.family !== 'IPv4' || iface.internal) continue;
      
      const parts = iface.address.split('.');
      if (parts.length === 4) {
        networks.push({
          base: `${parts[0]}.${parts[1]}.${parts[2]}`,
          localIP: iface.address,
          interface: name
        });
      }
    }
  }
  
  return networks;
}

// Helper function to scan a single OBS instance
async function scanOBSInstance(ip, port) {
  return new Promise((resolve) => {
    const wsUrl = `ws://${ip}:${port}`;
    const timeout = 3000; // 3 second timeout
    
    try {
      const tempObs = new OBSWebSocket();
      
      // Set up timeout
      const timeoutId = setTimeout(() => {
        tempObs.disconnect();
        resolve(null);
      }, timeout);
      
      tempObs.connect(wsUrl, undefined, {
        rpcVersion: 1
      }).then(async () => {
        clearTimeout(timeoutId);
        
        try {
          // Get OBS version info
          const version = await tempObs.call('GetVersion');
          
          // Check if authentication is required
          const authRequired = false; // obs-websocket-js handles this automatically
          
          const instance = {
            ip,
            port,
            address: wsUrl,
            version: version.obsVersion || 'Unknown',
            websocketVersion: version.obsWebSocketVersion || 'Unknown',
            availableRequests: version.availableRequests?.length || 0,
            authRequired,
            status: 'available',
            responseTime: Date.now()
          };
          
          await tempObs.disconnect();
          resolve(instance);
          
        } catch (infoError) {
          // Still consider it a valid OBS instance even if we can't get info
          const instance = {
            ip,
            port,
            address: wsUrl,
            version: 'Unknown',
            websocketVersion: 'Unknown',
            availableRequests: 0,
            authRequired: infoError.message?.includes('authentication') || false,
            status: 'available',
            responseTime: Date.now(),
            error: infoError.message
          };
          
          await tempObs.disconnect();
          resolve(instance);
        }
        
      }).catch(() => {
        clearTimeout(timeoutId);
        resolve(null);
      });
      
    } catch (error) {
      resolve(null);
    }
  });
}

// Start the server
async function startServer() {
  try {
    // Check if port is available
    const isPortAvailable = await checkPort(PORT);
    
    if (!isPortAvailable) {
      console.log(`⚠️  Port ${PORT} is already in use. Attempting to free it...`);
      await killProcessOnPort(PORT);
      
      // Wait a moment for the port to be freed
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check again
      const isPortFreeNow = await checkPort(PORT);
      if (!isPortFreeNow) {
        console.error(`❌ Could not free port ${PORT}. Please manually stop any processes using this port.`);
        process.exit(1);
      }
    }
    
    // Start the HTTP server
    server.listen(PORT, () => {
      console.log('\x1b[32m%s\x1b[0m', `🚀 OBS Tally server running on http://localhost:${PORT}`);
      
      // Get and display local network IP
      const localIP = getLocalNetworkIP();
      if (localIP) {
        console.log('\x1b[36m%s\x1b[0m', `🌐 Network access: http://${localIP}:${PORT}`);
      }
      
      console.log('\x1b[33m%s\x1b[0m', '📱 Open the URL above in your browser to control the tally system');
      console.log('');
      
      // Initialize UDP discovery for ESP32 devices
      // initUDPDiscovery(); // TODO: Implement or remove if not needed
      
      // Start ESP32 health monitoring
      startESP32HealthMonitoring();
      
      // Connect to OBS
      connectOBS();
    });
    
    // Handle server errors
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is still in use. Try a different port or manually stop the conflicting process.`);
      } else {
        console.error('❌ Server error:', err.message);
      }
      process.exit(1);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server gracefully...');
  
  // Stop ESP32 health monitoring
  stopESP32HealthMonitoring();
  
  // Close UDP discovery server if it exists and is running
  if (discoveryServer) {
    try {
      // Check if socket is running before closing
      if (discoveryServer.address()) {
        discoveryServer.close(() => {
          console.log('UDP discovery server closed');
          discoveryServer = null;
        });
      } else {
        discoveryServer = null;
      }
    } catch (err) {
      console.warn('Error closing UDP server:', err.message);
      discoveryServer = null;
    }
  }
  
  // Close OBS connection
  if (obs && obsConnectionStatus === 'connected') {
    obs.disconnect();
  }
  
  // Close WebSocket connections
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ 
        type: 'server-shutdown', 
        message: 'Server is shutting down' 
      }));
      client.close();
    }
  });
  
  // Close HTTP server
  server.close(() => {
    console.log('Server stopped');
    process.exit(0);
  });
  
  // Force exit after 5 seconds if graceful shutdown fails
  setTimeout(() => {
    console.log('Force exiting...');
    process.exit(0);
  }, 5000);
});

// Start the server
startServer();
