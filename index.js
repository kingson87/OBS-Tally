// (moved below app initialization)
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const OBSWebSocket = require('obs-websocket-js').default;
const fs = require('fs');
const path = require('path');
const net = require('net');

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
    updateTallyForSources();
  });
  
  obs.on('CurrentPreviewSceneChanged', data => {
    currentPreviewScene = data.sceneName;
    updateTallyForSources();
  });
  
  obs.on('Identified', async () => {
    try {
      const { currentProgramSceneName } = await obs.call('GetCurrentProgramScene');
      const { currentPreviewSceneName } = await obs.call('GetCurrentPreviewScene');
      currentScene = currentProgramSceneName;
      currentPreviewScene = currentPreviewSceneName;
      updateTallyForSources();
    } catch (err) {
      console.error('Error getting current scene:', err.message);
    }
  });
}
setupOBSHandlers();

// Helper to check if each source is visible in the current program or preview scene
async function updateTallyForSources() {
  if (!currentScene) return;
  try {
    const { sceneItems: programItems } = await obs.call('GetSceneItemList', { sceneName: currentScene });
    let previewItems = [];
    if (currentPreviewScene) {
      const previewRes = await obs.call('GetSceneItemList', { sceneName: currentPreviewScene });
      previewItems = previewRes.sceneItems;
    }
    tallySources.forEach(source => {
      const inProgram = programItems.find(item => item.sourceName === source && item.sceneItemEnabled);
      const inPreview = previewItems.find(item => item.sourceName === source && item.sceneItemEnabled);
      if (inProgram) {
        tallyStatus[source].status = 'Live';
      } else if (inPreview) {
        tallyStatus[source].status = 'Preview';
      } else {
        tallyStatus[source].status = 'Idle';
      }
    });
    broadcastTally();
  } catch (err) {
    console.error('Error checking source visibility:', err.message);
  }
}

function broadcastTally() {
  // Only include obsConnectionError in the status update when actually disconnected
  // This reduces duplicate notifications
  const msg = JSON.stringify({ 
    sources: tallySources, 
    status: tallyStatus,
    obsConnectionStatus,
    obsConnectionError: obsConnectionStatus === 'disconnected' ? obsConnectionError : null,
    timestamp: new Date().toISOString() // Add timestamp for client-side verification
  });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}


// API to get/set sources
app.use(express.json());
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
  const info = {
    ...systemInfo,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
    obsConnectionStatus
  };
  res.json(info);
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

wss.on('connection', ws => {
  // Send initial state including OBS connection status
  ws.send(JSON.stringify({ 
    sources: tallySources, 
    status: tallyStatus,
    obsConnectionStatus,
    obsConnectionError,
    serverConnected: true,
    timestamp: new Date().toISOString()
  }));
  
  // Track client connections
  console.log('Client connected to tally server WebSocket. Total clients:', wss.clients.size);
  console.log('OBS connection status:', obsConnectionStatus === 'connected' ? 'Connected to OBS' : 'Not connected to OBS');
  
  ws.on('close', () => {
    console.log('Client disconnected from tally server. Total clients:', wss.clients.size);
  });
});

// Function to start the server on the specified port
async function startServer() {
  try {
    console.log(`Checking if port ${PORT} is available...`);
    const isAvailable = await checkPort(PORT);
    
    if (!isAvailable) {
      console.log(`Port ${PORT} is in use, attempting to clear it...`);
      await killProcessOnPort(PORT);
      
      // Wait a moment for the process to be killed
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check again if port is now available
      const isNowAvailable = await checkPort(PORT);
      if (!isNowAvailable) {
        console.error(`Error: Port ${PORT} is still in use after attempting to clear it`);
        process.exit(1);
      }
      console.log(`Port ${PORT} is now available`);
    }

    server.listen(PORT, () => {
      console.log(`Server started on port ${PORT}`);
      console.log(`Open http://localhost:${PORT} in your browser`);
      
      // Try to connect to OBS, but don't let it fail the server start
      try {
        connectOBS().catch(err => {
          console.log(`OBS connection failed, but server is still running: ${err.message}`);
        });
      } catch (obsErr) {
        console.log(`OBS connection error caught, but server will continue: ${obsErr.message}`);
      }
    }).on('error', (err) => {
      console.error(`❌ Server error:`, err.message);
      process.exit(1);
    });
  } catch (err) {
    console.error(`❌ Unexpected error starting server:`, err.message);
    process.exit(1);
  }
}

// Start the server
startServer();
