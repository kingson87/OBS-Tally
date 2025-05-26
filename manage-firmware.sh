#!/bin/bash

# ESP32 Firmware Management Script for OBS Tally System
# Quick access to firmware management functions

cd "$(dirname "$0")"

echo "🔧 ESP32 Firmware Manager for OBS Tally System"
echo "=============================================="

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed or not in PATH"
    exit 1
fi

# Check if firmware-manager.js exists
if [ ! -f "firmware-manager.js" ]; then
    echo "❌ Error: firmware-manager.js not found"
    exit 1
fi

# Show menu if no arguments provided
if [ $# -eq 0 ]; then
    echo ""
    echo "Select an option:"
    echo "1) 📋 List all devices and firmware info"
    echo "2) 🧹 Clean up old firmware on all devices"
    echo "3) 🔄 Restart all devices"
    echo "4) 🌐 Open web firmware manager"
    echo "5) ❓ Show help"
    echo "6) 🚪 Exit"
    echo ""
    read -p "Enter your choice (1-6): " choice
    
    case $choice in
        1)
            echo ""
            echo "📋 Getting firmware information from all devices..."
            node firmware-manager.js list
            ;;
        2)
            echo ""
            read -p "⚠️  Are you sure you want to clean up firmware on ALL devices? (y/N): " confirm
            if [[ $confirm == [yY] || $confirm == [yY][eE][sS] ]]; then
                echo "🧹 Starting firmware cleanup..."
                node firmware-manager.js cleanup
            else
                echo "❌ Firmware cleanup cancelled."
            fi
            ;;
        3)
            echo ""
            read -p "⚠️  Are you sure you want to restart ALL devices? (y/N): " confirm
            if [[ $confirm == [yY] || $confirm == [yY][eE][sS] ]]; then
                echo "🔄 Restarting all devices..."
                node firmware-manager.js restart
            else
                echo "❌ Device restart cancelled."
            fi
            ;;
        4)
            echo ""
            echo "🌐 Opening web firmware manager..."
            if command -v open &> /dev/null; then
                open http://localhost:3000/firmware-manager.html
            elif command -v xdg-open &> /dev/null; then
                xdg-open http://localhost:3000/firmware-manager.html
            else
                echo "📍 Open this URL in your browser: http://localhost:3000/firmware-manager.html"
            fi
            ;;
        5)
            node firmware-manager.js help
            ;;
        6)
            echo "👋 Goodbye!"
            exit 0
            ;;
        *)
            echo "❌ Invalid choice. Please select 1-6."
            exit 1
            ;;
    esac
else
    # Pass all arguments to the Node.js script
    node firmware-manager.js "$@"
fi

echo ""
echo "✅ Firmware management operation completed."
