## Windows Launcher

For Windows users, a double-click batch launcher is provided:

### 🚀 Start OBS Tally.bat
- **Usage**: Double-click to launch the tally system
- **Features**:
  - **Background Operation**: Server runs in a new window
  - **Auto-Launch**: Opens web browser to the tally interface immediately
  - **Process Management**: Stores server PID in `.server.pid` for easy shutdown
  - **Remote Shutdown**: Stop server gracefully via web settings or with the batch script
  - **Persistent Operation**: Server continues running even after closing browser
- **Perfect for**: Daily use, studio environments, and hands-off operation

### 🔧 Server Management (Windows)
- **Start**: Double-click `Start OBS Tally.bat`
- **Stop**: Use the shutdown button in Settings page or double-click `Stop OBS Tally.bat` (kills the server using the PID file)
- **Status**: Check if server is running:
  - Open Task Manager and look for `node index.js` under Background processes

# OBS Tally

A web-based tally light system that displays the live/preview status of camera sources from OBS Studio using the obs-websocket plugin. Features a Node.js backend with real-time WebSocket communication and a responsive Progressive Web App frontend.

## Features

### Core Functionality
- 🔴 **Live Tally Indicators** - Red light when source is in Program (LIVE)
- 🟡 **Preview Indicators** - Amber light when source is in Preview 
- ⚪ **Idle Status** - Gray light when source is inactive
- 📱 **Mobile-Optimized** - Responsive design works on phones, tablets, and desktop
- 🌐 **Network Access** - Connect from any device on your local network
- ⚡ **Real-time Updates** - Instant status changes via WebSocket connection

### Advanced Features
- 🔧 **Easy Configuration** - Web-based settings panel for OBS connection
- 🔄 **Auto-Reconnect** - Automatic recovery from connection drops
- 🌙 **Dark/Light Modes** - Optimized for different studio lighting conditions
- 📊 **Diagnostics** - Built-in troubleshooting tools and connection monitoring
- 💾 **Settings Persistence** - Your configuration is saved locally
- 📱 **PWA Support** - Install as a native app on mobile devices
- 🎯 **Multiple Sources** - Monitor unlimited camera/source feeds
- 🚀 **Smart Port Management** - Automatically handles port conflicts
- 🔄 **Background Operation** - Server runs in background mode for seamless use
- 🛑 **Remote Shutdown** - Gracefully stop the server from any connected device
- 🍎 **macOS Native Design** - Beautiful interface following macOS design principles
🔗 **Easy Mobile Connect** - Scan a QR code or use a link to connect your phone
📋 **Stacked URL & Copy Button** - Clean, vertical layout for server URL and copy button
🍎 **macOS Native Design** - Beautiful interface following macOS design principles

## Quick Setup

### Prerequisites
- OBS Studio with obs-websocket plugin (included in OBS 28+)
- Node.js installed on your system

### Installation

#### Option A: macOS Quick Setup (Recommended)
1. **Clone the repository:**
   ```bash
   git clone https://github.com/kingson87/OBS-Tally.git
   cd OBS-Tally
   ```

2. **Run the installer:**
   ```bash
   ./install-macos.sh
   ```
   This sets up everything you need!

3. **Launch OBS Tally:**
   Simply double-click `Start OBS Tally.command` - the server starts and your browser opens automatically!

#### Option B: Standard Installation
1. **Clone and install dependencies:**
   ```bash
   git clone https://github.com/kingson87/OBS-Tally.git
   cd OBS-Tally
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```
   Or directly with Node.js:
   ```bash
   node index.js
   ```

3. **Access the web interface:**
   Open your browser to `http://localhost:3005`

4. **Configure OBS connection:**
   - Click the gear icon ⚙️ to open settings
   - Verify the WebSocket address (default: `ws://127.0.0.1:4455`)
   - Add your camera source names (comma-separated)
   - Save settings

### OBS Studio Setup
1. Open OBS Studio
2. Go to **Tools** → **obs-websocket Settings**
3. Ensure **Enable WebSocket server** is checked
4. Note the Server Port (default: 4455)
5. Set a password if desired (optional but recommended for security)

## Usage

### Web Interface
The main interface shows your configured camera sources with color-coded status:
- 🔴 **Red** = Source is LIVE (in Program)
- 🟡 **Amber** = Source is in PREVIEW  
- ⚪ **Gray** = Source is IDLE

### Settings Panel
Access via the gear icon ⚙️:
- **OBS WebSocket Address**: The WebSocket URL (default: `ws://127.0.0.1:4455`)
- **Password**: Enter if you've secured your OBS WebSocket server
- **Monitor Sources**: Comma-separated list of OBS source names to track
- **Theme**: Toggle between light and dark modes
- **Connection Status**: Real-time status of server and OBS connections
- **Diagnostic Tools**: Quick troubleshooting and connection verification
- **Server Control**: Gracefully shutdown the server remotely with confirmation

