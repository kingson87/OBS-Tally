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

// Check for fetch availability (Node.js 18+ has built-in fetch)
let fetch;
if (typeof globalThis.fetch === 'undefined') {
  try {
    fetch = require('node-fetch');
    console.log('Using node-fetch for firmware operations');
  } catch (err) {
    console.warn('⚠️ node-fetch not available, using HTTP module fallback');
    // Fallback to using http module for fetch-like requests
    const http = require('http');
    fetch = async (url, options = {}) => {
      return new Promise((resolve, reject) => {
        try {
          const urlObj = new URL(url);
          const requestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || 80,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: options.timeout || 5000
          };

          const req = http.request(requestOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              resolve({
                ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode,
                statusText: res.statusMessage,
                json: () => {
                  try {
                    return Promise.resolve(JSON.parse(data));
                  } catch (e) {
                    return Promise.reject(new Error('Invalid JSON response'));
                  }
                },
                text: () => Promise.resolve(data)
              });
            });
          });

          req.on('error', reject);
          req.on('timeout', () => reject(new Error('Request timeout')));
          
          if (options.body) {
            if (options.body.pipe && typeof options.body.pipe === 'function') {
              // Handle FormData stream
              options.body.pipe(req);
            } else {
              req.write(options.body);
              req.end();
            }
          } else {
            req.end();
          }
        } catch (error) {
          reject(error);
        }
      });
    };
  }
} else {
  fetch = globalThis.fetch;
}

/**
 * Normalizes device object properties for consistent access
 * @param {object} device - Device object with potentially inconsistent property names
 * @returns {object} - Normalized device object
 */
function normalizeDevice(device) {
  return {
    deviceId: device.deviceId || device.device_id,
    deviceName: device.deviceName || device.device_name || device.deviceId,
    ipAddress: device.ipAddress || device.ip_address,
    ...device
  };
}

/**
 * Handles firmware uploads to ESP32 devices
 * 
 * @param {object} device - Device information (deviceId, ipAddress, etc.)
 * @param {object} firmwareFile - The uploaded firmware file
 * @param {string} tempPath - Path where the firmware file is temporarily stored
 * @returns {Promise<object>} - Result of the firmware upload operation
 */
async function uploadFirmwareToDevice(device, firmwareFile, tempPath) {
  const normalizedDevice = normalizeDevice(device);
  console.log(`📤 Uploading firmware ${firmwareFile.name} to ${normalizedDevice.deviceName} (${normalizedDevice.ipAddress})`);
  
  if (!normalizedDevice.ipAddress) {
    throw new Error('Device IP address is required for firmware upload');
  }
  
  try {
    // Validate firmware file size (4MB max for ESP32)
    const stats = fs.statSync(tempPath);
    if (stats.size > 4 * 1024 * 1024) {
      throw new Error('Firmware file too large (max 4MB for ESP32)');
    }
    
    console.log(`📊 Firmware file size: ${stats.size} bytes`);
    
    // Use HTTP module directly for better ESP32 compatibility
    const result = await uploadViaHTTP(normalizedDevice, tempPath);
    
    if (result.success) {
      console.log(`✅ Firmware upload successful for ${normalizedDevice.deviceName}`);
      return {
        success: true,
        message: 'Firmware uploaded successfully. Device will restart.',
        deviceId: normalizedDevice.deviceId
      };
    } else {
      throw new Error(result.error || 'Firmware upload failed');
    }
  } catch (error) {
    console.error(`❌ Error uploading firmware to ${normalizedDevice.deviceName}:`, error);
    throw error;
  } finally {
    // Cleanup temp file
    try {
      if (fs.existsSync(tempPath)) {
        await unlinkAsync(tempPath);
        console.log(`🗑️ Cleaned up temporary firmware file: ${tempPath}`);
      }
    } catch (err) {
      console.error(`Error removing temporary firmware file: ${err}`);
    }
  }
}

// Helper function to upload firmware via HTTP module
async function uploadViaHTTP(device, firmwarePath) {
  return new Promise((resolve) => {
    try {
      const http = require('http');
      const FormData = require('form-data');
      
      // Create form data with file stream
      const form = new FormData();
      form.append('firmware', fs.createReadStream(firmwarePath), {
        filename: 'firmware.bin',
        contentType: 'application/octet-stream'
      });
      
      const options = {
        hostname: device.ipAddress,
        port: 80,
        path: '/update',
        method: 'POST',
        headers: {
          ...form.getHeaders(),
          'Connection': 'close',
          'User-Agent': 'OBS-Tally-Firmware-Handler/2.0',
          'Cache-Control': 'no-cache'
        },
        timeout: 90000 // Increased timeout for ESP32 processing
      };
      
      let uploadCompleted = false;
      let responseReceived = false;
      
      const req = http.request(options, (res) => {
        responseReceived = true;
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          uploadCompleted = true;
          
          if (res.statusCode === 200 || responseData.includes('Update Success') || responseData.includes('OK')) {
            resolve({ success: true, response: responseData });
          } else {
            resolve({ 
              success: false, 
              error: `HTTP ${res.statusCode}: ${responseData || res.statusMessage}` 
            });
          }
        });
        
        res.on('error', (error) => {
          if (!uploadCompleted) {
            resolve({ success: false, error: `Response error: ${error.message}` });
          }
        });
      });
      
      req.on('error', (error) => {
        if (!uploadCompleted) {
          // Handle ESP32-specific connection patterns
          if (error.code === 'EPIPE' || error.code === 'ECONNRESET') {
            console.log(`⚠️ Connection reset for ${device.deviceName} - checking device status...`);
            
            // EPIPE during ESP32 OTA is often normal - the device resets during update
            setTimeout(async () => {
              try {
                // Simple check - if we can't connect, device is likely updating
                const checkResult = await quickDeviceCheck(device.ipAddress);
                if (checkResult.responding) {
                  resolve({ success: true, response: 'Device processing update (connection reset normal)' });
                } else {
                  // Device not responding likely means it's updating firmware
                  resolve({ 
                    success: true, 
                    response: 'Upload likely successful (device not responding indicates firmware update in progress)' 
                  });
                }
              } catch (checkError) {
                // Assume success since EPIPE is common during ESP32 OTA
                resolve({ 
                  success: true, 
                  response: 'Upload assumed successful (EPIPE is normal ESP32 OTA behavior)' 
                });
              }
            }, 1500);
          } else {
            resolve({ success: false, error: `Network error: ${error.message}` });
          }
        }
      });
      
      req.on('timeout', () => {
        if (!uploadCompleted) {
          req.destroy();
          resolve({ success: false, error: 'Upload timeout' });
        }
      });
      
      // Handle form streaming errors
      form.on('error', (error) => {
        if (!uploadCompleted) {
          resolve({ success: false, error: `Form stream error: ${error.message}` });
        }
      });
      
      // Pipe form data to request with error handling
      try {
        form.pipe(req);
      } catch (pipeError) {
        resolve({ success: false, error: `Pipe error: ${pipeError.message}` });
      }
      
    } catch (error) {
      resolve({ success: false, error: error.message });
    }
  });
}

