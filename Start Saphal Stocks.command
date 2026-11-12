#!/bin/bash
# Double-click to start Saphal Stocks and open it in your browser.
# Builds the app the first time (and after updates), then runs it on http://127.0.0.1:5181
# NO_OPEN=1 (used by the login auto-start) runs it quietly without opening the browser.
cd "$(dirname "$0")" || exit 1
PORT="${API_PORT:-5181}"
if ! command -v node >/dev/null 2>&1; then echo "Node.js is not installed. Get it from https://nodejs.org (version 22.13 or newer)."; read -r -p "Press Enter to close"; exit 1; fi
if lsof -ti tcp:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then echo "Saphal Stocks is already running."; [ "$NO_OPEN" = "1" ] || open "http://127.0.0.1:$PORT"; exit 0; fi
[ -d node_modules ] || { echo "Installing (first run)..."; npm install --no-audit --no-fund || exit 1; }
# Rebuild when missing, outdated, or last built for the online (GitHub Pages) version by a deploy.
# The marker file only exists after a build for this Mac server (any other build empties dist).
if [ ! -f dist/index.html ] || [ ! -f dist/.mac-server-build ] || [ -n "$(find web/src shared -newer dist/index.html -type f 2>/dev/null | head -1)" ]; then
  echo "Building the app..."; { npm run build:server >/dev/null && touch dist/.mac-server-build; } || { echo "Build failed. Run 'npm run build' to see why."; [ "$NO_OPEN" = "1" ] || read -r -p "Press Enter to close"; exit 1; }
fi
echo "Starting Saphal Stocks on http://127.0.0.1:$PORT  (close this window or press Ctrl+C to stop)"
[ "$NO_OPEN" = "1" ] || ( sleep 3; open "http://127.0.0.1:$PORT" ) &
NODE_ENV=production API_PORT="$PORT" exec npx tsx server/index.ts
