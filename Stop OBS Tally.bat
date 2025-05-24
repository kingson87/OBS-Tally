@echo off
REM Windows shutdown script for OBS Tally

REM Check if PID file exists
if not exist .server.pid (
    echo No PID file found. Server may not be running.
    pause
    exit /b
)

REM Read PID from file
set /p PID=<.server.pid

REM Kill the process
TASKKILL /PID %PID% /F

REM Remove the PID file
DEL /F /Q .server.pid

echo OBS Tally server stopped.
pause
