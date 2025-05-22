#!/bin/bash
# OBS Tally Installer/Launcher Script

# Color codes for terminal output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}      OBS Tally Setup Script        ${NC}"
echo -e "${GREEN}=========================================${NC}"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js is not installed. Please install Node.js first.${NC}"
    echo -e "${YELLOW}Visit https://nodejs.org/ to download and install Node.js.${NC}"
    exit 1
fi

# Check if required dependencies are installed
echo -e "${GREEN}Checking dependencies...${NC}"
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm install
    if [ $? -ne 0 ]; then
        echo -e "${RED}Failed to install dependencies. Please check your internet connection and try again.${NC}"
        exit 1
    fi
    echo -e "${GREEN}Dependencies installed successfully.${NC}"
else
    echo -e "${GREEN}Dependencies already installed.${NC}"
fi

# Check if OBS config file exists
if [ ! -f "obs-config.json" ]; then
    echo -e "${YELLOW}Creating default OBS configuration file...${NC}"
    echo '{
  "address": "ws://127.0.0.1:4455",
  "password": ""
}' > obs-config.json
    echo -e "${GREEN}Created default OBS configuration file.${NC}"
fi

# Prompt for installation mode
echo ""
echo -e "${GREEN}Choose installation mode:${NC}"
echo "1) Start server only (for development)"
echo "2) Start desktop application (requires Electron)"
echo "3) Package as macOS application (creates distributable app)"
echo "4) Package as Windows application (creates distributable app)"
echo "5) Package for all platforms (macOS & Windows)"
echo "6) Exit"

read -p "Enter your choice (1-6): " choice

case $choice in
    1)
        echo -e "${GREEN}Starting OBS Tally server...${NC}"
        node index.js
        ;;
    2)
        echo -e "${GREEN}Starting OBS Tally as desktop application...${NC}"
        npm run macapp
        ;;
    3)
        echo -e "${GREEN}Packaging OBS Tally as macOS application...${NC}"
        npm run package-mac
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}Application packaged successfully in the 'dist' folder.${NC}"
        else
            echo -e "${RED}Failed to package application.${NC}"
        fi
        ;;
    4)
        echo -e "${GREEN}Packaging OBS Tally as Windows application...${NC}"
        npm run package-win
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}Application packaged successfully in the 'dist' folder.${NC}"
        else
            echo -e "${RED}Failed to package application.${NC}"
        fi
        ;;
    5)
        echo -e "${GREEN}Packaging OBS Tally for all platforms...${NC}"
        npm run package-all
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}Applications packaged successfully in the 'dist' folder.${NC}"
        else
            echo -e "${RED}Failed to package applications.${NC}"
        fi
        ;;
    6)
        echo -e "${GREEN}Exiting setup.${NC}"
        exit 0
        ;;
    *)
        echo -e "${RED}Invalid choice. Exiting.${NC}"
        exit 1
        ;;
esac
