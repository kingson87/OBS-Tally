#!/bin/bash

# OBS Tally macOS Installer
# This script sets up OBS Tally for easy standalone use on macOS

echo "🎬 OBS Tally macOS Setup"
echo "========================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -f "index.js" ]; then
    echo -e "${RED}❌ Error: Please run this script from the OBS-Tally project directory${NC}"
    exit 1
fi

# Check Node.js installation
echo -e "${BLUE}🔍 Checking Node.js installation...${NC}"

# Common Node.js installation paths
NODE_PATHS=(
    "/usr/local/bin/node"
    "/opt/homebrew/bin/node"
    "/usr/bin/node"
    "$(which node 2>/dev/null)"
    "$HOME/.nvm/versions/node/*/bin/node"
)

# Try to find Node.js
NODE_FOUND=""
for NODE_PATH in "${NODE_PATHS[@]}"; do
    if [ -x "$NODE_PATH" ] && [ ! -z "$NODE_PATH" ]; then
        NODE_FOUND="$NODE_PATH"
        break
    fi
done

# Also check if node is in PATH
if [ -z "$NODE_FOUND" ] && command -v node &> /dev/null; then
    NODE_FOUND="$(command -v node)"
fi

if [ -z "$NODE_FOUND" ]; then
    echo -e "${RED}❌ Node.js not found${NC}"
    echo ""
    echo "Please install Node.js from https://nodejs.org/"
    echo "Recommended: Download the LTS version for macOS"
    echo ""
    echo "Alternative installation methods:"
    echo "• Homebrew: brew install node"
    echo "• Direct download: https://nodejs.org/en/download/"
    echo ""
    exit 1
else
    NODE_VERSION=$("$NODE_FOUND" --version 2>/dev/null || echo "unknown")
    echo -e "${GREEN}✅ Node.js found: $NODE_VERSION${NC}"
    echo -e "${BLUE}   Location: $NODE_FOUND${NC}"
    
    # Update PATH to ensure npm works
    export PATH="$(dirname "$NODE_FOUND"):$PATH"
fi

# Install dependencies
echo -e "${BLUE}📦 Installing dependencies...${NC}"

# Make sure npm is available
if ! command -v npm &> /dev/null; then
    echo -e "${YELLOW}⚠️  npm not found in PATH, trying to locate...${NC}"
    # Try common npm paths
    NPM_PATHS=(
        "$(dirname "$NODE_FOUND")/npm"
        "/usr/local/bin/npm" 
        "/opt/homebrew/bin/npm"
    )
    
    NPM_FOUND=""
    for NPM_PATH in "${NPM_PATHS[@]}"; do
        if [ -x "$NPM_PATH" ]; then
            NPM_FOUND="$NPM_PATH"
            export PATH="$(dirname "$NPM_PATH"):$PATH"
            break
        fi
    done
    
    if [ -z "$NPM_FOUND" ]; then
        echo -e "${RED}❌ npm not found. Please reinstall Node.js from nodejs.org${NC}"
        exit 1
    fi
fi

if npm install; then
    echo -e "${GREEN}✅ Dependencies installed successfully${NC}"
else
    echo -e "${RED}❌ Failed to install dependencies${NC}"
    echo -e "${YELLOW}💡 Try running: npm install manually${NC}"
    exit 1
fi

# Test the server
echo -e "${BLUE}🧪 Testing server startup...${NC}"
npm start &
TEST_PID=$!

# Wait for server to start
sleep 5

# Check if server is running and responding
if kill -0 $TEST_PID 2>/dev/null; then
    # Test if port 3005 is responding
    if curl -s http://localhost:3005 > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Server test successful${NC}"
    else
        echo -e "${YELLOW}⚠️  Server started but not responding on port 3005${NC}"
        echo -e "${BLUE}ℹ️  This might be normal if OBS isn't running${NC}"
    fi
    # Stop the test server
    kill $TEST_PID 2>/dev/null
    # Wait a moment for cleanup
    sleep 2
else
    echo -e "${RED}❌ Server test failed${NC}"
    exit 1
fi

# Show installation summary
echo ""
echo -e "${GREEN}🎉 Installation Complete!${NC}"
echo "=========================="
echo ""
echo -e "${YELLOW}📱 Available Launch Options:${NC}"
echo ""

if [ -f "Start OBS Tally.command" ]; then
    echo -e "1. ${BLUE}Simple Launcher${NC}: Double-click 'Start OBS Tally.command'"
fi

if [ -d "OBS Tally.app" ]; then
    echo -e "2. ${BLUE}macOS App Bundle${NC}: Double-click 'OBS Tally.app'"
    echo -e "   ${YELLOW}💡 Tip: Drag to Applications folder for easy access${NC}"
fi

echo -e "3. ${BLUE}Terminal${NC}: Run 'npm start' in this directory"
echo -e "4. ${BLUE}VS Code Task${NC}: Use the 'Start Tally Server' task"

echo ""
echo -e "${YELLOW}🔧 Setup Options:${NC}"
echo "• Run './create-launch-agent.sh' for auto-start on login"
echo "• The app will be available at http://localhost:3005"
echo ""

# Offer to create Applications shortcut
echo -e "${BLUE}📂 Would you like to create a shortcut in Applications? (y/n)${NC}"
read -r response
if [[ "$response" =~ ^[Yy]$ ]]; then
    if [ -d "OBS Tally.app" ]; then
        if ln -sf "$(pwd)/OBS Tally.app" /Applications/; then
            echo -e "${GREEN}✅ Shortcut created in Applications folder${NC}"
        else
            echo -e "${YELLOW}⚠️  Could not create shortcut (requires admin permissions)${NC}"
            echo "You can manually drag 'OBS Tally.app' to Applications"
        fi
    fi
fi

echo ""
echo -e "${GREEN}🚀 Ready to launch! Choose any option above to start OBS Tally.${NC}"
echo "Visit the README.md for detailed usage instructions."
echo ""
