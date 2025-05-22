/**
 * This script helps fix permission issues with packaged macOS applications
 * It should be run after packaging is complete
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function fixMacApp() {
  console.log('Fixing permissions for macOS application...');
  
  try {
    const distDir = path.join(__dirname, '..', 'dist');
    
    // Find the macOS app directory
    const files = fs.readdirSync(distDir);
    const macAppDir = files.find(file => file.includes('-darwin-') || file.includes('.dmg'));
    
    if (!macAppDir) {
      console.log('No macOS application found in dist directory');
      return;
    }
    
    console.log(`Found macOS application: ${macAppDir}`);
    
    if (macAppDir.endsWith('.dmg')) {
      console.log('DMG file found, skipping permission fixes as they are not needed');
      return;
    }
    
    // Make the macOS app executable with chmod
    try {
      const appPath = path.join(distDir, macAppDir);
      execSync(`chmod -R +x "${appPath}"`);
      console.log('✅ Fixed permissions for macOS application');
    } catch (err) {
      console.error('Error fixing permissions:', err);
    }
    
  } catch (err) {
    console.error('Error in fixMacApp:', err);
  }
}

// Run the script
fixMacApp();
