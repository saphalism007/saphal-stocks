#!/bin/bash
# Run at login by ~/Library/LaunchAgents/com.saphalstocks.mac.plist: starts Saphal Stocks in a
# Terminal window without opening the browser. Close that window to stop it.
cd "$(dirname "$0")" || exit 1
NO_OPEN=1 exec "./Start Saphal Stocks.command"
