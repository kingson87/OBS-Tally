# OBS Tally

This project provides a web-based tally light system that displays the status of camera/sources from OBS using the obs-websocket plugin. It consists of a Node.js backend and a responsive HTML/JavaScript frontend for real-time tally status updates.

## Features
- Connects to OBS via obs-websocket-js
- WebSocket server for real-time updates
- Responsive mobile-friendly UI to display tally status
- Multiple camera/source support
- Configuration UI for OBS WebSocket settings
- Live/Preview/Idle status indicators
- OBS connection status monitoring with auto-reconnect
- Client-side settings persistence using local storage
- Light and dark mode for different studio environments
- Diagnostic tools for troubleshooting connections
- Progressive Web App support for offline access
- Easily accessible from any device on the local network
- Automatic port selection if default port is in use

## Quick Setup
The easiest way to get started is to use the included install script:

```sh
# Make the script executable (first time only)
chmod +x install.sh

# Run the installation
./install.sh
```

Once installed, you can launch the application using the setup script:

```sh
# Make the script executable (first time only)
chmod +x setup.sh

# Run the setup script
./setup.sh
```

Alternatively, you can use npm:

```sh
# Install dependencies
npm install

# Start the server
npm start
```

## Manual Setup
1. Ensure OBS is running with the obs-websocket plugin enabled.
2. Install dependencies:
   ```sh
   npm install
   ```
3. Start the server:
   ```sh
   node index.js
   ```
4. Open your browser to `http://localhost:3000` to view the tally light status.
5. Click the gear icon to configure the OBS WebSocket connection settings and camera sources.

## Configuration
- **OBS WebSocket Address**: Set the WebSocket URL (default: ws://127.0.0.1:4455)
- **Password**: Optional password if you've secured your OBS WebSocket server
- **Monitor Sources**: Comma-separated list of OBS source names to monitor

### Server Port
By default, the tally server runs on port 3000. If this port is in use:
1. The server will automatically try the next available port (3001, 3002, etc.)
2. You can manually specify a port using the PORT environment variable:
   ```
   PORT=8080 node index.js
   ```

## Desktop Application
This project can also be run as a desktop application using Electron:

```sh
# Run as desktop app on macOS
npm run macapp

# Run as desktop app on Windows
npm run winapp
```

### Building Distributable Applications

You can package the application for distribution on macOS and Windows:

```sh
# Package for macOS
npm run package-mac
# or
npm run build-mac

# Package for Windows
npm run package-win
# or
npm run build-win

# Package for both platforms
npm run package-all
# or
npm run build
```

The setup script also includes options for packaging:

```sh
# Run the setup script and choose packaging options
./setup.sh
```

## To Do
- Prepare for M5Stack Plus2 adaptation
- Add authentication for public networks

## Troubleshooting

If you experience connection issues:

1. Visit the diagnostics page at `/diagnostics.html`
2. Verify that OBS Studio is running and the WebSocket Server is enabled in Tools > WebSocket Server Settings
3. Check that the WebSocket address matches the one configured in OBS
4. If using a password, ensure it matches what's set in OBS
5. Check network/firewall settings if connecting from a different machine
6. Use the "Force Reconnect" button to reinitiate the connection

### Understanding Connection States

The system has two separate connections:
1. **Browser to Tally Server**: Shown as "Connected to server" when your browser can reach the Node.js tally server
2. **Tally Server to OBS**: Shown as "Connected to OBS" when the tally server successfully connects to OBS

If you see a console message "[SUCCESS] Connected to server WebSocket", this only means your browser is connected to the tally server - it does NOT mean OBS is connected. You must check the "OBS WebSocket" status in the diagnostics page or look for "Connected to OBS" in the connection status area to confirm the full system is working.

If you see "Connected to server, waiting for OBS..." this means your browser is successfully connected to the tally server, but the server cannot connect to OBS. This is normal if OBS is not running or the WebSocket Server is not enabled.

For detailed connection information, see the [connection guide](docs/connection-guide.md).

For more detailed help, see the [user guide](docs/user-guide.md).
