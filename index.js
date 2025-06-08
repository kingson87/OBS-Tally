// (moved below app initialization)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const OBSWebSocket = require('obs-websocket-js').default;
const net = require('net');
const os = require('os');
const QRCode = require('qrcode');
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

// Initialize Socket.IO server
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('🔍 [DEBUG] New Socket.IO client connected:', socket.id);
    
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
    
    socket.emit('initial-state', initialState);
    
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
      socket.emit('tally-status', tallyUpdate);
    }, 100);
    
    // Send device list separately for clarity
    setTimeout(() => {
      socket.emit('devices-update', {
        type: 'devices-update',
        devices: esp32Devices,
        timestamp: new Date().toISOString()
      });
    }, 200);
    
    // Track client connections
    console.log('Client connected to tally server Socket.IO. Total clients:', io.engine.clientsCount);
    console.log('OBS connection status:', obsConnectionStatus === 'connected' ? 'Connected to OBS' : 'Not connected to OBS');
    
    // Handle ESP32 device registration
    socket.on('register', (data) => {
      try {
        if (data.type === 'register' && data.deviceId) {
          console.log(`ESP32 device registered via Socket.IO: ${data.deviceId}`);
          socket.deviceId = data.deviceId; // Store deviceId on the socket
          
          // Send current configuration to the device if it exists
          if (esp32Devices[data.deviceId]) {
            socket.emit('config', {
              type: 'config',
              deviceId: data.deviceId,
              config: {
                name: esp32Devices[data.deviceId].deviceName,
                assignedSource: esp32Devices[data.deviceId].assignedSource,
                updateInterval: 2000,
                heartbeatInterval: 30000
              }
            });
          }
        }
      } catch (error) {
        console.warn('Error parsing Socket.IO message:', error.message);
      }
    });
    
    socket.on('disconnect', () => {
        console.log('🔍 [DEBUG] Socket.IO client disconnected:', socket.id);
        console.log('Client disconnected from tally server. Total clients:', io.engine.clientsCount);
    });
    
    socket.on('error', (error) => {
        console.error('Socket.IO error:', error);
    });
});

// Create a compatibility object for code that still references wss
const wss = {
    clients: {
        get size() {
            return io.engine.clientsCount;
        }
    }
};

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
const sourcesConfigPath = path.join(__dirname, 'sources.json');

// Load tally sources from file
function loadTallySources() {
  try {
    if (fs.existsSync(sourcesConfigPath)) {
      const raw = fs.readFileSync(sourcesConfigPath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.sources) && data.sources.length > 0) {
        tallySources = data.sources;
        console.log(`Loaded ${tallySources.length} sources from file:`, sourcesConfigPath);
      }
    } else {
      // Create default sources file if it doesn't exist
      saveTallySources();
      console.log('Created default sources file:', sourcesConfigPath);
    }
  } catch (e) {
    console.error('Error loading tally sources:', e.message);
    // Keep the default source if file is missing or invalid
  }
}

// Save tally sources to file
function saveTallySources() {
  try {
    fs.writeFileSync(sourcesConfigPath, JSON.stringify({ sources: tallySources }, null, 2), 'utf8');
    console.log(`Saved ${tallySources.length} sources to file:`, sourcesConfigPath);
    return true;
  } catch (e) {
    console.error('Error saving tally sources:', e.message);
    return false;
  }
}

// Initialize tallyStatus for each source
function initTallyStatus() {
  tallySources.forEach(source => {
    tallyStatus[source] = { source, status: 'Idle' };
  });
}
initTallyStatus();

