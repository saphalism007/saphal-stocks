#!/bin/bash
# Like "Start Saphal Stocks", but also reachable from your phone or tablet on the same Wi-Fi.
# Only use this on a trusted home network: anyone on the network can reach the sign-in page.
cd "$(dirname "$0")" || exit 1
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo "On your phone, open: http://$IP:5181"
HOST=0.0.0.0 ALLOWED_ORIGIN_HOSTS="localhost:5180,127.0.0.1:5180,$IP:5181" exec "./Start Saphal Stocks.command"
