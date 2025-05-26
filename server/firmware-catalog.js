/**
 * Firmware version checker and listing utility
 * 
 * This module provides functionality to list and validate available firmware files
 */

const fs = require('fs');
const path = require('path');

/**
 * Get a list of all available firmware files
 * @returns {Promise<Array>} Array of firmware file objects
 */
async function listAvailableFirmware() {
  const firmwareDir = path.join(__dirname, '..', 'firmware');
  
  try {
    // Check if firmware directory exists
    if (!fs.existsSync(firmwareDir)) {
      return { 
        success: false, 
        error: 'Firmware directory not found' 
      };
    }
    
    // Check if info.json exists
    const infoPath = path.join(firmwareDir, 'info.json');
    if (!fs.existsSync(infoPath)) {
      // If no info.json, just list .bin files
      const files = fs.readdirSync(firmwareDir).filter(file => file.endsWith('.bin'));
      
      return {
        success: true,
        count: files.length,
        firmware: files.map(file => ({
          filename: file,
          path: path.join(firmwareDir, file),
          size: fs.statSync(path.join(firmwareDir, file)).size
        }))
      };
    }
    
    // Read info.json for detailed firmware information
    const infoJson = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    
    // Validate that all listed files actually exist
    const firmwareVersions = infoJson.firmwareVersions.filter(fw => {
      const exists = fs.existsSync(path.join(firmwareDir, fw.filename));
      if (!exists) {
        console.warn(`Warning: Firmware file ${fw.filename} listed in info.json does not exist`);
      }
      return exists;
    });
    
    // Add full path and actual file size
    firmwareVersions.forEach(fw => {
      fw.path = path.join(firmwareDir, fw.filename);
      fw.actualSize = fs.statSync(fw.path).size;
    });
    
    return {
      success: true,
      count: firmwareVersions.length,
      firmware: firmwareVersions,
      bootloader: infoJson.bootloader,
      partitions: infoJson.partitions
    };
    
  } catch (error) {
    console.error('Error listing firmware files:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Get a specific firmware file by version or filename
 * @param {string} identifier - Version number or filename
 * @returns {Promise<Object>} Firmware file object
 */
async function getFirmwareFile(identifier) {
  const firmwareList = await listAvailableFirmware();
  
  if (!firmwareList.success) {
    return firmwareList; // Return error
  }
  
  // Find by version or filename
  const firmware = firmwareList.firmware.find(fw => 
    fw.version === identifier || fw.filename === identifier
  );
  
  if (!firmware) {
    return {
      success: false,
      error: `Firmware "${identifier}" not found`
    };
  }
  
  return {
    success: true,
    firmware
  };
}

module.exports = {
  listAvailableFirmware,
  getFirmwareFile
};
