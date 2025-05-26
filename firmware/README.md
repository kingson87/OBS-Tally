# OBS Tally Firmware Files

This folder contains firmware binary files for OBS Tally ESP32 devices.

## Available Firmware Files

- **obs_tally_v2.0.0.bin**: Main firmware binary (version 2.0.0)
- **obs_tally_v2.1.0.bin**: Updated firmware binary (version 2.1.0)
- **bootloader.bin**: ESP32 bootloader binary
- **partitions.bin**: Partition table for the ESP32

## How to Use

### Web Interface
1. Navigate to the Firmware Manager page in the OBS Tally web interface
2. Click the "Upload Firmware" button
3. Select a device and choose one of the firmware files from this folder
4. Click "Upload Firmware" to start the upload process

### Command Line
You can also use the test script to upload firmware via command line:

```bash
./test-firmware-upload.sh <device-id> ./firmware/obs_tally_v2.1.0.bin
```

## Version History

- **v2.1.0**: Latest version with additional features and bug fixes
- **v2.0.0**: Initial stable release with all core functionality

## Notes

The firmware update process uses OTA (Over-The-Air) updates. Make sure your ESP32 devices are properly configured and connected to the network before attempting an update.
