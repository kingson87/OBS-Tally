#!/usr/bin/env node

/**
 * ESP32 Firmware Management CLI Tool for OBS Tally System
 * 
 * This tool allows you to:
 * - Check firmware information on all ESP32 devices
 * - Remove old firmware from all devices
 * - Restart devices
 * - Get detailed device information
 */

const fs = require('fs');
const path = require('path');

// Load device configuration
function loadDevices() {
    try {
        const devicesPath = path.join(__dirname, 'esp32-devices.json');
        if (fs.existsSync(devicesPath)) {
            return JSON.parse(fs.readFileSync(devicesPath, 'utf8'));
        }
        return {};
    } catch (error) {
        console.error('❌ Error loading devices:', error.message);
        return {};
    }
}

// Make HTTP request with timeout
async function makeRequest(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 5000);
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

// Get firmware information from a device
async function getDeviceFirmwareInfo(device) {
    try {
        const response = await makeRequest(`http://${device.ipAddress}:8080/api/firmware/info`, {
            timeout: 5000
        });
        
        if (response.ok) {
            return await response.json();
        } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
    } catch (error) {
        throw new Error(`Failed to communicate with device: ${error.message}`);
    }
}

// Erase old firmware from a device
async function eraseDeviceFirmware(device) {
    try {
        const response = await makeRequest(`http://${device.ipAddress}:8080/api/firmware/erase-old`, {
            method: 'POST',
            timeout: 10000
        });
        
        if (response.ok) {
            const result = await response.json();
            return result;
        } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
    } catch (error) {
        throw new Error(`Failed to communicate with device: ${error.message}`);
    }
}

// Restart a device
async function restartDevice(device) {
    try {
        const response = await makeRequest(`http://${device.ipAddress}:8080/api/firmware/restart`, {
            timeout: 5000
        });
        
        if (response.ok) {
            return await response.json();
        } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
    } catch (error) {
        throw new Error(`Failed to communicate with device: ${error.message}`);
    }
}

// Format bytes for display
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Format uptime for display
function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

// Command: List all devices and their firmware information
async function listFirmware() {
    console.log('🔍 Checking firmware on all ESP32 devices...\n');
    
    const devices = loadDevices();
    const deviceList = Object.entries(devices);
    
    if (deviceList.length === 0) {
        console.log('❌ No devices found. Make sure ESP32 devices are registered.');
        return;
    }
    
    let onlineCount = 0;
    let errorCount = 0;
    
    for (const [deviceId, device] of deviceList) {
        console.log(`📱 ${device.deviceName} (${deviceId})`);
        console.log(`   IP Address: ${device.ipAddress || 'Unknown'}`);
        
        if (!device.ipAddress) {
            console.log('   ❌ Status: No IP address\n');
            errorCount++;
            continue;
        }
        
        try {
            const firmwareInfo = await getDeviceFirmwareInfo(device);
            onlineCount++;
            
            console.log('   ✅ Status: Online');
            console.log(`   📋 Firmware: v${firmwareInfo.firmware_version}`);
            console.log(`   🔧 Chip: ${firmwareInfo.chip_model} (rev ${firmwareInfo.chip_revision})`);
            console.log(`   💾 Flash Size: ${formatBytes(firmwareInfo.flash_size)}`);
            console.log(`   🧠 Free Heap: ${formatBytes(firmwareInfo.free_heap)}`);
            console.log(`   📦 Free Sketch Space: ${formatBytes(firmwareInfo.free_sketch_space)}`);
            console.log(`   ⏱️  Uptime: ${formatUptime(firmwareInfo.uptime)}`);
            console.log(`   📶 WiFi RSSI: ${firmwareInfo.wifi_rssi} dBm`);
            console.log(`   🎯 Current State: ${firmwareInfo.state}`);
            
        } catch (error) {
            errorCount++;
            console.log(`   ❌ Status: ${error.message}`);
        }
        
        console.log('');
    }
    
    console.log(`📊 Summary: ${deviceList.length} total, ${onlineCount} online, ${errorCount} errors`);
}

// Command: Clean up old firmware on all devices
async function cleanupAllFirmware() {
    console.log('🧹 Starting firmware cleanup on all ESP32 devices...\n');
    
    const devices = loadDevices();
    const deviceList = Object.entries(devices).filter(([_, device]) => device.ipAddress);
    
    if (deviceList.length === 0) {
        console.log('❌ No devices with IP addresses found.');
        return;
    }
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const [deviceId, device] of deviceList) {
        console.log(`🧹 Cleaning up ${device.deviceName}...`);
        
        try {
            const result = await eraseDeviceFirmware(device);
            
            if (result.success) {
                successCount++;
                console.log(`   ✅ ${result.message || 'Cleanup completed'}`);
            } else {
                errorCount++;
                console.log(`   ❌ ${result.message || 'Cleanup failed'}`);
            }
            
        } catch (error) {
            errorCount++;
            console.log(`   ❌ ${error.message}`);
        }
    }
    
    console.log(`\n📊 Cleanup Summary: ${successCount} success, ${errorCount} errors`);
    
    if (successCount > 0) {
        console.log('\n✅ Firmware cleanup completed successfully!');
        console.log('💡 Tip: Run "node firmware-manager.js list" to verify the cleanup.');
    }
}

