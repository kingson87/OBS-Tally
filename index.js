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

// Check for fetch availability (Node.js 18+ has built-in fetch)
let fetch;
if (typeof globalThis.fetch === 'undefined') {
  try {
    // Try to use node-fetch for older Node.js versions
    fetch = require('node-fetch');
    console.log('Using node-fetch for HTTP requests');
  } catch (err) {
    console.warn('⚠️  node-fetch not available and no built-in fetch found');
    console.warn('Some features may not work. Consider upgrading to Node.js 18+ or install node-fetch:');
    console.warn('npm install node-fetch');
    
    // Fallback to using http module for fetch-like requests
    fetch = async (url, options = {}) => {
      return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const requestOptions = {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method: options.method || 'GET',
          headers: options.headers || {},
          timeout: options.timeout || 5000
        };

        const req = http.request(requestOptions, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              statusText: res.statusMessage,
              json: () => Promise.resolve(JSON.parse(data)),
              text: () => Promise.resolve(data)
            });
          });
        });

        req.on('error', reject);
        req.on('timeout', () => reject(new Error('Request timeout')));
        
        if (options.body) {
          req.write(options.body);
        }
        req.end();
      });
    };
  }
} else {
  fetch = globalThis.fetch;
  console.log('Using built-in fetch for HTTP requests');
}

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

// Import and initialize enhanced WebSocket handler
const { initializeWebSocketServer, broadcastDeviceStatus, broadcastFirmwareProgress, broadcastESP32Status } = require('./server/websocket-handler');
const wss = initializeWebSocketServer(server);

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

// API endpoint for system diagnostics and platform detection
app.get('/api/system-info', (req, res) => {
  const localIP = getLocalNetworkIP();
  const serverURL = localIP ? `http://${localIP}:${PORT}` : null;
  
  const info = {
    ...systemInfo,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
    obsConnectionStatus,
    network: {
      localIP,
      serverURL,
      port: PORT
    }
  };
  res.json(info);
});

// API endpoint for network connection info
app.get('/api/network-info', (req, res) => {
  const localIP = getLocalNetworkIP();
  const serverURL = localIP ? `http://${localIP}:${PORT}` : null;
  
  res.json({
    localIP,
    serverURL,
    port: PORT,
    available: !!localIP
  });
});

