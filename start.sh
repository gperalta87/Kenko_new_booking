#!/bin/bash
set -e

# Start xvfb in the background
echo "Starting Xvfb on display :99..."
Xvfb :99 -screen 0 1024x768x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!

# Wait for Xvfb to be ready
echo "Waiting for Xvfb to be ready..."
sleep 2

# Verify Xvfb is running
if ! kill -0 $XVFB_PID 2>/dev/null; then
    echo "ERROR: Xvfb failed to start"
    exit 1
fi

echo "Xvfb is running (PID: $XVFB_PID)"

# Set display and other environment variables
export DISPLAY=:99
export XAUTHORITY=/tmp/Xauthority
export LIBGL_ALWAYS_SOFTWARE=1
export GALLIUM_DRIVER=llvmpipe
# Disable D-Bus to prevent connection errors
export DBUS_SESSION_BUS_ADDRESS=""
export DBUS_SYSTEM_BUS_ADDRESS=""

# Verify Xvfb is accessible
echo "Verifying X server is accessible..."
if ! xdpyinfo -display :99 >/dev/null 2>&1; then
    echo "WARNING: X server may not be fully ready, but continuing..."
fi

# Start Node.js application
echo "Starting Node.js application..."
exec node server.js

