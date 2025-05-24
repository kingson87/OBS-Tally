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

# Check if the command launcher exists
if [ -f "Start OBS Tally.command" ]; then
    echo -e "${YELLOW}🚀 Launch OBS Tally:${NC}"
    echo -e "   ${BLUE}Double-click${NC} 'Start OBS Tally.command'"
    echo ""
    echo -e "${BLUE}ℹ️  The launcher will:${NC}"
    echo "   • Start the tally server"
    echo "   • Open your web browser to http://localhost:3005"
    echo "   • Show server logs in Terminal"
    echo "   • Stop with Ctrl+C"
else
    echo -e "${YELLOW}⚠️  'Start OBS Tally.command' not found${NC}"
    echo -e "${BLUE}Alternative:${NC} Run 'npm start' in this directory"
fi

echo ""
echo -e "${GREEN}🎯 Ready to go! Double-click 'Start OBS Tally.command' to launch.${NC}"
echo "Visit the README.md for detailed usage instructions."
echo ""
