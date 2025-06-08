# M5StickC Firmware Fixes

This document outlines the changes made to fix the HTTP 404 errors and other issues with M5StickC devices in the OBS-Tally system.

## Issues Fixed

1. **Missing Firmware Info Endpoint**: M5StickC devices now have a `/api/firmware/info` endpoint to report device information.
2. **Device Restart Command**: Added a `/reset` endpoint to enable device restart from the firmware manager.
3. **Firmware Cleanup Functionality**: Added `/api/firmware/erase-old` endpoint to support firmware cleanup.
4. **Upload Failures**: Fixed "Early connection reset: write EPIPE" errors during firmware uploads.

## How to Apply the Fix

1. **Build and upload the firmware**:
   ```bash
   ./upload-m5stickc-fix.sh
   ```
   This script will compile the firmware and upload it to your M5StickC device.

2. **Verify the fixes**:
   ```bash
   node verify-m5stickc-fix-updated.js
   ```
   This script will check if all endpoints are working correctly.

3. **Test firmware upload**:
   ```bash
   node test-firmware-upload.js
   ```
   This script will test if firmware uploads work without EPIPE errors.

## Technical Details

### Added Endpoints

1. **Firmware Info Endpoint**:
   - Path: `/api/firmware/info`
   - Method: `GET`
   - Response: JSON with device information
   ```json
   {
     "device_type": "M5StickC-PLUS",
     "firmware_version": "1.0.1",
     "model": "M5StickC-PLUS",
     "device_name": "Tally Light",
     "mac": "FF:FF:FF:FF:FF:FF",
     "uptime": 12345
   }
   ```

2. **Reset Endpoint**:
   - Path: `/reset`
   - Method: `GET`
   - Response: Text indicating the device will restart

3. **Firmware Cleanup Endpoint**:
   - Path: `/api/firmware/erase-old`
   - Method: `POST`
   - Response: JSON with success status
   ```json
   {
     "success": true,
     "message": "No operation needed for M5StickC"
   }
   ```

## Server-Side Changes

The server already had the necessary endpoints to communicate with the device. No server-side changes were required beyond ensuring the firmware on the M5StickC devices includes the necessary endpoints.

## Firmware Versions

The fixed firmware is version `1.0.1` and is available in the firmware directory as `obs_tally_m5stickc_v1.0.1.bin`.

## Testing

Use the verification script to test if the device has all the necessary endpoints and is working correctly with the server.

```bash
node verify-m5stickc-fix-updated.js
```

This script will check:
1. If the device is online in the server
2. If the firmware info endpoint is responding
3. If the firmware cleanup endpoint is working
4. If the reset endpoint is working
5. If compatible firmware is available for the device
