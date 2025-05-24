@echo off
REM Windows launcher for OBS Tally

REM Start the Node.js server in the background and save the PID
start "OBS Tally Server" cmd /c "node index.js > server.log 2>&1"

REM Wait a moment to let the server start
ping 127.0.0.1 -n 3 > nul

REM Open the default browser to the tally interface
start "" http://localhost:3005

echo OBS Tally server started. You can close this window.