// Load sources from file at startup
loadTallySources();
initTallyStatus(); // Re-initialize with loaded sources

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
  const msg = { 
    obsConnectionStatus,
    obsConnectionError
  };
  io.emit('obs-status', msg);
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
      
      // Get initial recording and streaming status
      try {
        const recordStatusResponse = await obs.call('GetRecordStatus');
        recordingStatus.active = recordStatusResponse.outputActive;
        if (recordingStatus.active) {
          recordingStatus.startTime = new Date(Date.now() - (recordStatusResponse.outputDuration || 0));
          recordingStatus.duration = Math.floor((recordStatusResponse.outputDuration || 0) / 1000);
        }
        console.log(`🔴 Initial recording status: ${recordingStatus.active ? 'ACTIVE' : 'INACTIVE'}`);
      } catch (err) {
        console.log('Could not get initial recording status:', err.message);
      }
      
      try {
        const streamStatusResponse = await obs.call('GetStreamStatus');
        streamingStatus.active = streamStatusResponse.outputActive;
        if (streamingStatus.active) {
          streamingStatus.startTime = new Date(Date.now() - (streamStatusResponse.outputDuration || 0));
          streamingStatus.duration = Math.floor((streamStatusResponse.outputDuration || 0) / 1000);
        }
        console.log(`🟡 Initial streaming status: ${streamingStatus.active ? 'ACTIVE' : 'INACTIVE'}`);
      } catch (err) {
        console.log('Could not get initial streaming status:', err.message);
      }
    } catch (err) {
      console.error('Error getting current scene:', err.message);
    }
  });

  // Listen for recording state changes
  obs.on('RecordStateChanged', (data) => {
    const wasRecording = recordingStatus.active;
    recordingStatus.active = data.outputActive;
    
    if (recordingStatus.active) {
      recordingStatus.startTime = new Date();
      recordingStatus.duration = 0;
      console.log('🔴 Recording started via OBS event');
    } else {
      recordingStatus.startTime = null;
      recordingStatus.duration = 0;
      console.log('🔴 Recording stopped via OBS event');
    }
    
    // Only broadcast if status actually changed
    if (wasRecording !== recordingStatus.active) {
      console.log(`🔴 Recording status changed: ${wasRecording} → ${recordingStatus.active}`);
      
      // Force notification to all ESP32 devices
      const forceNotify = {
        type: 'recording',
        active: recordingStatus.active
      };
      
      // Broadcast to all clients and ESP32 devices
      broadcastTally(forceNotify);
    }
  });

  // Listen for streaming state changes
  obs.on('StreamStateChanged', (data) => {
    const wasStreaming = streamingStatus.active;
    streamingStatus.active = data.outputActive;
    
    if (streamingStatus.active) {
      streamingStatus.startTime = new Date();
      streamingStatus.duration = 0;
      console.log('🟡 Streaming started via OBS event');
    } else {
      streamingStatus.startTime = null;
      streamingStatus.duration = 0;
      console.log('🟡 Streaming stopped via OBS event');
    }
    
    // Only broadcast if status actually changed
    if (wasStreaming !== streamingStatus.active) {
      console.log(`🟡 Streaming status changed: ${wasStreaming} → ${streamingStatus.active}`);
      
      // Force notification to all ESP32 devices
      const forceNotify = {
        type: 'streaming',
        active: streamingStatus.active
      };
      
      // Broadcast to all clients and ESP32 devices
      broadcastTally(forceNotify);
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
        
        // Log which ESP32 devices are using this source
        const devicesUsingSource = Object.values(esp32Devices)
          .filter(device => device.assignedSource === source)
          .map(device => device.deviceName || device.deviceId);
        
        if (devicesUsingSource.length > 0) {
          console.log(`📱 Source "${source}" used by ${devicesUsingSource.length} device(s): ${devicesUsingSource.join(', ')}`);
        }
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

async function broadcastTally(forceNotify = null) {
  const anyEspDeviceOnline = Object.values(esp32Devices).some(device => device.status === 'online');
  
  // Format device status updates in the format expected by the device manager
  const deviceStatus = {};
  
  // Debug logging for tally status mapping
  console.log('🔍 [DEBUG] Current tallyStatus object:', JSON.stringify(tallyStatus, null, 2));
  console.log('🔍 [DEBUG] Processing', Object.keys(esp32Devices).length, 'ESP32 devices');
  
  // Map tally status to devices
  Object.keys(esp32Devices).forEach(deviceId => {
    const device = esp32Devices[deviceId];
    console.log(`🔍 [DEBUG] Processing device ${deviceId}:`, {
      assignedSource: device.assignedSource,
      hasSourceInTallyStatus: !!(device.assignedSource && tallyStatus[device.assignedSource]),
      deviceStatus: device.status
    });
    
    if (device.assignedSource && tallyStatus[device.assignedSource]) {
      // Convert from OBS state name to tally state name
      let tallyState = 'idle';
      if (tallyStatus[device.assignedSource].status === 'Live') {
        tallyState = 'program';
      } else if (tallyStatus[device.assignedSource].status === 'Preview') {
        tallyState = 'preview';
      }
      
      deviceStatus[deviceId] = {
        state: tallyState,
        sourceName: device.assignedSource,
        online: device.status === 'online'
      };
      console.log(`🔍 [DEBUG] Device ${deviceId} set to:`, deviceStatus[deviceId]);
    } else {
      // Default state if no source assigned or source not found
      deviceStatus[deviceId] = { 
        state: 'idle',
        sourceName: device.assignedSource || 'None',
        online: device.status === 'online'
      };
      console.log(`🔍 [DEBUG] Device ${deviceId} set to default:`, deviceStatus[deviceId]);
    }
  });
   const statusUpdate = {
    type: 'tally-status',
    sources: tallySources,
    status: tallyStatus, // Send source status directly for web client
    deviceStatus: deviceStatus, // Separate field for device status
    obsConnectionStatus,
    obsConnectionError: obsConnectionStatus === 'disconnected' ? obsConnectionError : null,
    espStatus: anyEspDeviceOnline ? 'online' : 'offline',
    timestamp: new Date().toISOString()
  };

  // Debug logging for Device Manager issue
  console.log('🔍 [DEBUG] Broadcasting tally status update:');
  console.log('🔍 [DEBUG] deviceStatus:', JSON.stringify(deviceStatus, null, 2));
  console.log('🔍 [DEBUG] ESP32 devices:', Object.keys(esp32Devices));
  console.log('🔍 [DEBUG] Socket.IO clients:', io.engine.clientsCount);

  // Broadcast to all Socket.IO clients
  io.emit('tally-status', statusUpdate);
  console.log('🔍 [DEBUG] Broadcasted to', io.engine.clientsCount, 'Socket.IO clients');
  
  // Update ESP32 devices - call async function
  try {
    await notifyESP32Devices(forceNotify);
  } catch (error) {
    console.error("Error in notifyESP32Devices:", error);
  }
}

// ESP32 notification debouncing to prevent rapid duplicate updates
const esp32NotificationDebounce = new Map();
const ESP32_DEBOUNCE_MS = 100; // Minimum 100ms between notifications to the same device

// Notify ESP32 devices of tally status changes
async function notifyESP32Devices(forceNotify = null) {
  if (Object.keys(esp32Devices).length === 0) return;
  
  // Performance tracking for ESP32 notifications
  const notificationStartTime = performance.now();
  const notificationPromises = [];
  let devicesNotified = 0;
  let devicesSkipped = 0;
  
  for (const deviceId of Object.keys(esp32Devices)) {
    const device = esp32Devices[deviceId];
    if (device.status === 'online' && device.ipAddress) {
      // Determine if we should notify this device
      let shouldNotify = false;
      let newStatus = null;
      let notifyReason = '';
      
      // Check if there's a source status change
      if (device.assignedSource && tallyStatus[device.assignedSource]) {
        newStatus = tallyStatus[device.assignedSource].status;
        if (device.lastNotifiedStatus !== newStatus) {
          shouldNotify = true;
          notifyReason = 'source status change';
        }
      }
      
      // Check for forced notifications (recording/streaming status changes)
      if (forceNotify) {
        shouldNotify = true;
        if (forceNotify.type === 'recording') {
          notifyReason = `recording ${forceNotify.active ? 'started' : 'stopped'}`;
        } else if (forceNotify.type === 'streaming') {
          notifyReason = `streaming ${forceNotify.active ? 'started' : 'stopped'}`;
        } else {
          notifyReason = 'forced notification';
        }
        console.log(`🔔 Force notification for ${device.deviceName}: ${notifyReason}`);
      }
      
      if (shouldNotify) {
        // Check debounce timing
        const now = Date.now();
        const lastNotification = esp32NotificationDebounce.get(deviceId) || 0;
        
        if (now - lastNotification >= ESP32_DEBOUNCE_MS) {
          // Only update lastNotifiedStatus if we have a valid source status change
          if (newStatus !== null) {
            device.lastNotifiedStatus = newStatus;
          }
          esp32NotificationDebounce.set(deviceId, now);
          devicesNotified++;
          
          // Get the current status for this device
          // For recording/streaming notifications, use the device's current tally status
          // If no status is available, use the last notified status or default to IDLE
          let statusToSend;
          if (newStatus) {
            // For source status changes, use the new status
            statusToSend = newStatus;
          } else if (device.assignedSource && tallyStatus[device.assignedSource]) {
            // For recording/streaming notifications, use the current source status
            statusToSend = tallyStatus[device.assignedSource].status;
          } else if (device.lastNotifiedStatus) {
            // Fall back to last notified status
            statusToSend = device.lastNotifiedStatus;
          } else {
            // Default to IDLE
            statusToSend = 'IDLE';
          }
          
          // Log the status decision process for debugging
          console.log(`📊 Status decision for ${device.deviceName} (${deviceId}): newStatus=${newStatus}, assignedSource=${device.assignedSource}, sourceStatus=${device.assignedSource ? (tallyStatus[device.assignedSource]?.status || 'none') : 'none'}, lastNotified=${device.lastNotifiedStatus}, final=${statusToSend}`);
          
          console.log(`⚡ ESP32 Real-time Update: ${device.deviceName} (${deviceId}): ${notifyReason} -> ${statusToSend}`);
          
          // Send HTTP POST notification to ESP32 device (non-blocking)
          const notificationPromise = sendTallyUpdateToESP32(device, statusToSend)
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
      // Send enhanced format for M5StickC compatibility
      recordingStatus: recordingStatus, // M5StickC expects recordingStatus.active
      streamingStatus: streamingStatus, // M5StickC expects streamingStatus.active
      // Also send legacy format for backward compatibility
      recording: recordingStatus.active, // ESP32 fallback format
      streaming: streamingStatus.active, // ESP32 fallback format
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
      
      // Broadcast health status to Socket.IO clients
      const healthStatus = {
        type: 'esp32-health-status',
        timestamp: new Date().toISOString(),
        totalDevices: results.length,
        healthyDevices: healthy,
        unhealthyDevices: unhealthy,
        checkDuration: healthDuration
      };
      
      io.emit('esp32-health-status', healthStatus);
      
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
    // Store the old sources for comparison
    const oldSources = [...tallySources];
    
    tallySources = sources;
    initTallyStatus();
    saveTallySources(); // Save to file
    
    // Check for removed sources and clear device assignments
    const removedSources = oldSources.filter(source => !tallySources.includes(source));
    if (removedSources.length > 0) {
      console.log(`[SOURCES] Detected removed sources: ${removedSources.join(', ')}`);
      
      // Check all ESP32 devices and clear assignments for removed sources
      let devicesUpdated = 0;
      Object.keys(esp32Devices).forEach(deviceId => {
        const device = esp32Devices[deviceId];
        if (device.assignedSource && removedSources.includes(device.assignedSource)) {
          console.log(`[SOURCES] Clearing assigned source "${device.assignedSource}" from device ${device.deviceName} (${deviceId})`);
          
          // Clear the assigned source
          const oldSource = device.assignedSource;
          device.assignedSource = '';
          device.lastUpdate = new Date().toISOString();
          devicesUpdated++;
          
          // Broadcast device update to notify clients
          broadcastDeviceUpdate(device, 'device-source-cleared');
          
          // Send notification to ESP32 device to clear its display
          if (device.ipAddress && device.status === 'online') {
            sendTallyUpdateToESP32(device, 'Idle').catch(error => {
              console.warn(`[SOURCES] Failed to notify ESP32 ${deviceId} of source removal:`, error.message);
            });
          }
        }
      });
      
      if (devicesUpdated > 0) {
        // Save updated device assignments
        saveESP32Devices();
        console.log(`[SOURCES] Updated ${devicesUpdated} device(s) with cleared source assignments`);
      }
    }
    
    updateTallyForSources();
    res.json({ success: true, sources: tallySources });
  } else {
    res.status(400).json({ success: false, error: 'Invalid sources' });
  }
});

// New API endpoint to get all available sources from OBS
app.get('/api/obs/all-sources', async (req, res) => {
  try {
    if (obsConnectionStatus !== 'connected') {
      return res.json({ success: false, error: 'OBS not connected', sources: [] });
    }
    
    // Get all inputs from OBS
    const { inputs } = await obs.call('GetInputList');
    const sources = inputs.map(input => ({
      name: input.inputName,
      kind: input.inputKind
    }));
    
    console.log(`Retrieved ${sources.length} sources from OBS`);
    res.json({ success: true, sources });
  } catch (err) {
    console.error('Error getting OBS sources:', err.message);
    res.json({ success: false, error: err.message, sources: [] });
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
    
    // Close WebSocket connections (Socket.IO)
    io.emit('server-shutdown', { 
      type: 'server-shutdown', 
      message: 'Server is shutting down' 
    });
    io.close();
    
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

// Recording and streaming status (to be removed after refactoring)
let recordingStatus = { active: false, startTime: null, duration: 0 };
let streamingStatus = { active: false, startTime: null, duration: 0 };

// Load ESP32 devices from file
function loadESP32Devices() {
  try {
    if (fs.existsSync(esp32ConfigPath)) {
      const raw = fs.readFileSync(esp32ConfigPath, 'utf8');
      esp32Devices = JSON.parse(raw);
      console.log('Loaded ESP32 devices from file:', Object.keys(esp32Devices).length);
      
      // Migration: Remove legacy recording/streaming status properties
      let migrationPerformed = false;
      Object.keys(esp32Devices).forEach(deviceId => {
        const device = esp32Devices[deviceId];
        if (device.hasOwnProperty('showRecordingStatus') || device.hasOwnProperty('showStreamingStatus')) {
          console.log(`🔧 Migrating device ${device.deviceName || deviceId}: removing legacy status properties`);
          delete device.showRecordingStatus;
          delete device.showStreamingStatus;
          migrationPerformed = true;
        }
      });
      
      // Save migrated data back to file if any migration was performed
      if (migrationPerformed) {
        console.log('💾 Saving migrated device data...');
        saveESP32Devices();
      }
    }
  } catch (e) {
    console.error('Error loading ESP32 devices:', e.message);
    esp32Devices = {};
  }
}

// Save ESP32 devices to file
function saveESP32Devices() {
  try {
    console.log(`[SAVE] Saving ${Object.keys(esp32Devices).length} devices to ${esp32ConfigPath}`);
    
    // Validate esp32Devices object
    if (!esp32Devices || typeof esp32Devices !== 'object') {
      throw new Error('esp32Devices is not a valid object');
    }
    
    // Create backup of existing file if it exists
    if (fs.existsSync(esp32ConfigPath)) {
      const backupPath = `${esp32ConfigPath}.backup`;
      try {
        fs.copyFileSync(esp32ConfigPath, backupPath);
        console.log(`[SAVE] Backup created at ${backupPath}`);
      } catch (backupError) {
        console.warn(`[SAVE] Warning: Could not create backup: ${backupError.message}`);
      }
    }
    
    // Validate JSON serialization
    const jsonData = JSON.stringify(esp32Devices, null, 2);
    if (!jsonData || jsonData === '{}') {
      console.warn('[SAVE] Warning: Serialized data is empty or invalid');
    }
    
    // Write to temporary file first, then move to final location
    const tempPath = `${esp32ConfigPath}.tmp`;
    fs.writeFileSync(tempPath, jsonData, 'utf8');
    
    // Verify the temporary file was written correctly
    const verifyData = fs.readFileSync(tempPath, 'utf8');
    JSON.parse(verifyData); // This will throw if JSON is invalid
    
    // Move temp file to final location
    fs.renameSync(tempPath, esp32ConfigPath);
    
    console.log(`[SAVE] Successfully saved devices to file`);
  } catch (error) {
    console.error('[SAVE] Error saving ESP32 devices:', {
      error: error.message,
      stack: error.stack,
      devicesCount: Object.keys(esp32Devices || {}).length,
      configPath: esp32ConfigPath
    });
    
    // Clean up temp file if it exists
    const tempPath = `${esp32ConfigPath}.tmp`;
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
        console.log('[SAVE] Cleaned up temporary file');
      } catch (cleanupError) {
        console.error('[SAVE] Could not clean up temp file:', cleanupError.message);
      }
    }
    
    throw error; // Re-throw to let caller handle the error
  }
}

loadESP32Devices();
// Broadcast initial status after devices are loaded
broadcastTally();

// API endpoint to get all registered ESP32 devices
app.get('/api/esp32/devices', (req, res) => {
  try {
    // Return devices in the format expected by the client
    res.json({
      success: true,
      devices: esp32Devices
    });
  } catch (error) {
    console.error('Error getting ESP32 devices:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get devices',
      message: error.message 
    });
  }
});

// Debug API endpoint to inspect current device status mapping
app.get('/api/debug/device-status', (req, res) => {
  try {
    console.log('DEBUG API: Current device status requested');
    
    // Get current tally status
    const debugInfo = {
      timestamp: new Date().toISOString(),
      tallyStatus: tallyStatus,
      esp32Devices: esp32Devices,
      deviceStatusMapping: {},
      websocketConnections: io.engine.clientsCount
    };
    
    // Create device status mapping for debug
    Object.values(esp32Devices).forEach(device => {
      const deviceId = device.deviceId; // Use deviceId instead of device_id
      const assignedSource = device.assignedSource; // Use assignedSource instead of assigned_source
      const sourceStatus = tallyStatus[assignedSource];
      const status = sourceStatus ? sourceStatus.status : 'IDLE';
      
      debugInfo.deviceStatusMapping[deviceId] = {
        assignedSource: assignedSource,
        status: status,
        isOnline: device.status === 'online',
        lastSeen: device.lastSeen
      };
    });
    
    console.log('DEBUG API: Returning device status debug info:', debugInfo);
    res.json(debugInfo);
  } catch (error) {
    console.error('Error in debug device status API:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get debug status',
      message: error.message 
    });
  }
});

// Register a new ESP32 device
app.post('/api/esp32/devices', (req, res) => {
  try {
    const { deviceId, name, mac, ipAddress } = req.body;
    
    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: 'Device ID is required'
      });
    }
    
    // Create or update device
    esp32Devices[deviceId] = {
      ...esp32Devices[deviceId],
      deviceId: deviceId,
      deviceName: name || `Tally ${Object.keys(esp32Devices).length + 1}`,
      macAddress: mac || '',
      ipAddress: ipAddress || '',
      status: 'offline',
      createdAt: esp32Devices[deviceId]?.createdAt || new Date().toISOString(),
      lastUpdate: new Date().toISOString()
    };
    
    // Save to file
    saveESP32Devices();
    
    // Broadcast device update
    broadcastDeviceUpdate(esp32Devices[deviceId], 'device-added');
    
    res.json({
      success: true,
      device: esp32Devices[deviceId]
    });
  } catch (error) {
    console.error('Error registering device:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update a specific device
app.post('/api/esp32/update-device/:deviceId', (req, res) => {
  try {
    const { deviceId } = req.params;
    const { deviceName, assignedSource } = req.body;
    
    console.log(`[UPDATE] Updating device ${deviceId}:`, { 
      deviceName, 
      assignedSource
    });
    
    if (!esp32Devices[deviceId]) {
      console.error(`[UPDATE] Device ${deviceId} not found in esp32Devices`);
      return res.status(404).json({
        success: false,
        error: 'Device not found',
        details: `Device ID '${deviceId}' does not exist in the registry`
      });
    }
    
    // Validate input
    if (deviceName !== undefined && (!deviceName || typeof deviceName !== 'string')) {
      console.error(`[UPDATE] Invalid device name provided:`, deviceName);
      return res.status(400).json({
        success: false,
        error: 'Invalid device name',
        details: 'Device name must be a non-empty string'
      });
    }
    
    // Create backup of original device data
    const originalDevice = { ...esp32Devices[deviceId] };
    
    // Update the device
    esp32Devices[deviceId] = {
      ...esp32Devices[deviceId],
      deviceName: deviceName || esp32Devices[deviceId].deviceName,
      assignedSource: assignedSource !== undefined ? assignedSource : esp32Devices[deviceId].assignedSource,
      lastUpdate: new Date().toISOString()
    };
    
    // If a source is assigned and it's not already in tallySources, add it
    // This ensures that any source assigned to a device from the device manager
    // will be properly monitored, even if it was fetched directly from OBS
    // and wasn't previously in the monitored sources list
    if (assignedSource && !tallySources.includes(assignedSource)) {
      console.log(`[AUTO-ADD] Adding source "${assignedSource}" to monitored sources list`);
      tallySources.push(assignedSource);
      initTallyStatus(); // Reinitialize the tally status for the new source
      
      // Save the updated sources
      if (saveTallySources()) {
        console.log(`[AUTO-ADD] Sources list updated and saved to file`);
        updateTallyForSources(); // Update tally status with new source
      }
    }
    
    console.log(`[UPDATE] Device updated:`, {
      deviceId,
      oldName: originalDevice.deviceName,
      newName: esp32Devices[deviceId].deviceName,
      oldSource: originalDevice.assignedSource,
      newSource: esp32Devices[deviceId].assignedSource
    });
    
    // Save to file
    try {
      saveESP32Devices();
      console.log(`[UPDATE] Device data saved to file successfully`);
    } catch (saveError) {
      console.error(`[UPDATE] Failed to save device data:`, saveError);
      // Restore original device data
      esp32Devices[deviceId] = originalDevice;
      throw new Error(`Failed to save device data: ${saveError.message}`);
    }
    
    // Broadcast device update
    try {
      broadcastDeviceUpdate(esp32Devices[deviceId], 'device-updated');
      console.log(`[UPDATE] Device update broadcasted successfully`);
    } catch (broadcastError) {
      console.error(`[UPDATE] Failed to broadcast device update:`, broadcastError);
      // Note: Don't fail the request if broadcasting fails
    }
    
    res.json({
      success: true,
      device: esp32Devices[deviceId],
      message: 'Device updated successfully'
    });
  } catch (error) {
    console.error('Error updating device:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Internal server error while updating device',
      timestamp: new Date().toISOString()
    });
  }
});

// Delete a device
app.delete('/api/esp32/devices/:deviceId', (req, res) => {
  try {
    const { deviceId } = req.params;
    
    if (!esp32Devices[deviceId]) {
      return res.status(404).json({
        success: false,
        error: 'Device not found'
      });
    }
    
    // Store device info for broadcasting
    const device = {...esp32Devices[deviceId]};
    
    // Delete the device
    delete esp32Devices[deviceId];
    
    // Save to file
    saveESP32Devices();
    
    // Broadcast device deletion
    broadcastDeviceUpdate(device, 'device-deleted');
    
    res.json({
      success: true,
      deviceId
    });
  } catch (error) {
    console.error('Error deleting device:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Register ESP32 device endpoint (expected by ESP32 firmware)
app.post('/api/esp32/register', (req, res) => {
  try {
    const { deviceId, deviceName, ipAddress, macAddress, firmware, model, assignedSource } = req.body;
    
    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: 'Device ID is required'
      });
    }
    
    console.log(`📱 ESP32 registration request: ${deviceName} (${deviceId}) from ${ipAddress}`);
    
    // Create or update device
    const device = {
      ...esp32Devices[deviceId],
      deviceId: deviceId,
      deviceName: deviceName || `Tally ${Object.keys(esp32Devices).length + 1}`,
      macAddress: macAddress || '',
      ipAddress: ipAddress || '',
      firmware: firmware || 'unknown',
      model: model || '',
      assignedSource: assignedSource || esp32Devices[deviceId]?.assignedSource || '',
      status: 'online',
      lastSeen: new Date().toISOString(),
      createdAt: esp32Devices[deviceId]?.createdAt || new Date().toISOString(),
      lastUpdate: new Date().toISOString()
    };
    
    esp32Devices[deviceId] = device;
    
    // Save to file
    saveESP32Devices();
    
    // Broadcast device update
    broadcastDeviceUpdate(device, 'device-registered');
    
    console.log(`✅ ESP32 device registered: ${deviceName} (${deviceId})`);
    
    res.json({
      success: true,
      message: 'Device registered successfully',
      device: device
    });
  } catch (error) {
    console.error('Error registering ESP32 device:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API endpoint to discover ESP32 devices on the network
app.post('/api/esp32/discover', async (req, res) => {
  try {
    // Use local network scanner to find ESP32 devices
    console.log('Starting device discovery scan...');
    
    // Get local IP range
    const networkInterfaces = os.networkInterfaces();
    let deviceCount = 0;
    const foundDevices = [];
    
    // Use network information to scan for devices
    for (const interfaceName in networkInterfaces) {
      for (const iface of networkInterfaces[interfaceName]) {
        // Skip non-IPv4 and internal interfaces
        if (iface.family !== 'IPv4' || iface.internal) {
          continue;
        }
        
        // Extract IP parts to create IP range for scanning
        const ipParts = iface.address.split('.');
        const baseIp = `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}`;
        
        console.log(`Scanning network: ${baseIp}.0/24`);
        
        // Scan common ports that ESP32 tally devices might use (80, 3000, 8080)
        const ports = [80, 3000, 8080];
        
        // Use Promise.all for parallel scanning to improve speed
        const scanPromises = [];
        
        for (let i = 1; i <= 254; i++) {
          const ip = `${baseIp}.${i}`;
          
          for (const port of ports) {
            // Skip the server's own IP
            if (ip === iface.address) {
              continue;
            }
            
            scanPromises.push(
              new Promise(async (resolve) => {
                try {
                  // Try to connect to device API to check if it's an ESP32 tally device
                  const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), 500)
                  );
                  
                  const fetchPromise = fetch(`http://${ip}:${port}/api/device-info`, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' }
                  });
                  
                  const response = await Promise.race([fetchPromise, timeoutPromise]);
                  const data = await response.json();
                  
                  // Check if this is a tally light device by looking for expected properties
                  if (data && data.deviceId && (data.type === 'esp32-tally' || data.type === 'tally')) {
                    console.log(`Found ESP32 device at ${ip}:${port} with ID: ${data.deviceId}`);
                    
                    // Register the device if it's not already registered
                    if (!esp32Devices[data.deviceId]) {
                      // Create device record
                      const deviceData = {
                        deviceId: data.deviceId,
                        deviceName: data.deviceName || data.deviceId,
                        ipAddress: ip,
                        port: port,
                        mac: data.mac || null,
                        online: true,
                        lastSeen: new Date().toISOString()
                      };
                      
                      // Add to devices collection
                      esp32Devices[data.deviceId] = deviceData;
                      
                      // Save to persistent storage
                      saveEsp32DevicesToJson();
                      
                      // Add to found devices list
                      foundDevices.push(deviceData);
                      deviceCount++;
                    } else {
                      // Update existing device's IP address if it changed
                      if (esp32Devices[data.deviceId].ipAddress !== ip) {
                        esp32Devices[data.deviceId].ipAddress = ip;
                        esp32Devices[data.deviceId].port = port;
                        esp32Devices[data.deviceId].online = true;
                        esp32Devices[data.deviceId].lastSeen = new Date().toISOString();
                        
                        // Save changes
                        saveEsp32DevicesToJson();
                      }
                    }
                  }
                  resolve();
                } catch (error) {
                  // No device found at this IP:port or not a compatible device
                  resolve();
                }
              })
            );
          }
        }
        
        // Wait for all scan operations to complete
        await Promise.all(scanPromises);
      }
    }
    
    console.log(`Device discovery completed. Found ${deviceCount} new devices.`);
    
    // Send response with results
    res.json({
      success: true,
      devicesFound: deviceCount,
      newDevices: foundDevices
    });
    
  } catch (error) {
    console.error('Error in device discovery:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to discover devices: ' + error.message
    });
  }
});

// API endpoint for device reset
app.post('/api/esp32/reset-device/:deviceId', async (req, res) => {
  try {
    const deviceId = req.params.deviceId;
    const device = esp32Devices[deviceId];
    
    if (!device) {
      return res.status(404).json({
        success: false,
        error: 'Device not found'
      });
    }
    
    if (!device.ipAddress || device.ipAddress === 'Unknown') {
      return res.status(400).json({
        success: false,
        error: 'Device has no known IP address'
      });
    }
    
    // Send reset command to device with firmware version compatibility
    try {
      let response;
      let resetSuccess = false;
      let resetMessage = '';
      
      // First, try the new API endpoint (firmware 1.0.1+)
      try {
        response = await fetch(`http://${device.ipAddress}/api/reset`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ reset: true }),
          timeout: 5000
        });
        
        if (response.ok) {
          const data = await response.json();
          resetSuccess = data.success;
          resetMessage = data.message || 'Device reset command sent successfully (API v1.0.1+)';
        }
      } catch (apiError) {
        console.log(`[RESET] API endpoint failed for ${deviceId}, trying legacy endpoint: ${apiError.message}`);
      }
      
      // If API endpoint failed, try legacy endpoint (firmware 1.0.0)
      if (!resetSuccess) {
        try {
          response = await fetch(`http://${device.ipAddress}/reset`, {
            method: 'GET',
            timeout: 5000
          });
          
          if (response.ok) {
            resetSuccess = true;
            resetMessage = 'Device reset command sent successfully (legacy v1.0.0)';
          }
        } catch (legacyError) {
          console.log(`[RESET] Legacy endpoint also failed for ${deviceId}: ${legacyError.message}`);
        }
      }
      
      if (resetSuccess) {
        res.json({
          success: true,
          message: resetMessage
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Both API and legacy reset endpoints failed'
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: `Failed to send reset command: ${error.message}`
      });
    }
  } catch (error) {
    console.error('Error resetting device:', error);
    res.status(500).json({
      success: false,
      error: 'Server error: ' + error.message
    });
  }
});

// API endpoint for consistent device status across all pages
app.get('/api/esp32/device-status', async (req, res) => {
  try {
    const deviceList = Object.values(esp32Devices);
    const devices = [];
    let onlineDevices = 0;
    
    // Process each device in parallel for efficiency
    const devicePromises = deviceList.map(async (device) => {
      try {
        // Only attempt to check devices with an IP address
        if (!device.ipAddress) {
          return {
            deviceId: device.deviceId,
            deviceName: device.deviceName || device.deviceId,
            ipAddress: 'unknown',
            online: false,
            status: 'offline',
            lastSeen: device.lastSeen,
            error: 'No IP address available'
          };
        }
        
        // Quick health check to device using firmware info endpoint
        const response = await fetch(`http://${device.ipAddress}/api/firmware/info`, {
          timeout: 3000
        });
        
        if (response.ok) {
          onlineDevices++;
          
          return {
            deviceId: device.deviceId,
            deviceName: device.deviceName || device.deviceId,
            ipAddress: device.ipAddress,
            online: true,
            status: 'online',
            lastSeen: new Date().toISOString(),
            source: device.assignedSource || device.source,
            mac: device.macAddress
          };
        } else {
          return {
            deviceId: device.deviceId,
            deviceName: device.deviceName || device.deviceId,
            ipAddress: device.ipAddress,
            online: false,
            status: 'error',
            lastSeen: device.lastSeen,
            error: `HTTP ${response.status}: ${response.statusText}`
          };
        }
      } catch (error) {
        return {
          deviceId: device.deviceId,
          deviceName: device.deviceName || device.deviceId,
          ipAddress: device.ipAddress || 'unknown',
          online: false,
          status: 'offline',
          lastSeen: device.lastSeen,
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
    console.error('Error getting device status:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ESP32 heartbeat endpoint (expected by ESP32 firmware)
app.post('/api/heartbeat', (req, res) => {
  try {
    const { id, status, uptime, ip, assignedSource } = req.body;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Device ID is required'
      });
    }
    
    console.log(`💓 ESP32 heartbeat: ${id} - Status: ${status}, Uptime: ${uptime}s`);
    
    // Update device if it exists
    if (esp32Devices[id]) {
      const device = esp32Devices[id];
      
      // Update device properties from heartbeat
      device.status = 'online';
      device.lastSeen = new Date().toISOString();
      device.uptime = uptime;
      
      // Update IP if provided and different
      if (ip && device.ipAddress !== ip) {
        console.log(`📍 ESP32 ${id} IP updated: ${device.ipAddress} -> ${ip}`);
        device.ipAddress = ip;
      }
      
      // Update assigned source if provided
      if (assignedSource !== undefined) {
        device.assignedSource = assignedSource;
      }
      
      // Save changes periodically (not on every heartbeat to avoid excessive I/O)
      if (!device.lastHeartbeatSave || (Date.now() - new Date(device.lastHeartbeatSave).getTime()) > 60000) {
        device.lastHeartbeatSave = new Date().toISOString();
        saveESP32Devices();
      }
      
      // Get current tally status for this device's assigned source
      const currentTallyStatus = device.assignedSource ? tallyStatus[device.assignedSource] || 'IDLE' : 'IDLE';
      
      // Respond with current tally status and configuration (recording/streaming status removed)
      res.json({
        success: true,
        status: currentTallyStatus,
        assignedSource: device.assignedSource,
        deviceName: device.deviceName,
        timestamp: new Date().toISOString()
      });
    } else {
      // Device not registered
      console.log(`⚠️ ESP32 heartbeat from unregistered device: ${id}`);
      res.status(404).json({
        success: false,
        error: 'Device not registered',
        message: 'Please register the device first'
      });
    }
  } catch (error) {
    console.error('Error processing ESP32 heartbeat:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

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

// Broadcast device updates to WebSocket clients
function broadcastDeviceUpdate(device, updateType = 'device-update') {
  try {
    console.log(`[BROADCAST] Broadcasting device update: ${updateType} for ${device?.deviceId}`);
    
    if (!device) {
      console.error('[BROADCAST] Error: No device provided for broadcast');
      return;
    }
    
    const message = JSON.stringify({
      type: updateType,
      device: device,
      timestamp: new Date().toISOString()
    });
    
    // Broadcast via Socket.IO (already handled by io.emit)
    let successCount = 1; // Socket.IO handles broadcast success
    let errorCount = 0;
    
    console.log(`[BROADCAST] Message sent to ${successCount} clients, ${errorCount} errors`);
    
    // If this is a status update, also broadcast the tally status to update ESP status indicators
    if (updateType === 'device-status-update' || updateType === 'device-heartbeat') {
      broadcastTally();
    }
  } catch (error) {
    console.error('[BROADCAST] Error in broadcastDeviceUpdate:', {
      error: error.message,
      updateType,
      deviceId: device?.deviceId
    });
  }
}

// Broadcast all devices to WebSocket clients
function broadcastDeviceList() {
  const message = JSON.stringify({
    type: 'devices-update',
    devices: esp32Devices,
    timestamp: new Date().toISOString()
  });
  
  // Broadcast via Socket.IO (already handled by io.emit in calling function)
}

// Old WebSocket handler removed - now using Socket.IO

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
        
        const currentTime = new Date().toISOString();
        
        // Auto-register the device if not already registered
        if (!esp32Devices[data.deviceId]) {
          // If the device announces itself with an assignedSource, always use it
          // This ensures that devices keep their assignments even if they were deleted from the server
          const useAssignedSource = (typeof data.assignedSource === 'string' && data.assignedSource.trim() !== '');
          
          const device = {
            deviceId: data.deviceId,
            deviceName: data.deviceName,
            macAddress: data.macAddress || '',
            ipAddress: rinfo.address,
            firmware: data.firmware || 'unknown',
            assignedSource: useAssignedSource ? data.assignedSource : '',
            lastSeen: currentTime,
            status: 'online',
            autoRegistered: true,
            createdAt: currentTime
          };
          esp32Devices[data.deviceId] = device;
          saveESP32Devices();
          console.log(`✅ Auto-registered ESP32 device: ${data.deviceName} (${data.deviceId}) with assignedSource: ${device.assignedSource || 'None'}`);
          // Broadcast device registration
          broadcastDeviceUpdate(device, 'device-auto-register');
        } else {
          // Update existing device info
          const device = esp32Devices[data.deviceId];
          const wasOffline = device.status !== 'online';
          const ipChanged = device.ipAddress !== rinfo.address;
          const sourceChanged = device.assignedSource !== data.assignedSource;
          
          // Update key properties
          device.ipAddress = rinfo.address;
          device.lastSeen = currentTime;
          device.status = 'online';
          
          // Update assignedSource if the device announces with one
          if (typeof data.assignedSource === 'string') {
            device.assignedSource = data.assignedSource;
          }
          
          // Save changes and notify clients if there was a meaningful change
          if (wasOffline || ipChanged || sourceChanged) {
            saveESP32Devices();
            const changes = [];
            if (wasOffline) changes.push('now online');
            if (ipChanged) changes.push(`IP updated to ${rinfo.address}`);
            if (sourceChanged) changes.push(`source updated to '${device.assignedSource || 'None'}'`);
            
            console.log(`🔄 Device ${data.deviceName} (${data.deviceId}) announcement processed: ${changes.join(', ')}`);
            broadcastDeviceUpdate(device, wasOffline ? 'device-online' : 'device-update');
          }
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
  
  // Close WebSocket connections (Socket.IO)
  io.emit('server-shutdown', { 
    type: 'server-shutdown', 
    message: 'Server is shutting down' 
  });
  io.close();
  
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

// Test endpoint for recording control (for testing the fix only)
app.post('/api/test/recording', async (req, res) => {
  try {
    const { active } = req.body;
    
    if (typeof active !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'Invalid request. "active" must be a boolean.'
      });
    }
    
    if (!obsConnectionStatus === 'connected') {
      return res.status(503).json({
        success: false,
        error: 'OBS is not connected'
      });
    }
    
    console.log(`📋 Test API: ${active ? 'Starting' : 'Stopping'} recording`);
    
    if (active) {
      await obs.call('StartRecord');
    } else {
      await obs.call('StopRecord');
    }
    
    // Update internal recording status immediately for testing
    recordingStatus.active = active;
    if (active) {
      recordingStatus.startTime = new Date();
      recordingStatus.duration = 0;
    } else {
      recordingStatus.startTime = null;
      recordingStatus.duration = 0;
    }
    
    // Force notification to all ESP32 devices
    const forceNotify = {
      type: 'recording',
      active: active
    };
    
    // Broadcast updated status
    await broadcastTally(forceNotify);
    
    res.json({
      success: true,
      recording: active,
      message: `Recording ${active ? 'started' : 'stopped'} via test API`
    });
  } catch (error) {
    console.error('Error in test recording endpoint:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});
