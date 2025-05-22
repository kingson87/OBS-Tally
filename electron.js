const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow;
let serverProcess;
let serverPort = 3000; // Default port
let maxPortAttempts = 10;
let serverStarted = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    title: 'OBS Tally',
    backgroundColor: '#f7f7fa',
    resizable: false,
    icon: path.join(__dirname, 'public', process.platform === 'win32' ? 'icon.ico' : 'icon.icns')
  });
  
  // Start server and load appropriate URL
  startServerAndLoadApp();
  
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (serverProcess) {
      console.log('Shutting down server process...');
      serverProcess.kill();
    }
  });
}

function startServerAndLoadApp() {
  startServer();
  // Wait for server to start before loading URL
  checkServerAndLoadApp();
}

function startServer() {
  // Start the Node.js server with environment variables to allow automatic port selection
  const env = { ...process.env, ELECTRON_RUN: '1' };
  
  serverProcess = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    stdio: ['ignore', 'pipe', 'pipe'], // We'll capture stdout to parse the port
    env: env
  });
  
  // Handle server output to detect port
  serverProcess.stdout.on('data', (data) => {
    const output = data.toString();
    console.log('Server output:', output);
    
    // Look for the port in server output
    const portMatch = output.match(/running at http:\/\/localhost:(\d+)/);
    if (portMatch && portMatch[1]) {
      serverPort = parseInt(portMatch[1]);
      console.log(`Server detected on port ${serverPort}`);
      serverStarted = true;
    }
  });
  
  serverProcess.stderr.on('data', (data) => {
    console.error('Server error:', data.toString());
  });
  
  serverProcess.on('error', (err) => {
    console.error('Failed to start server:', err);
    dialog.showErrorBox(
      'Server Error',
      `Failed to start the tally server: ${err.message}`
    );
    app.quit();
  });
  
  serverProcess.on('exit', (code) => {
    console.log(`Server process exited with code ${code}`);
    if (code !== 0 && mainWindow) {
      dialog.showErrorBox(
        'Server Stopped',
        `The tally server stopped unexpectedly with code ${code}. The application will now close.`
      );
      app.quit();
    }
  });
}

function checkServerAndLoadApp() {
  let attempts = 0;
  const maxAttempts = 30; // Wait up to 15 seconds
  
  const checkInterval = setInterval(() => {
    attempts++;
    
    if (serverStarted) {
      clearInterval(checkInterval);
      console.log(`Loading application at http://localhost:${serverPort}`);
      mainWindow.loadURL(`http://localhost:${serverPort}`);
      return;
    }
    
    // Try a specific port check if we haven't detected from logs
    if (attempts % 2 === 0) {
      http.get(`http://localhost:${serverPort}`, (res) => {
        if (res.statusCode === 200) {
          clearInterval(checkInterval);
          console.log(`Server responded on port ${serverPort}`);
          mainWindow.loadURL(`http://localhost:${serverPort}`);
        }
      }).on('error', () => {
        // Still waiting...
      });
    }
    
    if (attempts >= maxAttempts) {
      clearInterval(checkInterval);
      dialog.showErrorBox(
        'Server Error',
        'Could not connect to the tally server. Please check if port 3000 (or another port) is available.'
      );
      app.quit();
    }
  }, 500);
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
