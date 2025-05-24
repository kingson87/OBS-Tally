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

# Start server in background
echo "🌐 Starting server on http://localhost:3005"
nohup npm start > /dev/null 2>&1 &
SERVER_PID=$!

# Store PID for later reference
echo $SERVER_PID > .server.pid

# Wait for server to start
sleep 3

# Check if server is running
if kill -0 $SERVER_PID 2>/dev/null; then
    echo "✅ OBS Tally is running in background!"
    echo "🌐 Web interface: http://localhost:3005"
    echo "📝 Server PID: $SERVER_PID"
    echo ""
    echo "To stop the server:"
    echo "  • Use the shutdown button in Settings"
    echo "  • Or run: kill $SERVER_PID"
    
    # Open browser
    open "http://localhost:3005"
    
    # Give browser a moment to open
    sleep 2
    
    echo "🎉 Launch complete! Terminal will close automatically."
    
    # Close terminal window automatically
    exit 0
else
    echo "❌ Failed to start server"
    read -p "Press Enter to exit..."
    exit 1
fi
