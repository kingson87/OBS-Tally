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
