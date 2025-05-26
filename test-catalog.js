// Test the firmware catalog functionality
const catalog = require('./server/firmware-catalog');

async function testCatalog() {
  try {
    console.log('Listing all available firmware:');
    const firmwareList = await catalog.listAvailableFirmware();
    console.log(JSON.stringify(firmwareList, null, 2));
    
    if (firmwareList.firmware && firmwareList.firmware.length > 0) {
      const firstFirmware = firmwareList.firmware[0];
      console.log(`\nGetting details for firmware: ${firstFirmware.version || firstFirmware.filename}`);
      const result = await catalog.getFirmwareFile(firstFirmware.version || firstFirmware.filename);
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error('Error testing catalog:', error);
  }
}

testCatalog();
