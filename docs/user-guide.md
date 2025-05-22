# OBS Tally - User Guide

## Overview
OBS Tally is a web-based tally light system for OBS that displays the live/preview status of camera sources. This guide covers setup and usage of all features.

## Installation and Setup

### Quick Start
1. Run the setup script:
   ```
   ./setup.sh
   ```
2. Choose your preferred installation method
3. Access via web browser at http://localhost:3000

### Connecting to OBS
1. Make sure OBS is running with the obs-websocket plugin enabled
2. In OBS, go to Tools → obs-websocket Settings
3. Ensure the WebSocket server is enabled (default port is 4455)
4. If you set a password in OBS, you'll need to enter it in the Tally Web settings

## Features

### Tally Light Display
- **Red light** - Source is active in the Program scene (LIVE)
- **Amber light** - Source is active in the Preview scene (PREVIEW)
- **Gray light** - Source is not visible in Program or Preview (IDLE)

### Settings Configuration
Click the gear icon in the top right to access settings:
- **WebSocket Address** - The OBS WebSocket URL (default: ws://127.0.0.1:4455)
- **Password** - Your OBS WebSocket password (if set)
- **Monitor Sources** - Comma-separated list of sources to monitor

### Connection Status
The connection indicator in the top right shows the status of your connection:
- **Green** - Connected to OBS
- **Amber** - Connected to server, connecting to OBS
- **Red** - Connected to server, but disconnected from OBS

### Understanding Connection States
The system has two separate connections:
1. **Browser to Tally Server**: Your web browser connects to the Node.js tally server
2. **Tally Server to OBS**: The tally server connects to OBS WebSocket

**Important Note**: If you see a console message "[SUCCESS] Connected to server WebSocket", this only means your browser is connected to the tally server - it does NOT mean OBS is connected. Always check the status indicator in the UI to see if the system is fully connected to OBS.

Connection status in the UI will show:
- "Connected to server, waiting for OBS..." - Server connection successful, but OBS connection pending
- "Connected to OBS" - Both connections are successful
- "OBS Disconnected" - Server connection successful, but OBS connection failed

If you see "Connected to server, waiting for OBS..." this is normal if OBS is not running or the WebSocket Server is not enabled.

### Dark Mode
Click the sun/moon icon in the top left to toggle between light and dark mode:
- **Light mode** - Better for bright environments
- **Dark mode** - Better for low-light studio environments

## Network Usage
- Access from other devices on the same network by entering the server's IP address and port in a browser (e.g., http://192.168.1.5:3000)
- For remote access over the internet, consider using a VPN or SSH tunnel for security

## Common Issues
- **Server shows connected but "Waiting for OBS"**: This is normal if OBS is not running. The tally server is working correctly, but OBS is not available.
- **Cannot connect to OBS**: Check that OBS is running and WebSocket Server is enabled in Tools > WebSocket Server Settings
- **Connection refused error**: Make sure the WebSocket address matches what's configured in OBS and the port isn't blocked by a firewall
- **Authentication error**: Double-check that the password in the tally settings matches what's set in OBS
- **Intermittent disconnections**: Check your network stability or try a wired connection if using Wi-Fi
- **Source not showing status**: Ensure the source name in settings exactly matches the name in OBS
- **Connection keeps dropping**: Check your network stability or firewall settings

## Desktop Application
If you've installed the desktop application:
1. Launch "OBS Tally" from your Applications folder
2. The app will automatically start the server and open the interface
3. Settings are automatically saved between sessions
