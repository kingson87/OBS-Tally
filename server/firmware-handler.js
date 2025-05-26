/**
 * ESP32 Firmware Management Handler
 * 
 * This module provides functionality for managing ESP32 device firmware
 * through the OBS Tally system.
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const unlinkAsync = promisify(fs.unlink);

/**
 * Handles firmware uploads to ESP32 devices
 * 
 * @param {object} device - Device information (deviceId, ipAddress, etc.)
 * @param {object} firmwareFile - The uploaded firmware file
 * @param {string} tempPath - Path where the firmware file is temporarily stored
 * @returns {Promise<object>} - Result of the firmware upload operation
 */
async function uploadFirmwareToDevice(device, firmwareFile, tempPath) {
  console.log(`Uploading firmware ${firmwareFile.name} to ${device.device_name} (${device.ip_address})`);
  
  try {
    // Create a FormData instance for the file upload
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('firmware', fs.createReadStream(tempPath), {
      filename: path.basename(tempPath),
      contentType: 'application/octet-stream',
    });
    
    // The ESP32 exposes an /update endpoint for OTA updates
    const response = await fetch(`http://${device.ip_address}/update`, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders(),
      timeout: 60000 // 1 minute timeout for larger files
    });
    
    // Process response
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.text();
    
    // Check for success in the response
    if (result.includes('Update Success') || result.includes('OK') || response.ok) {
      return {
        success: true,
        message: 'Firmware uploaded successfully. Device will restart.'
      };
    } else {
      throw new Error(`Failed to process firmware: ${result}`);
    }
  } catch (error) {
    console.error(`Error uploading firmware to ${device.device_name}:`, error);
    throw error;
  } finally {
    // Cleanup temp file
    try {
      await unlinkAsync(tempPath);
    } catch (err) {
      console.error(`Error removing temporary firmware file: ${err}`);
    }
  }
}

/**
 * Gets firmware information from an ESP32 device
 * 
 * @param {object} device - Device information (deviceId, ipAddress, etc.)
 * @returns {Promise<object>} - Firmware information from the device
 */
async function getFirmwareInfo(device) {
  console.log(`Getting firmware info for ${device.device_name} (${device.ip_address})`);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`http://${device.ip_address}/api/firmware/info`, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const firmwareInfo = await response.json();
      return {
        success: true,
        firmwareInfo
      };
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    console.error(`Error getting firmware info from ${device.device_name}:`, error);
    throw error;
  }
}

/**
 * Sends a restart command to an ESP32 device
 * 
 * @param {object} device - Device information (deviceId, ipAddress, etc.) 
 * @returns {Promise<object>} - Result of the restart operation
 */
async function restartDevice(device) {
  console.log(`Restarting device ${device.device_name} (${device.ip_address})`);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`http://${device.ip_address}/api/restart`, {
      method: 'POST',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      return {
        success: true,
        message: 'Device restart command sent successfully'
      };
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    console.error(`Error restarting ${device.device_name}:`, error);
    throw error;
  }
}

/**
 * Erases old firmware from an ESP32 device
 * 
 * @param {object} device - Device information (deviceId, ipAddress, etc.)
 * @returns {Promise<object>} - Result of the erase operation 
 */
async function eraseOldFirmware(device) {
  console.log(`Erasing old firmware from ${device.device_name} (${device.ip_address})`);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(`http://${device.ip_address}/api/firmware/erase-old`, {
      method: 'POST',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const result = await response.json();
      return {
        success: true,
        message: result.message || 'Old firmware erased successfully'
      };
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    console.error(`Error erasing firmware from ${device.device_name}:`, error);
    throw error;
  }
}

module.exports = {
  uploadFirmwareToDevice,
  getFirmwareInfo,
  restartDevice,
  eraseOldFirmware
};
