const pngToIco = require('png-to-ico');
const fs = require('fs');
const path = require('path');

async function createIcons() {
  console.log('Creating Windows icon...');
  
  try {
    // Create Windows .ico file
    const iconPath = path.join(__dirname, '..', 'public', 'icon.png');
    console.log('Using PNG source file:', iconPath);
    
    if (!fs.existsSync(iconPath)) {
      console.error(`❌ Error: Source icon does not exist at ${iconPath}`);
      process.exit(1);
    }
    
    console.log('Converting PNG to ICO format...');
    const iconBuffer = await pngToIco([iconPath]);
    
    const icoPath = path.join(__dirname, '..', 'public', 'icon.ico');
    fs.writeFileSync(icoPath, iconBuffer);
    console.log(`✅ Created Windows icon: ${icoPath}`);
  } catch (err) {
    console.error('❌ Error creating Windows icon:', err);
    process.exit(1);
  }
}

createIcons();