// API endpoint to generate QR code for mobile connection
app.get('/api/qr-code', async (req, res) => {
  try {
    const localIP = getLocalNetworkIP();
    
    if (!localIP) {
      return res.status(400).json({ 
        error: 'No network connection available',
        message: 'Could not detect local network IP address'
      });
    }
    
    const serverURL = `http://${localIP}:${PORT}`;
    const qrCodeDataURL = await QRCode.toDataURL(serverURL, {
      width: 256,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    res.json({
      qrCode: qrCodeDataURL,
      serverURL,
      localIP,
      port: PORT
    });
  } catch (error) {
    console.error('QR Code generation error:', error);
    res.status(500).json({ 
      error: 'Failed to generate QR code',
      message: error.message 
    });
  }
});

// API endpoint to shutdown the server
app.post('/api/shutdown', (req, res) => {
  console.log('Shutdown request received');
  res.json({ success: true, message: 'Server shutting down...' });
  
  // Give response time to send
  setTimeout(() => {
    console.log('Shutting down server gracefully...');
    
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
  }, 100);
});

// ESP32 Device Management
let esp32Devices = {}; // Store connected ESP32 devices
const esp32ConfigPath = path.join(__dirname, 'esp32-devices.json');

// Auto-discovery functionality
let discoveryServer = null;
const discoveredDevices = new Map(); // Temporary storage for discovered devices

// Load ESP32 devices from file
function loadESP32Devices() {
  try {
    if (fs.existsSync(esp32ConfigPath)) {
      const raw = fs.readFileSync(esp32ConfigPath, 'utf8');
      esp32Devices = JSON.parse(raw);
      console.log('Loaded ESP32 devices from file:', Object.keys(esp32Devices).length);
    }
  } catch (e) {
    console.error('Error loading ESP32 devices:', e.message);
    esp32Devices = {};
  }
}

// Save ESP32 devices to file
function saveESP32Devices() {
  try {
    fs.writeFileSync(esp32ConfigPath, JSON.stringify(esp32Devices, null, 2));
  } catch (e) {
    console.error('Error saving ESP32 devices:', e.message);
  }
}

loadESP32Devices();
// Broadcast initial status after devices are loaded
broadcastTally();

// API endpoints for firmware management
app.get('/api/esp32/firmware-info', async (req, res) => {
  try {
    const deviceList = Object.values(esp32Devices);
    const devices = [];
    let onlineDevices = 0;
    
    // Process each device in parallel for efficiency
    const devicePromises = deviceList.map(async (device) => {
      try {
        // Only attempt to get info from devices with an IP address
        if (!device.ipAddress) {
          return {
            deviceId: device.deviceId,
            deviceName: device.deviceName || device.deviceId,
            ipAddress: 'unknown',
            status: 'offline',
            error: 'No IP address available'
          };
        }
        
        // Request firmware info from device
        const response = await fetch(`http://${device.ipAddress}/api/firmware/info`, {
          timeout: 5000
        });
        
        if (response.ok) {
          const firmwareInfo = await response.json();
          onlineDevices++;
          
          return {
            deviceId: device.deviceId,
            deviceName: device.deviceName || device.deviceId,
            ipAddress: device.ipAddress,
            status: 'success',
            firmwareInfo
          };
        } else {
          return {
            deviceId: device.deviceId,
            deviceName: device.deviceName || device.deviceId,
            ipAddress: device.ipAddress,
            status: 'error',
            error: `HTTP ${response.status}: ${response.statusText}`
          };
        }
      } catch (error) {
        return {
          deviceId: device.deviceId,
          deviceName: device.deviceName || device.deviceId,
          ipAddress: device.ipAddress || 'unknown',
          status: 'offline',
          error: error.message
        };
      }
    });
    
    const results = await Promise.allSettled(devicePromises);
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        devices.push(result.value);
      }
    });
    
    res.json({
      success: true,
      deviceCount: devices.length,
      onlineDevices,
      devices
    });
  } catch (error) {
    console.error('Error getting firmware info:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get available firmware files from the server
app.get('/api/esp32/available-firmware', async (req, res) => {
  try {
    // Check if firmware catalog exists
    const catalogPath = path.join(__dirname, 'server', 'firmware-catalog.js');
    if (!fs.existsSync(catalogPath)) {
      return res.json({
        success: false,
        error: 'Firmware catalog not found',
        firmwareList: []
      });
    }
    
    const firmwareCatalog = require('./server/firmware-catalog');
    const firmwareList = await firmwareCatalog.listAvailableFirmware();
    
    res.json(firmwareList);
  } catch (error) {
    console.error('Error listing available firmware:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      firmwareList: []
    });
  }
});

// Get firmware info for a specific device
app.get('/api/esp32/firmware-info/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const device = esp32Devices[deviceId];
    
    if (!device) {
      return res.status(404).json({ 
        success: false, 
        error: 'Device not found' 
      });
    }
    
    if (!device.ipAddress) {
      return res.status(400).json({ 
        success: false, 
        error: 'Device has no IP address' 
      });
    }
    
    try {
      const response = await fetch(`http://${device.ipAddress}/api/firmware/info`, {
        timeout: 5000
      });
      
      if (response.ok) {
        const firmwareInfo = await response.json();
        res.json({
          success: true,
          deviceId: device.deviceId,
          deviceName: device.deviceName || device.deviceId,
          firmwareInfo
        });
      } else {
        res.status(response.status).json({ 
          success: false, 
          error: `HTTP ${response.status}: ${response.statusText}` 
        });
      }
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: `Failed to communicate with device: ${error.message}` 
      });
    }
  } catch (error) {
    console.error('Error getting device firmware info:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Erase old firmware from a specific device
app.post('/api/esp32/erase-old-firmware/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const device = esp32Devices[deviceId];
    
    if (!device) {
      return res.status(404).json({ 
        success: false, 
        error: 'Device not found' 
      });
    }
    
    if (!device.ipAddress) {
      return res.status(400).json({ 
        success: false, 
        error: 'Device has no IP address' 
      });
    }
    
    try {
      const response = await fetch(`http://${device.ipAddress}/api/firmware/erase-old`, {
        method: 'POST',
        timeout: 10000
      });
      
      if (response.ok) {
        const result = await response.json();
        res.json({
          success: true,
          deviceId: device.deviceId,
          deviceName: device.deviceName || device.deviceId,
          message: result.message || 'Old firmware erased successfully'
        });
      } else {
        res.status(response.status).json({ 
          success: false, 
          error: `HTTP ${response.status}: ${response.statusText}` 
        });
      }
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: `Failed to communicate with device: ${error.message}` 
      });
    }
  } catch (error) {
    console.error('Error erasing old firmware:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Erase old firmware from all online devices
app.post('/api/esp32/erase-old-firmware-all', async (req, res) => {
  try {
    const deviceList = Object.values(esp32Devices).filter(d => d.status === 'online' && d.ipAddress);
    
    if (deviceList.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'No online devices found' 
      });
    }
    
    const results = [];
    let successCount = 0;
    let errorCount = 0;
    
    // Process each device sequentially to avoid overwhelming them
    for (const device of deviceList) {
      try {
        const response = await fetch(`http://${device.ipAddress}/api/firmware/erase-old`, {
          method: 'POST',
          timeout: 10000
        });
        
        if (response.ok) {
          const result = await response.json();
          results.push({
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            status: 'success',
            message: result.message || 'Old firmware erased successfully'
          });
          successCount++;
        } else {
          results.push({
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            status: 'error',
            error: `HTTP ${response.status}: ${response.statusText}`
          });
          errorCount++;
        }
      } catch (error) {
        results.push({
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          status: 'error',
          error: error.message
        });
        errorCount++;
      }
    }
    
    res.json({
      success: successCount > 0,
      totalDevices: deviceList.length,
      successCount,
      errorCount,
      results
    });
  } catch (error) {
    console.error('Error erasing all firmware:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Update the firmware upload code section with proper ESP32 web update handling
app.post('/api/esp32/upload-firmware/:deviceId', async (req, res) => {
  const deviceId = req.params.deviceId;
  const source = req.body?.source || 'local';
  
  try {
    const device = esp32Devices[deviceId];
    
    if (!device) {
      return res.status(404).json({
        success: false,
        error: `Device ${deviceId} not found`
      });
    }
    
    if (!device.ipAddress) {
      return res.status(400).json({
        success: false,
        error: 'Device has no IP address'
      });
    }
    
    // Broadcast firmware update start status
    broadcastDeviceUpdate(device, 'device-firmware-uploading');
    
    // Validate firmware file size and type
    let firmwareData;
    let firmwareFilename;
    
    if (source === 'server') {
      const version = req.body?.version;
      if (!version) {
        return res.status(400).json({
          success: false,
          error: 'No firmware version specified'
        });
      }
      
      // Get firmware from catalog with validation
      try {
        const catalogPath = path.join(__dirname, 'server', 'firmware-catalog.js');
        if (!fs.existsSync(catalogPath)) {
          return res.status(404).json({
            success: false,
            error: 'Firmware catalog not found'
          });
        }
        
        const firmwareCatalog = require('./server/firmware-catalog');
        const result = await firmwareCatalog.getFirmwareFile(version);
        
        if (!result.success) {
          return res.status(404).json({
            success: false,
            error: `Firmware version ${version} not found`
          });
        }
        
        firmwareData = fs.readFileSync(result.firmware.path);
        firmwareFilename = result.firmware.filename;
      } catch (catalogError) {
        return res.status(500).json({
          success: false,
          error: `Error accessing firmware catalog: ${catalogError.message}`
        });
      }
      
      // Validate firmware size (max 4MB for ESP32)
      if (firmwareData.length > 4 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          error: 'Firmware file too large (max 4MB)'
        });
      }
    } else {
      // Handle file upload via express-fileupload
      if (!req.files || !req.files.firmware) {
        return res.status(400).json({
          success: false,
          error: 'No firmware file was uploaded'
        });
      }
      
      const uploadedFile = req.files.firmware;
      
      // Validate file extension and size
      if (!uploadedFile.name.endsWith('.bin')) {
        return res.status(400).json({
          success: false,
          error: 'Invalid firmware file. Only .bin files are supported'
        });
      }
      
      if (uploadedFile.size > 4 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          error: 'Firmware file too large (max 4MB)'
        });
      }
      
      firmwareData = uploadedFile.data;
      firmwareFilename = uploadedFile.name;
    }
    
    console.log(`📤 Uploading firmware to ${device.deviceName} (${deviceId}): ${firmwareFilename} (${firmwareData.length} bytes)`);
    
    // Use improved firmware upload function
    const uploadResult = await uploadFirmwareToESP32WithRetry(device, firmwareData, firmwareFilename);
    
    if (uploadResult.success) {
      // Update device info
      device.firmware = req.body?.version || 'custom';
      device.lastUpdate = new Date().toISOString();
      device.status = 'updating'; // Mark as updating
      saveESP32Devices();
      
      // Broadcast update success
      broadcastDeviceUpdate(device, 'device-firmware-updated');
      
      // Set device back to online after a delay (ESP32 restart time)
      setTimeout(() => {
        if (esp32Devices[deviceId]) {
          esp32Devices[deviceId].status = 'online';
          saveESP32Devices();
          broadcastDeviceUpdate(esp32Devices[deviceId], 'device-online');
        }
      }, 10000); // Wait 10 seconds for ESP32 to restart
      
      res.json({
        success: true,
        message: 'Firmware update successful. Device will restart.',
        device: device
      });
    } else {
      // Broadcast update failure
      device.status = 'online'; // Reset status
      broadcastDeviceUpdate(device, 'device-firmware-failed');
      
      throw new Error(uploadResult.error || 'Firmware upload failed');
    }
    
  } catch (error) {
    console.error('Firmware upload error:', error);
    
    // Reset device status on error
    if (esp32Devices[deviceId]) {
      esp32Devices[deviceId].status = 'online';
      broadcastDeviceUpdate(esp32Devices[deviceId], 'device-firmware-failed');
    }
    
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Improved firmware upload function with retry logic and better error handling
async function uploadFirmwareToESP32WithRetry(device, firmwareData, filename, maxRetries = 3) {
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`📤 Firmware upload attempt ${attempt}/${maxRetries} for ${device.deviceName}`);
    
    // Pre-upload device check
    try {
      const deviceCheck = await quickDeviceCheck(device.ipAddress);
      if (!deviceCheck.responding) {
        console.log(`⚠️ Device ${device.deviceName} not responding, waiting before upload...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (checkError) {
      console.log(`⚠️ Device check failed for ${device.deviceName}, proceeding with upload...`);
    }
    
    try {
      const result = await uploadFirmwareToESP32(device, firmwareData, filename);
      if (result.success) {
        return result;
      }
      lastError = result.error;
      
      // Check if the error is a "socket hang up" or early connection reset
      if (result.error && (
        result.error.includes('socket hang up') || 
        result.error.includes('Early connection reset') ||
        result.error.includes('ECONNRESET')
      )) {
        console.log(`🔄 Connection reset detected, checking if device is now updating...`);
        
        // Wait a moment and check if device is still responsive
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        try {
          const checkResult = await quickDeviceCheck(device.ipAddress);
          if (!checkResult.responding) {
            // Device not responding likely means it's processing firmware
            console.log(`✅ Device ${device.deviceName} not responding - likely processing firmware update`);
            return {
              success: true,
              message: 'Firmware upload likely successful (device not responding indicates firmware processing)',
              note: 'ESP32 becomes unresponsive during firmware flashing'
            };
          }
        } catch (checkError) {
          // If we can't check, assume success for now
          console.log(`✅ Assuming successful upload for ${device.deviceName} - check failed after connection reset`);
          return {
            success: true,
            message: 'Firmware upload assumed successful (connection reset pattern)',
            note: 'Unable to verify but connection reset suggests firmware processing'
          };
        }
      }
      
      // Wait before retry
      if (attempt < maxRetries) {
        const waitTime = Math.min(3000 + (attempt * 2000), 10000); // Progressive backoff
        console.log(`⏳ Waiting ${waitTime/1000} seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    } catch (error) {
      lastError = error.message;
      
      // Wait before retry
      if (attempt < maxRetries) {
        const waitTime = Math.min(3000 + (attempt * 2000), 10000); // Progressive backoff
        console.log(`⏳ Waiting ${waitTime/1000} seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  return {
    success: false,
    error: `Upload failed after ${maxRetries} attempts. Last error: ${lastError}`
  };
}

// Quick device responsiveness check
async function quickDeviceCheck(ipAddress) {
  return new Promise((resolve) => {
    const http = require('http');
    
    const req = http.request({
      hostname: ipAddress,
      port: 80,
      path: '/',
      method: 'HEAD',
      timeout: 3000
    }, (res) => {
      resolve({ responding: true, status: res.statusCode });
    });
    
    req.on('error', () => resolve({ responding: false }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ responding: false });
    });
    
    req.end();
  });
}

// Function to upload firmware directly to ESP32 using HTTP module
async function uploadFirmwareToESP32(device, firmwareData, filename) {
  return new Promise(async (resolve) => {
    const startTime = Date.now();
    
    try {
      // Pre-upload health check
      console.log(`🔍 Checking device ${device.deviceName} readiness...`);
      const deviceCheck = await quickDeviceCheck(device.ipAddress);
      if (!deviceCheck.responding) {
        console.log(`⚠️ Device ${device.deviceName} not responding to health check`);
        // Don't fail immediately, but note this for troubleshooting
      } else {
        console.log(`✅ Device ${device.deviceName} is responding`);
      }
      
      const http = require('http');
      const FormData = require('form-data');
      
      // Create form data
      const form = new FormData();
      form.append('firmware', firmwareData, {
        filename: 'firmware.bin',
        contentType: 'application/octet-stream'
      });
      
      // Prepare request options with better ESP32 compatibility
      const options = {
        hostname: device.ipAddress,
        port: 80,
        path: '/update',
        method: 'POST',
        headers: {
          ...form.getHeaders(),
          'Connection': 'close',
          'User-Agent': 'OBS-Tally-Server/2.0',
          'Cache-Control': 'no-cache',
          'Keep-Alive': 'false',
          'Accept': '*/*'
        },
        timeout: 120000, // 2 minute timeout
        keepAlive: false,
        maxSockets: 1,
        // Add socket-level timeouts
        family: 4, // Force IPv4
        localAddress: undefined
      };
      
      console.log(`🔄 Sending ${firmwareData.length} bytes to ESP32 at ${device.ipAddress}...`);
      
      let uploadCompleted = false;
      let responseReceived = false;
      let bytesUploaded = 0;
      
      const req = http.request(options, (res) => {
        responseReceived = true;
        let responseData = '';
        
        console.log(`📊 ESP32 initial response: ${res.statusCode} ${res.statusMessage}`);
        
        res.on('data', (chunk) => {
          responseData += chunk;
          // Log progress for large responses
          if (responseData.length > 100) {
            console.log(`📊 Received ${responseData.length} bytes of response data`);
          }
        });
        
        res.on('end', () => {
          uploadCompleted = true;
          const duration = Date.now() - startTime;
          
          console.log(`📊 ESP32 response completed: ${res.statusCode} (${duration}ms)`);
          console.log(`📊 ESP32 final response: ${responseData.substring(0, 300)}...`);
          
          // ESP32 success indicators
          const successIndicators = [
            'Update Success',
            'OK',
            'FLASH_OK',
            'Upload successful',
            'Firmware updated',
            'Restarting'
          ];
          
          const isSuccess = res.statusCode === 200 || 
                           successIndicators.some(indicator => 
                             responseData.toLowerCase().includes(indicator.toLowerCase())
                           );
          
          if (isSuccess) {
            console.log(`✅ Firmware upload successful to ${device.deviceName} in ${duration}ms`);
            resolve({
              success: true,
              message: 'Firmware uploaded successfully',
              response: responseData,
              duration: duration
            });
          } else {
            console.error(`❌ ESP32 firmware upload failed: ${res.statusCode} - ${responseData}`);
            resolve({
              success: false,
              error: `HTTP ${res.statusCode}: ${responseData || res.statusMessage}`
            });
          }
        });
        
        res.on('error', (error) => {
          if (!uploadCompleted) {
            console.error(`❌ Response stream error from ${device.deviceName}:`, error.message);
            resolve({
              success: false,
              error: `Response error: ${error.message}`
            });
          }
        });
      });
      
      req.on('error', (error) => {
        if (!uploadCompleted) {
          const duration = Date.now() - startTime;
          
          console.log(`⚠️ Request error for ${device.deviceName} after ${duration}ms: ${error.code || error.message}`);
          
          // Handle different types of connection errors
          if (error.code === 'EPIPE' || 
              error.code === 'ECONNRESET' || 
              error.message.includes('socket hang up') ||
              error.message.includes('Connection reset')) {
            
            // For ESP32, these errors can indicate successful upload if enough time has passed
            if (duration > 8000) { // Reduced threshold to 8 seconds
              console.log(`✅ Likely successful upload for ${device.deviceName} - connection reset after ${duration}ms indicates ESP32 is processing firmware`);
              resolve({
                success: true,
                message: 'Firmware upload likely successful (ESP32 reset connection during processing)',
                note: 'Connection reset after significant upload time indicates successful processing',
                duration: duration
              });
            } else if (responseReceived) {
              // If we got some response before the reset, likely successful
              console.log(`✅ Likely successful upload for ${device.deviceName} - got response before connection reset`);
              resolve({
                success: true,
                message: 'Firmware upload likely successful (received response before reset)',
                note: 'Connection reset after receiving response is normal ESP32 behavior',
                duration: duration
              });
            } else if (duration > 3000) {
              // Even if early reset, if it took a few seconds there might have been some data transfer
              console.log(`⚠️ Possible successful upload for ${device.deviceName} - connection reset after ${duration}ms`);
              resolve({
                success: true,
                message: 'Firmware upload possibly successful (connection reset after partial upload)',
                note: 'ESP32 may be processing firmware despite early connection reset',
                duration: duration
              });
            } else {
              // Very early connection reset - likely a real failure
              console.error(`❌ Early connection reset for ${device.deviceName} after ${duration}ms`);
              resolve({
                success: false,
                error: `Early connection reset: ${error.message}`
              });
            }
          } else if (error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
            // Network/DNS issues
            resolve({
              success: false,
              error: `Network error: ${error.message}`
            });
          } else {
            // Other errors
            console.error(`❌ Unexpected error uploading to ${device.deviceName}:`, error);
            resolve({
              success: false,
              error: `Unexpected error: ${error.message}`
            });
          }
        }
      });
      
      req.on('timeout', () => {
        if (!uploadCompleted) {
          const duration = Date.now() - startTime;
          console.error(`⏰ Upload timeout for ${device.deviceName} after ${duration}ms`);
          req.destroy();
          
          // If timeout occurred after substantial time, might be successful
          if (duration > 30000) {
            resolve({
              success: true,
              message: 'Upload timeout after substantial progress - likely successful',
              note: 'ESP32 may still be processing the firmware',
              duration: duration
            });
          } else {
            resolve({
              success: false,
              error: 'Upload timeout - device may be unresponsive'
            });
          }
        }
      });
      
      // Track upload progress
      let formLength = 0;
      form.on('error', (error) => {
        if (!uploadCompleted) {
          console.error(`❌ Form data error for ${device.deviceName}:`, error.message);
          resolve({
            success: false,
            error: `Form data error: ${error.message}`
          });
        }
      });
      
      // Monitor form data transmission
      form.on('data', (chunk) => {
        bytesUploaded += chunk.length;
        if (bytesUploaded % 10240 === 0) { // Log every 10KB
          console.log(`📊 Uploaded ${bytesUploaded} bytes to ${device.deviceName}`);
        }
      });
      
      // Enhanced pipe handling with error recovery
      try {
        console.log(`🚀 Starting firmware stream to ${device.deviceName}...`);
        
        // Pipe with explicit error handling
        form.pipe(req);
        
        // Add a backup completion handler in case pipe doesn't complete properly
        setTimeout(() => {
          if (!uploadCompleted && !responseReceived) {
            console.log(`⚠️ No response received after 60 seconds for ${device.deviceName}`);
          }
        }, 60000);
        
      } catch (pipeError) {
        console.error(`❌ Error piping form data to ${device.deviceName}:`, pipeError.message);
        resolve({
          success: false,
          error: `Pipe error: ${pipeError.message}`
        });
      }
      
    } catch (error) {
      console.error(`❌ Error preparing firmware upload to ${device.deviceName}:`, error);
      resolve({
        success: false,
        error: `Upload preparation failed: ${error.message}`
      });
    }
  });
}

// ESP32 device discovery endpoint
app.post('/api/esp32/discover', async (req, res) => {
  try {
    console.log('🔍 Starting ESP32 device discovery...');
    
    // Clear previous discoveries
    discoveredDevices.clear();
    
    // Step 1: Send UDP broadcast for immediate discovery
    if (discoveryServer) {
      const broadcast = JSON.stringify({
        type: 'discover-request',
        timestamp: new Date().toISOString()
      });
      
      try {
        // Get local network IP to calculate broadcast address
        const localIP = getLocalNetworkIP();
        let broadcastAddr = '255.255.255.255';
        
        if (localIP) {
          // Calculate local network broadcast address (safer on macOS)
          const ipParts = localIP.split('.');
          if (ipParts.length === 4) {
            broadcastAddr = `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}.255`;
          }
        }
        
        discoveryServer.send(broadcast, 3006, broadcastAddr, (error) => {
          if (error) {
            console.warn(`UDP broadcast failed (${broadcastAddr}):`, error.message);
            
            // Fallback to localhost broadcast if network broadcast fails
            if (broadcastAddr !== '127.255.255.255') {
              discoveryServer.send(broadcast, 3006, '127.255.255.255', (fallbackError) => {
                if (fallbackError) {
                  console.warn('UDP localhost broadcast also failed:', fallbackError.message);
                } else {
                  console.log('📡 UDP discovery sent via localhost broadcast');
                }
              });
            }
          } else {
            console.log(`📡 UDP discovery broadcast sent to ${broadcastAddr}`);
          }
        });
      } catch (broadcastError) {
        console.warn('Failed to send UDP broadcast:', broadcastError.message);
      }
    }
    
    // Step 2: Wait for UDP responses
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Step 3: Return results
    const discovered = Array.from(discoveredDevices.values());
    const registered = Object.values(esp32Devices).filter(d => d.autoRegistered);
    
    res.json({
      success: true,
      discovered: discovered,
      registered: registered.length,
      count: discovered.length,
      message: `Discovery complete. Found ${discovered.length} devices, registered ${registered.length}`
    });
    
    console.log(`🔍 Discovery complete. Found ${discovered.length} devices`);
  } catch (error) {
    console.error('Discovery error:', error);
    res.status(500).json({
      success: false,
      error: 'Discovery failed'
    });
  }
});

// Configure multer for firmware uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only .bin files (compiled Arduino firmware)
    if (file.originalname.endsWith('.bin')) {
      cb(null, true);
    } else {
      cb(new Error('Only .bin firmware files are allowed'));
    }
  }
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// ESP32 OTA firmware upload endpoint
app.post('/api/esp32/upload-firmware', upload.single('firmware'), async (req, res) => {
  try {
    const { deviceId } = req.body;
    
    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No firmware file uploaded' });
    }
    
    const device = esp32Devices[deviceId];
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    if (!device.ipAddress) {
      return res.status(400).json({ error: 'Device IP address not available' });
    }
    
    console.log(`Starting OTA update for device ${device.deviceName} (${deviceId}) at ${device.ipAddress}`);
    console.log(`Firmware file: ${req.file.originalname}, size: ${req.file.size} bytes`);
    
    // Read the firmware file
    const firmwareData = fs.readFileSync(req.file.path);
    
    // Initiate OTA update via HTTP POST to ESP32
    const otaResult = await initiateOTAUpdate(device.ipAddress, firmwareData, deviceId);
    
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    
    if (otaResult.success) {
      // Update device firmware version in database
      esp32Devices[deviceId].firmware = req.body.firmwareVersion || 'Updated';
      esp32Devices[deviceId].lastOTAUpdate = new Date().toISOString();
      saveESP32Devices();
      
      res.json({
        success: true,
        message: 'OTA update completed successfully',
        device: esp32Devices[deviceId]
      });
    } else {
      res.status(500).json({
        success: false,
        error: otaResult.error || 'OTA update failed'
      });
    }
    
  } catch (error) {
    console.error('Firmware upload error:', error);
    
    // Clean up uploaded file if it exists
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('Failed to clean up uploaded file:', cleanupError);
      }
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

// ESP32 OTA status endpoint - get current OTA capability
app.get('/api/esp32/ota-status/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  const device = esp32Devices[deviceId];
  
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }
  
  res.json({
    deviceId,
    deviceName: device.deviceName,
    ipAddress: device.ipAddress,
    currentFirmware: device.firmware || 'unknown',
    lastOTAUpdate: device.lastOTAUpdate || null,
    otaReady: !!(device.ipAddress && device.status === 'online'),
    lastSeen: device.lastSeen
  });
});

// Function to initiate OTA update on ESP32 device
async function initiateOTAUpdate(deviceIP, firmwareData, deviceId) {
  return new Promise((resolve) => {
    try {
      const { spawn } = require('child_process');
      
      // Write firmware to temporary file for espota.py
      const tempFirmwarePath = path.join(__dirname, 'uploads', `temp_${deviceId}.bin`);
      fs.writeFileSync(tempFirmwarePath, firmwareData);
      
      // Find Arduino IDE installation and espota.py
      const possibleEspotaPaths = [
        '/Applications/Arduino.app/Contents/Java/hardware/esp32/2.0.*/tools/espota.py',
        '/Users/*/Library/Arduino15/packages/esp32/hardware/esp32/*/tools/espota.py',
        'espota.py' // If available in PATH
      ];
      
      // For simplicity, we'll use a direct HTTP approach instead of espota.py
      // This requires the ESP32 to have ArduinoOTA library properly configured
      
      const http = require('http');
      
      // Create HTTP request to ESP32 OTA endpoint
      const postData = firmwareData;
      
      const options = {
        hostname: deviceIP,
        port: 3232, // ArduinoOTA default port
        path: '/update',
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': postData.length
        },
        timeout: 60000 // 60 seconds timeout
      };
      
      const req = http.request(options, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          // Clean up temp file
          try {
            fs.unlinkSync(tempFirmwarePath);
          } catch (e) {
            console.error('Failed to clean up temp file:', e);
          }
          
          if (res.statusCode === 200) {
            console.log(`OTA update successful for device ${deviceId}`);
            resolve({ success: true, response: responseData });
          } else {
            console.error(`OTA update failed for device ${deviceId}. Status: ${res.statusCode}`);
            resolve({ success: false, error: `HTTP ${res.statusCode}: ${response.statusText}` });
          }
        });
      });
      
      req.on('error', (error) => {
        console.error(`OTA update error for device ${deviceId}:`, error);
        // Clean up temp file
        try {
          fs.unlinkSync(tempFirmwarePath);
        } catch (e) {
          console.error('Failed to clean up temp file:', e);
        }
        resolve({ success: false, error: error.message });
      });
      
      req.on('timeout', () => {
        console.error(`OTA update timeout for device ${deviceId}`);
        req.destroy();
        // Clean up temp file
        try {
          fs.unlinkSync(tempFirmwarePath);
        } catch (e) {
          console.error('Failed to clean up temp file:', e);
        }
        resolve({ success: false, error: 'Update timeout' });
      });
      
      // Write firmware data
      req.write(postData);
      req.end();
      
    } catch (error) {
      console.error(`OTA initiation error for device ${deviceId}:`, error);
      resolve({ success: false, error: error.message });
    }
  });
}

// Broadcast device updates to WebSocket clients
function broadcastDeviceUpdate(device, updateType = 'device-update') {
  const message = JSON.stringify({
    type: updateType,
    device: device,
    timestamp: new Date().toISOString()
  });
  
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
  
  // If this is a status update, also broadcast the tally status to update ESP status indicators
  if (updateType === 'device-status-update' || updateType === 'device-heartbeat') {
    broadcastTally();
  }
}

// Broadcast all devices to WebSocket clients
function broadcastDeviceList() {
  const message = JSON.stringify({
    type: 'devices-update',
    devices: esp32Devices,
    timestamp: new Date().toISOString()
  });
  
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

wss.on('connection', ws => {
  // Send comprehensive initial state including devices and all data
  const initialState = {
    type: 'initial-state',
    sources: tallySources, 
    status: tallyStatus,
    obsConnectionStatus,
    obsConnectionError,
    devices: esp32Devices, // Include ESP32 devices in initial state
    espStatus: Object.values(esp32Devices).some(device => device.status === 'online') ? 'online' : 'offline',
    serverConnected: true,
    timestamp: new Date().toISOString()
  };
  
  ws.send(JSON.stringify(initialState));
  
  // Also send tally status update for consistency
  setTimeout(() => {
    const tallyUpdate = {
      type: 'tally-status',
      sources: tallySources,
      status: tallyStatus,
      obsConnectionStatus,
      obsConnectionError: obsConnectionStatus === 'disconnected' ? obsConnectionError : null,
      espStatus: Object.values(esp32Devices).some(device => device.status === 'online') ? 'online' : 'offline',
      timestamp: new Date().toISOString()
    };
    ws.send(JSON.stringify(tallyUpdate));
  }, 100);
  
  // Send device list separately for clarity
  setTimeout(() => {
    broadcastDeviceList();
  }, 200);
  
  // Track client connections
  console.log('Client connected to tally server WebSocket. Total clients:', wss.clients.size);
  console.log('OBS connection status:', obsConnectionStatus === 'connected' ? 'Connected to OBS' : 'Not connected to OBS');
  
  // Handle ESP32 device registration
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      if (message.type === 'register' && message.deviceId) {
        console.log(`ESP32 device registered via WebSocket: ${message.deviceId}`);
        ws.deviceId = message.deviceId; // Store deviceId on the socket
        
        // Send current configuration to the device if it exists
        if (esp32Devices[message.deviceId]) {
          ws.send(JSON.stringify({
            type: 'config',
            deviceId: message.deviceId,
            config: {
              name: esp32Devices[message.deviceId].deviceName,
              assignedSource: esp32Devices[message.deviceId].assignedSource,
              updateInterval: 2000,
              heartbeatInterval: 30000
            }
          }));
        }
      }
    } catch (error) {
      console.warn('Error parsing WebSocket message:', error.message);
    }
  });
  
  ws.on('close', () => {
    console.log('Client disconnected from tally server. Total clients:', wss.clients.size);
  });
});

// Initialize UDP discovery server for ESP32 auto-discovery
function initUDPDiscovery() {
  try {
    if (discoveryServer) {
      try {
        // Properly close existing server
        if (discoveryServer.address()) {
          discoveryServer.close(() => {
            console.log('Previous UDP discovery server closed');
            createNewUDPServer();
          });
          return;
        } else {
          discoveryServer = null;
        }
      } catch (err) {
        console.warn('Error closing previous UDP server:', err.message);
        discoveryServer = null;
      }
    }
    
    createNewUDPServer();
  } catch (error) {
    console.error('Failed to initialize UDP discovery:', error.message);
  }
}

function createNewUDPServer() {
  discoveryServer = dgram.createSocket('udp4');
  
  discoveryServer.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString());
      
      if (data.type === 'device-announce' && data.deviceId && data.deviceName) {
        console.log(`📢 ESP32 device discovered: ${data.deviceName} (${data.deviceId}) at ${rinfo.address}`);
        
        // Store discovered device
        discoveredDevices.set(data.deviceId, {
          deviceId: data.deviceId,
          deviceName: data.deviceName,
          ipAddress: rinfo.address,
          macAddress: data.macAddress || '',
          firmware: data.firmware || 'unknown',
          discoveredAt: new Date().toISOString(),
          autoRegistered: false
        });
        
        // Auto-register the device if not already registered
        if (!esp32Devices[data.deviceId]) {
          const device = {
            deviceId: data.deviceId,
            deviceName: data.deviceName,
            macAddress: data.macAddress || '',
            ipAddress: rinfo.address,
            firmware: data.firmware || 'unknown',
            assignedSource: '',
            lastSeen: new Date().toISOString(),
            status: 'online',
            autoRegistered: true,
            createdAt: new Date().toISOString()
          };
          
          esp32Devices[data.deviceId] = device;
          saveESP32Devices();
          
          console.log(`✅ Auto-registered ESP32 device: ${data.deviceName} (${data.deviceId})`);
          
          // Broadcast device registration
          broadcastDeviceUpdate(device, 'device-auto-register');
        }
      }
    } catch (error) {
      console.warn('Error parsing UDP discovery message:', error.message);
    }
  });
  
  discoveryServer.on('listening', () => {
    const address = discoveryServer.address();
    console.log(`📡 UDP discovery server listening on ${address.address}:${address.port}`);
  });
  
  discoveryServer.on('error', (err) => {
    console.error('UDP discovery server error:', err.message);
    // Attempt to restart after error
    setTimeout(() => {
      console.log('Attempting to restart UDP discovery server...');
      initUDPDiscovery();
    }, 5000);
  });
  
  // Bind to port 3006 for ESP32 discovery
  discoveryServer.bind(3006);
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
      initUDPDiscovery();
      
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
  
  // Clear all timers
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  
  if (updateTallyTimeout) {
    clearTimeout(updateTallyTimeout);
    updateTallyTimeout = null;
  }
  
  // Stop ESP32 health monitoring
  stopESP32HealthMonitoring();
  
  // Close UDP discovery server with proper error handling
  if (discoveryServer) {
    try {
      if (discoveryServer.address()) {
        discoveryServer.close((err) => {
          if (err) {
            console.warn('Error closing UDP server:', err.message);
          } else {
            console.log('UDP discovery server closed');
          }
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