### Additional Features
- **📊 Diagnostics**: Visit `/diagnostics.html` for connection troubleshooting
- **🖥️ Fullscreen Mode**: Visit `/fullscreen.html` for a clean, distraction-free view
- **📱 Mobile Install**: Use your browser's "Add to Home Screen" option
- **🛑 Remote Shutdown**: Stop the server from any connected device via Settings
- **🔗 Mobile Connect UI**: Scan a QR code or copy a link to connect your phone instantly. The server URL and copy button are now stacked vertically for clarity and ease of use, matching macOS design language.

## macOS Launcher

For macOS users, we provide a simple double-click launcher:

### 🚀 Start OBS Tally.command
- **Usage**: Double-click to launch the tally system
- **Features**:
  - **Background Operation**: Server runs automatically in the background
  - **Auto-Launch**: Opens web browser to the tally interface immediately
  - **Process Management**: Stores server PID for easy monitoring and control
  - **Remote Shutdown**: Stop server gracefully via web settings or terminal
  - **Persistent Operation**: Server continues running even after closing browser
- **Perfect for**: Daily use, studio environments, and hands-off operation

### 🔧 Server Management (macOS)
- **Start**: Double-click `Start OBS Tally.command`
- **Stop**: Use the shutdown button in Settings page or run:
  ```bash
  # Stop server if PID file exists
  if [ -f .server.pid ]; then kill $(cat .server.pid) && rm .server.pid; fi
  ```
- **Status**: Check if server is running:
  ```bash
  # Check if server process is active
  ps aux | grep "node index.js" | grep -v grep
  ```

### 📂 Setup
The `install-macos.sh` script handles everything:
- Checks for Node.js installation
- Installs all dependencies
- Tests the server
- Creates the launcher file

## Configuration

### Environment Variables
- `PORT`: Set a custom port (default: 3005)
  ```bash
  PORT=8080 node index.js
  ```

### Network Access
To access from other devices on your network:
1. Find your computer's IP address
2. Replace `localhost` with your IP: `http://192.168.1.100:3005`
3. Ensure your firewall allows connections on the chosen port

## Development

### Project Structure
```
├── index.js              # Main server application
├── package.json           # Dependencies and scripts
├── obs-config.json        # OBS connection configuration
├── public/               # Web frontend files
│   ├── index.html        # Main tally interface
│   ├── settings.html     # Configuration panel
│   ├── diagnostics.html  # Connection troubleshooting
│   ├── fullscreen.html   # Clean fullscreen view
│   └── manifest.json     # PWA configuration
└── docs/                 # Documentation
    ├── user-guide.md     # Detailed usage instructions
    └── connection-guide.md # Connection troubleshooting
```

### Technology Stack
- **Backend**: Node.js, Express.js, obs-websocket-js
- **Frontend**: Vanilla JavaScript, WebSocket API, CSS3
- **Real-time Communication**: WebSocket (ws library)
- **PWA Features**: Service Worker, Web App Manifest

## Troubleshooting

### Common Issues

**🔌 Connection Problems**
1. Verify OBS Studio is running
2. Check that obs-websocket is enabled in **Tools** → **obs-websocket Settings**
3. Confirm the WebSocket address and port match OBS settings
4. Test the connection using the diagnostics page (`/diagnostics.html`)

**🚫 Port Already in Use**
The server automatically attempts to clear port conflicts. If issues persist:
```bash
# Kill any process using port 3005
lsof -ti:3005 | xargs kill -9

# Or use a different port
PORT=8080 node index.js
```

**📱 Mobile Access Issues**
- Ensure your mobile device is on the same network
- Use your computer's IP address instead of `localhost`
- Check firewall settings on your computer

**⚡ Performance Issues**
- Close unnecessary browser tabs
- Reduce the number of monitored sources
- Use a wired network connection when possible

### Understanding Connection States

The system manages two separate connections:

1. **🌐 Browser ↔ Tally Server**: Shows as "Connected to server"
2. **📺 Tally Server ↔ OBS**: Shows as "Connected to OBS"

Both must be active for the system to work properly. The diagnostics page provides detailed information about each connection.

### Getting Help

For detailed troubleshooting steps, see:
- 📖 [User Guide](docs/user-guide.md) - Complete usage instructions
- 🔧 [Connection Guide](docs/connection-guide.md) - Detailed connection troubleshooting

## Contributing

We welcome contributions! Please:
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [obs-websocket-js](https://github.com/obs-websocket-community-projects/obs-websocket-js)
- Inspired by professional broadcast tally systems
- Thanks to the OBS Studio community

## Roadmap

### Upcoming Features
- 🔐 Authentication for public network deployment
- 📱 M5Stack hardware tally light support
- 🎨 Custom theme support
- 📈 Usage analytics and monitoring
- 🔊 Audio cue support
- 🌍 Multi-language support

### Version History
- **v1.2.0** - Background operation mode and remote shutdown
  - Server runs in background with PID tracking
  - Remote shutdown via web interface with confirmation
  - Enhanced settings panel with connection diagnostics
  - macOS native design improvements
- **v1.1.0** - Enhanced diagnostics and PWA features
  - Comprehensive connection troubleshooting tools
  - Progressive Web App support
  - Improved error handling and reconnection logic
- **v1.0.0** - Initial release with core tally functionality
  - Real-time tally light indicators
  - WebSocket communication
  - Responsive web interface
