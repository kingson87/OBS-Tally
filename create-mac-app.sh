#!/bin/bash

# Create macOS App Bundle for OBS Tally
APP_NAME="OBS Tally"
APP_DIR="$APP_NAME.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

echo "Creating macOS App Bundle for OBS Tally..."

# Clean up any existing app bundle
rm -rf "$APP_DIR"

# Create directory structure
mkdir -p "$MACOS_DIR"
mkdir -p "$RESOURCES_DIR"

# Create Info.plist
cat > "$CONTENTS_DIR/Info.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>obs-tally-launcher</string>
    <key>CFBundleIdentifier</key>
    <string>com.kingson87.obs-tally</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>OBS Tally</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleIconFile</key>
    <string>icon</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.12</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSUIElement</key>
    <false/>
</dict>
</plist>
EOF

# Create launcher script
cat > "$MACOS_DIR/obs-tally-launcher" << 'EOF'
#!/bin/bash

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
PROJECT_DIR="$APP_DIR"

# Change to project directory
cd "$PROJECT_DIR"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    osascript -e 'display alert "Node.js Required" message "Please install Node.js from nodejs.org to run OBS Tally." buttons {"OK"} default button "OK"'
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    osascript -e 'display alert "Installing Dependencies" message "First time setup - installing required packages..." buttons {"OK"} default button "OK"'
    npm install
fi

# Start the server
echo "Starting OBS Tally Server..."
node index.js &
SERVER_PID=$!

# Wait a moment for server to start
sleep 2

# Open the web interface
open "http://localhost:3005"

# Show notification
osascript -e 'display notification "OBS Tally is now running at http://localhost:3005" with title "OBS Tally Started"'

# Keep the app running
wait $SERVER_PID
EOF

# Make launcher executable
chmod +x "$MACOS_DIR/obs-tally-launcher"

# Copy icon if it exists
if [ -f "public/icon_256.png" ]; then
    cp "public/icon_256.png" "$RESOURCES_DIR/icon.png"
elif [ -f "public/icon.png" ]; then
    cp "public/icon.png" "$RESOURCES_DIR/icon.png"
fi

echo "✅ macOS App Bundle created: $APP_DIR"
echo "📱 You can now:"
echo "   1. Double-click '$APP_DIR' to launch"
echo "   2. Drag it to Applications folder"
echo "   3. Add to Dock for easy access"
echo ""
echo "🚀 To test: double-click the app bundle now!"
