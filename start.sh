#!/bin/bash
set -e

# Start xvfb in the background
echo "=== Starting Xvfb on display :99... ==="
Xvfb :99 -screen 0 1024x768x24 -ac +extension GLX +render -noreset > /tmp/xvfb.log 2>&1 &
XVFB_PID=$!

# Wait for xvfb to start
sleep 2

# Verify xvfb is running
if ! kill -0 $XVFB_PID 2>/dev/null; then
    echo "ERROR: Xvfb failed to start. Check /tmp/xvfb.log"
    cat /tmp/xvfb.log || true
    exit 1
fi

echo "=== Xvfb is running (PID: $XVFB_PID) ==="

# Set display and other environment variables
export DISPLAY=:99
export XAUTHORITY=/tmp/Xauthority
export LIBGL_ALWAYS_SOFTWARE=1
export GALLIUM_DRIVER=llvmpipe
# Disable D-Bus to prevent connection errors
export DBUS_SESSION_BUS_ADDRESS=""
export DBUS_SYSTEM_BUS_ADDRESS=""

# Give Xvfb more time to fully initialize
echo "=== Waiting additional time for X server to be fully ready... ==="
sleep 3

# Test if X server is accessible
echo "=== X server should be ready now. DISPLAY=${DISPLAY} ==="
if command -v xdpyinfo >/dev/null 2>&1; then
    if xdpyinfo -display :99 >/dev/null 2>&1; then
        echo "=== X server is accessible! ==="
    else
        echo "=== WARNING: X server may not be fully accessible ==="
    fi
fi

# Start Node.js application
echo "=== Starting Node.js application... ==="
exec node server.js

