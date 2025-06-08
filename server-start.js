// server-start.js - A wrapper script to start the OBS Tally server with robust error handling
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Set up a logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Create a log file with timestamp
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logFile = path.join(logsDir, `server-${timestamp}.log`);
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

console.log(`Starting OBS Tally server. Logs will be written to: ${logFile}`);

// Start the actual server process
const server = spawn('node', ['index.js'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  cwd: __dirname
});

// Pipe the output to both the console and the log file
server.stdout.pipe(process.stdout);
server.stderr.pipe(process.stderr);
server.stdout.pipe(logStream);
server.stderr.pipe(logStream);

// Handle server process events
server.on('error', (error) => {
  console.error('Failed to start OBS Tally server:', error);
  logStream.write(`ERROR: ${error.toString()}\n`);
  process.exit(1);
});

server.on('exit', (code, signal) => {
  const exitMessage = `OBS Tally server exited with code ${code} and signal ${signal}`;
  
  if (code === 0) {
    console.log(exitMessage);
    logStream.write(`${exitMessage}\n`);
  } else {
    console.error(exitMessage);
    logStream.write(`ERROR: ${exitMessage}\n`);
  }
  
  logStream.end();
});

// Handle wrapper script termination
process.on('SIGINT', () => {
  console.log('Stopping OBS Tally server...');
  logStream.write('Received SIGINT, stopping server\n');
  server.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log('Stopping OBS Tally server...');
  logStream.write('Received SIGTERM, stopping server\n');
  server.kill('SIGTERM');
});

console.log(`OBS Tally server process started with PID: ${server.pid}`);
logStream.write(`Server started with PID: ${server.pid}\n`);
