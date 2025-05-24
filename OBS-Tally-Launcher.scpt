#!/usr/bin/env osascript

# OBS Tally Menu Bar Helper
# This creates a simple menu bar application

on run
    set projectPath to (path to me as string)
    set projectPath to (do shell script "dirname " & quoted form of POSIX path of projectPath)
    
    # Check if Node.js is installed
    try
        do shell script "which node"
    on error
        display alert "Node.js Required" message "Please install Node.js from nodejs.org to run OBS Tally." buttons {"OK"} default button "OK"
        return
    end try
    
    # Change to project directory and start server
    try
        do shell script "cd " & quoted form of projectPath & " && node index.js > /dev/null 2>&1 &"
        delay 2
        
        # Open web interface
        open location "http://localhost:3005"
        
        # Show notification
        display notification "OBS Tally is now running at http://localhost:3005" with title "OBS Tally Started"
        
    on error errorMessage
        display alert "Error Starting OBS Tally" message errorMessage buttons {"OK"} default button "OK"
    end try
end run