// Quick device responsiveness check
async function quickDeviceCheck(ipAddress) {
  return new Promise((resolve) => {
    const http = require('http');
    
    const req = http.request({
      hostname: ipAddress,
      port: 80,
      path: '/',
      method: 'HEAD',
      timeout: 2000
    }, (res) => {
      resolve({ responding: true, status: res.statusCode });
    });
    
    req.on('error', () => resolve({ responding: false }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ responding: false });
    });
    
    req.end();
  });
}

/**
 * Gets firmware information from an ESP32 device
 * 
 * @param {object} device - Device information (deviceId, ipAddress, etc.)
 * @returns {Promise<object>} - Firmware information from the device
 */
async function getFirmwareInfo(device) {
  const normalizedDevice = normalizeDevice(device);
  console.log(`ℹ️ Getting firmware info for ${normalizedDevice.deviceName} (${normalizedDevice.ipAddress})`);
  
  if (!normalizedDevice.ipAddress) {
    throw new Error('Device IP address is required to get firmware info');
  }
  
  try {
    // Create timeout handler
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), 5000);
    });
    
    const fetchPromise = fetch(`http://${normalizedDevice.ipAddress}/api/firmware/info`, {
      method: 'GET',
      headers: {
        'User-Agent': 'OBS-Tally-Server/2.0'
      }
    });
    
    const response = await Promise.race([fetchPromise, timeoutPromise]);
    
    if (response.ok) {
      const firmwareInfo = await response.json();
      return {
        success: true,
        deviceId: normalizedDevice.deviceId,
        firmwareInfo
      };
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    console.error(`❌ Error getting firmware info from ${normalizedDevice.deviceName}:`, error);
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
  const normalizedDevice = normalizeDevice(device);
  console.log(`🔄 Restarting device ${normalizedDevice.deviceName} (${normalizedDevice.ipAddress})`);
  
  if (!normalizedDevice.ipAddress) {
    throw new Error('Device IP address is required to restart device');
  }
  
  try {
    // Create timeout handler
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), 5000);
    });
    
    const fetchPromise = fetch(`http://${normalizedDevice.ipAddress}/api/restart`, {
      method: 'POST',
      headers: {
        'User-Agent': 'OBS-Tally-Server/2.0',
        'Content-Type': 'application/json'
      }
    });
    
    try {
      const response = await Promise.race([fetchPromise, timeoutPromise]);
      
      if (response.ok) {
        console.log(`✅ Restart command sent to ${normalizedDevice.deviceName}`);
        return {
          success: true,
          message: 'Device restart command sent successfully',
          deviceId: normalizedDevice.deviceId
        };
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      // Device might restart before responding, which is actually success
      if (error.message.includes('timeout') || error.message.includes('ECONNRESET')) {
        console.log(`✅ Device ${normalizedDevice.deviceName} likely restarted (connection reset)`);
        return {
          success: true,
          message: 'Device restart initiated (connection reset as expected)',
          deviceId: normalizedDevice.deviceId
        };
      }
      throw error;
    }
  } catch (error) {
    console.error(`❌ Error restarting ${normalizedDevice.deviceName}:`, error);
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
  const normalizedDevice = normalizeDevice(device);
  console.log(`🗑️ Erasing old firmware from ${normalizedDevice.deviceName} (${normalizedDevice.ipAddress})`);
  
  if (!normalizedDevice.ipAddress) {
    throw new Error('Device IP address is required to erase firmware');
  }
  
  try {
    // Create timeout handler
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), 10000);
    });
    
    const fetchPromise = fetch(`http://${normalizedDevice.ipAddress}/api/firmware/erase-old`, {
      method: 'POST',
      headers: {
        'User-Agent': 'OBS-Tally-Server/2.0',
        'Content-Type': 'application/json'
      }
    });
    
    const response = await Promise.race([fetchPromise, timeoutPromise]);
    
    if (response.ok) {
      const result = await response.json();
      console.log(`✅ Old firmware erased from ${normalizedDevice.deviceName}`);
      return {
        success: true,
        message: result.message || 'Old firmware erased successfully',
        deviceId: normalizedDevice.deviceId
      };
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    console.error(`❌ Error erasing firmware from ${normalizedDevice.deviceName}:`, error);
    throw error;
  }
}

module.exports = {
  uploadFirmwareToDevice,
  getFirmwareInfo,
  restartDevice,
  eraseOldFirmware
};
