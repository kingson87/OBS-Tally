#!/bin/bash

# Create Automator Application for OBS Tally

echo "Creating Automator-based OBS Tally App..."

# Create the automator workflow
AUTOMATOR_SCRIPT='
on run {input, parameters}
    set projectPath to "'"$(pwd)"'"
    
    # Check if Node.js is installed
    try
        do shell script "which node"
    on error
        display alert "Node.js Required" message "Please install Node.js from nodejs.org" buttons {"OK"}
        return
    end try
    
    # Start the server
    try
        do shell script "cd " & quoted form of projectPath & " && npm start > /dev/null 2>&1 &"
        delay 2
        
        # Open browser
        open location "http://localhost:3005"
        
        display notification "OBS Tally started successfully!" with title "OBS Tally"
        
    on error errorMsg
        display alert "Error" message errorMsg buttons {"OK"}
    end try
    
    return input
end run
'

# Save as a simple shell script wrapper
cat > "Start OBS Tally.command" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"

echo "🚀 Starting OBS Tally Server..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install from nodejs.org"
    read -p "Press Enter to exit..."
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Start server
echo "🌐 Starting server on http://localhost:3005"
npm start &
SERVER_PID=$!

# Wait and open browser
sleep 3
open "http://localhost:3005"

echo "✅ OBS Tally is running!"
echo "🌐 Web interface: http://localhost:3005"
echo "🛑 Press Ctrl+C to stop the server"

# Wait for user to stop
wait $SERVER_PID
EOF

chmod +x "Start OBS Tally.command"

echo "✅ Created 'Start OBS Tally.command'"
echo "📱 Double-click this file to start OBS Tally"
echo ""
