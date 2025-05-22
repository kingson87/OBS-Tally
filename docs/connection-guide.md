# OBS Tally - Connection Guide

This guide explains the connection system used by OBS Tally and how to interpret different connection states.

## Understanding the Two Connection System

OBS Tally uses a two-stage connection system:

```
[Browser] ⟷ [Tally Server] ⟷ [OBS Studio]
  Connection 1     Connection 2
```

### Connection 1: Browser to Tally Server
- This is the WebSocket connection between your web browser and the Node.js tally server
- When successful, you'll see "Connected to server" in the status bar
- Console will show: "[SUCCESS] Connected to server WebSocket"
- This connection only means you can communicate with the tally server

### Connection 2: Tally Server to OBS
- This is the WebSocket connection between the Node.js tally server and OBS Studio
- When successful, you'll see "Connected to OBS" in the status bar
- This connection is necessary for getting tally data from OBS

## Connection States

### Fully Connected (Working State)
- Status: "Connected to OBS"
- Both connections are established
- Tally lights will update in real-time based on OBS scenes

### Partially Connected
- Status: "Connected to server, waiting for OBS..."
- Your browser is connected to the tally server
- The tally server cannot connect to OBS
- This is normal if:
  - OBS is not running
  - WebSocket Server is not enabled in OBS
  - Wrong WebSocket address/password
  - Network issues between tally server and OBS

### Fully Disconnected
- Status: "Server disconnected"
- Your browser cannot connect to the tally server
- This indicates a problem with the tally server itself
- Check if the Node.js server is running

## Common Issues and Solutions

### "Connected to server, waiting for OBS..."
1. **OBS not running**: Start OBS Studio
2. **WebSocket Server not enabled**: In OBS, go to Tools → WebSocket Server Settings and enable it
3. **Wrong address/port**: Check the WebSocket address in tally settings (default: ws://127.0.0.1:4455)
4. **Password mismatch**: Ensure the password in tally settings matches OBS WebSocket settings
5. **Firewall blocking**: Check if your firewall is blocking the WebSocket port

### "Server disconnected"
1. **Server not running**: Make sure the Node.js tally server is running
2. **Network issues**: Check your network connection
3. **Wrong server address**: Make sure you're accessing the correct URL for the tally server

## Using the Diagnostics Page

The diagnostics page at `/diagnostics.html` provides detailed information about both connections:

- **Server WebSocket**: Shows the status of Connection 1 (browser to server)
- **OBS WebSocket**: Shows the status of Connection 2 (server to OBS)
- **Connection Flow**: Visual representation of both connections
- **Logs**: Real-time connection log messages

## Console Messages

Console messages in the developer tools can help diagnose connection issues:

- `[SUCCESS] Connected to server WebSocket (still waiting for OBS connection)` - Connection 1 successful, Connection 2 pending
- `[SUCCESS] OBS WebSocket connection established` - Connection 2 successful

Remember: Both connections must be successful for the tally system to work properly.
