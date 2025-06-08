#!/bin/bash

# Compile and upload script for M5StickC PLUS OBS Tally

echo "Building and uploading M5StickC PLUS OBS Tally firmware..."

# Change to the M5StickC PLUS project directory
cd "$(dirname "$0")/ESP32/M5StickCPlus" || exit 1

# Build and upload using PlatformIO
pio run -t upload

if [ $? -eq 0 ]; then
    echo "Upload successful!"
    echo "Monitor serial output? (y/n)"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        pio device monitor
    fi
else
    echo "Upload failed!"
    exit 1
fi
