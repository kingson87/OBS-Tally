#!/bin/zsh
cd "$(dirname "$0")"

# Terminal colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Print header
printf "\n${BOLD}${BLUE}┌───────────────────────────────────┐${NC}\n"
printf "${BOLD}${BLUE}│       OBS Tally Light System       │${NC}\n"
printf "${BOLD}${BLUE}└───────────────────────────────────┘${NC}\n\n"

echo "${BOLD}🚀 Starting OBS Tally Server...${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "${RED}❌ Node.js not found.${NC}"
    echo "${YELLOW}Please install from nodejs.org${NC}"
    echo
    read "?Press Enter to exit..."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d 'v' -f 2)
NODE_MAJOR=$(echo $NODE_VERSION | cut -d '.' -f 1)

# Check if server-start.js exists
if [ ! -f "server-start.js" ]; then
    echo "${YELLOW}⚠️ Using direct start method - no error handler available${NC}"
else
    echo "${GREEN}✅ Using enhanced error handling and logging${NC}"
    USE_WRAPPER=true
fi

if [ $NODE_MAJOR -lt 16 ]; then
    echo "${YELLOW}⚠️  Warning: Node.js version $NODE_VERSION detected.${NC}"
    echo "${YELLOW}   Recommended version is 16.x or newer.${NC}"
    echo
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "${BLUE}📦 Installing dependencies...${NC}"
    npm install --no-fund --loglevel=error || {
        echo "${RED}❌ Failed to install dependencies.${NC}"
        echo "${YELLOW}Try running 'npm install' manually.${NC}"
        echo
        read "?Press Enter to exit..."
        exit 1
    }
    echo "${GREEN}✅ Dependencies installed successfully.${NC}"
fi

# Check if port 3005 is already in use
if lsof -i:3005 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "${YELLOW}⚠️  Port 3005 is already in use.${NC}"
    echo "${YELLOW}   OBS Tally might already be running.${NC}"
    
    # Ask if user wants to terminate existing process
    echo
    read "response?${BOLD}Would you like to stop the existing process and start a new one? (y/n) ${NC}"
    if [[ $response =~ ^([yY][eE][sS]|[yY])$ ]]; then
        echo "${BLUE}🔄 Stopping existing process...${NC}"
        lsof -i:3005 -sTCP:LISTEN | awk 'NR>1 {print $2}' | xargs -r kill -9
        sleep 2
        echo "${GREEN}✅ Process stopped.${NC}"
    else
        echo "${BLUE}ℹ️  Opening existing server in browser...${NC}"
        open "http://localhost:3005"
        sleep 2
        echo "${GREEN}🎉 Done! Terminal will close automatically.${NC}"
        sleep 1
        osascript -e 'tell application "Terminal" to close (every window whose name contains ".command")' &
        exit 0
    fi
fi

# Start server in background with proper logging
echo "${BLUE}🌐 Starting server on http://localhost:3005${NC}"

# Create logs directory if it doesn't exist
mkdir -p logs

# Start server with either the wrapper script or directly
if [ "$USE_WRAPPER" = true ]; then
    echo "${BOLD}🚀 Starting server with enhanced error handling...${NC}"
    nohup node server-start.js &
else
    # Start with traditional logging to file
    LOG_FILE="logs/server-$(date +%Y-%m-%d_%H-%M-%S).log"
    echo "${BOLD}🚀 Starting server with direct logging to ${LOG_FILE}...${NC}"
    nohup node index.js > "$LOG_FILE" 2>&1 &
fi

SERVER_PID=$!

# Store PID for later reference
echo $SERVER_PID > .server.pid

# Wait for server to start with progress feedback
echo -n "${BLUE}⏳ Starting server"
for i in {1..15}; do  # Increased to 15 attempts for better ESP32 detection
    echo -n "."
    sleep 0.5
    
    # Check if the server is already responding
    if curl -s http://localhost:3005 >/dev/null; then
        break
    fi
done
echo " ${NC}"

# Check if server is running
if kill -0 $SERVER_PID 2>/dev/null && curl -s http://localhost:3005 >/dev/null; then
    echo "${GREEN}✅ OBS Tally is running in background!${NC}"
    echo "${GREEN}🌐 Web interface: ${BOLD}http://localhost:3005${NC}"
    echo "${BLUE}📝 Server PID: ${SERVER_PID}${NC}"
    echo "${BLUE}📄 Log file: ${LOG_FILE}${NC}"
    echo 
    echo "${BOLD}To stop the server:${NC}"
    echo "  • Use the shutdown button in Settings"
    echo "  • Or run: ${BOLD}kill ${SERVER_PID}${NC}"
    
    # Open browser
    open "http://localhost:3005"
    
    # Give browser a moment to open
    sleep 2
    
    echo 
    echo "${GREEN}🎉 Launch complete! Terminal will close automatically.${NC}"
    
    # Close terminal window automatically
    sleep 2
    osascript -e 'tell application "Terminal" to close (every window whose name contains ".command")' &
    else
    echo "${RED}❌ Failed to start server${NC}"
    echo "${YELLOW}Server may have crashed or failed to bind to port 3005.${NC}"
    echo "${BLUE}📄 Check the log file for details: ${LOG_FILE}${NC}"
    echo
    
    # Show last few lines of log file if it exists
    if [ -f "$LOG_FILE" ]; then
        echo "${BOLD}Last few log entries:${NC}"
        echo "${YELLOW}-----------------------------------${NC}"
        tail -n 10 "$LOG_FILE"
        echo "${YELLOW}-----------------------------------${NC}"
        echo
    fi
    
    read "?Press Enter to exit..."
    exit 1
fi