// Command: Restart all devices
async function restartAllDevices() {
    console.log('🔄 Restarting all ESP32 devices...\n');
    
    const devices = loadDevices();
    const deviceList = Object.entries(devices).filter(([_, device]) => device.ipAddress);
    
    if (deviceList.length === 0) {
        console.log('❌ No devices with IP addresses found.');
        return;
    }
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const [deviceId, device] of deviceList) {
        console.log(`🔄 Restarting ${device.deviceName}...`);
        
        try {
            const result = await restartDevice(device);
            successCount++;
            console.log(`   ✅ Restart command sent`);
            
        } catch (error) {
            errorCount++;
            console.log(`   ❌ ${error.message}`);
        }
    }
    
    console.log(`\n📊 Restart Summary: ${successCount} success, ${errorCount} errors`);
    
    if (successCount > 0) {
        console.log('\n✅ Restart commands sent to all devices!');
        console.log('⏳ Devices will take 10-30 seconds to restart and reconnect.');
    }
}

// Command: Clean up firmware on a specific device
async function cleanupDevice(deviceName) {
    console.log(`🧹 Cleaning up firmware on ${deviceName}...\n`);
    
    const devices = loadDevices();
    const device = Object.values(devices).find(d => 
        d.deviceName.toLowerCase() === deviceName.toLowerCase() ||
        d.deviceName.toLowerCase().includes(deviceName.toLowerCase())
    );
    
    if (!device) {
        console.log(`❌ Device "${deviceName}" not found.`);
        console.log('\n📋 Available devices:');
        Object.values(devices).forEach(d => {
            console.log(`   • ${d.deviceName} (${d.ipAddress || 'No IP'})`);
        });
        return;
    }
    
    if (!device.ipAddress) {
        console.log(`❌ Device "${device.deviceName}" has no IP address.`);
        return;
    }
    
    try {
        const result = await eraseDeviceFirmware(device);
        
        if (result.success) {
            console.log(`✅ ${result.message || 'Cleanup completed successfully!'}`);
        } else {
            console.log(`❌ ${result.message || 'Cleanup failed'}`);
        }
        
    } catch (error) {
        console.log(`❌ ${error.message}`);
    }
}

// Show help information
function showHelp() {
    console.log(`
🔧 ESP32 Firmware Manager for OBS Tally System

USAGE:
    node firmware-manager.js <command> [options]

COMMANDS:
    list                    List all devices and their firmware information
    cleanup                 Clean up old firmware on all devices
    cleanup <device>        Clean up firmware on a specific device
    restart                 Restart all ESP32 devices
    help                    Show this help message

EXAMPLES:
    node firmware-manager.js list
    node firmware-manager.js cleanup
    node firmware-manager.js cleanup "ESP32-ABC123"
    node firmware-manager.js restart

DESCRIPTION:
    This tool helps you manage firmware on ESP32 tally devices:
    
    • 'list' - Shows detailed firmware information for all devices
    • 'cleanup' - Safely removes old/unused firmware data to free up space
    • 'restart' - Sends restart commands to devices (useful after updates)
    
    The cleanup operation is safe and will only remove old firmware data.
    Active firmware will never be affected.

REQUIREMENTS:
    • ESP32 devices must be running firmware v1.0.1 or later
    • Devices must be connected to the network
    • OBS Tally server must have device registrations
`);
}

// Main function
async function main() {
    const command = process.argv[2];
    const argument = process.argv[3];
    
    switch (command) {
        case 'list':
            await listFirmware();
            break;
            
        case 'cleanup':
            if (argument) {
                await cleanupDevice(argument);
            } else {
                await cleanupAllFirmware();
            }
            break;
            
        case 'restart':
            await restartAllDevices();
            break;
            
        case 'help':
        case '--help':
        case '-h':
            showHelp();
            break;
            
        default:
            console.log('❌ Unknown command. Use "help" to see available commands.\n');
            showHelp();
            process.exit(1);
    }
}

// Run the tool
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = {
    loadDevices,
    getDeviceFirmwareInfo,
    eraseDeviceFirmware,
    restartDevice,
    formatBytes,
    formatUptime
};
