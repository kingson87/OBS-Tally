#!/bin/bash

# Create a LaunchAgent for auto-starting OBS Tally

PLIST_FILE="$HOME/Library/LaunchAgents/com.kingson87.obs-tally.plist"
CURRENT_DIR="$(pwd)"

echo "Creating LaunchAgent for OBS Tally..."

# Create the plist file
cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.kingson87.obs-tally</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>$CURRENT_DIR/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$CURRENT_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/obs-tally.log</string>
    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/obs-tally.log</string>
</dict>
</plist>
EOF

echo "✅ LaunchAgent created at: $PLIST_FILE"
echo ""
echo "To use the LaunchAgent:"
echo "📍 Load it:    launchctl load '$PLIST_FILE'"
echo "🛑 Unload it:  launchctl unload '$PLIST_FILE'"
echo "📊 Check status: launchctl list | grep obs-tally"
echo ""
echo "💡 The service will auto-start on login when loaded!"
echo "📝 Logs will be saved to: ~/Library/Logs/obs-tally.log"
