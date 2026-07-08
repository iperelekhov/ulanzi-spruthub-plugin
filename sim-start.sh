#!/usr/bin/env bash
#
# Start the UlanziDeck Simulator + this plugin's main service.
#
#   ./sim-start.sh
#
# What it does:
#   1. Rebuilds the plugin bundle (dist/app.js).
#   2. Syncs the plugin (incl. node_modules) into the simulator's plugins dir.
#   3. Starts the simulator (http://127.0.0.1:39069).
#   4. Starts the plugin main service, connected to the simulator on port 39069.
#
# Logs go to .sim/, PIDs are tracked in .sim/*.pid so ./sim-stop.sh can stop them.
# Then open http://127.0.0.1:39069, click "Refresh Plugin List", drag the
# "Bulb Toggle" action onto a key, fill in the Property Inspector and press it.
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ID="$(basename "$PLUGIN_DIR")"
REPO_ROOT="$(cd "$PLUGIN_DIR/../.." && pwd)"
SIM_DIR="$REPO_ROOT/UlanziDeckSimulator"
SIM_PLUGIN_DIR="$SIM_DIR/plugins/$PLUGIN_ID"
RUN_DIR="$PLUGIN_DIR/.sim"

SIM_PORT=39069
SIM_HOST=127.0.0.1
LANG_CODE=en

mkdir -p "$RUN_DIR"

echo "==> Building plugin bundle"
( cd "$PLUGIN_DIR" && npm run build >/dev/null )

echo "==> Ensuring simulator dependencies are installed"
if [ ! -d "$SIM_DIR/node_modules" ]; then
  ( cd "$SIM_DIR" && npm install )
fi

echo "==> Syncing plugin into simulator ($SIM_PLUGIN_DIR)"
rm -rf "$SIM_PLUGIN_DIR"
mkdir -p "$SIM_PLUGIN_DIR"
rsync -a --exclude '.sim' --exclude '.npmcache' --exclude '.env' \
  "$PLUGIN_DIR/" "$SIM_PLUGIN_DIR/"
# The webpacked bundle still require()s ajv at runtime, so node_modules must
# travel with it.
if [ ! -d "$SIM_PLUGIN_DIR/node_modules" ]; then
  echo "    (plugin node_modules missing — run 'npm install' in the plugin dir first)"
fi

# Load the Spruthub password from .env if present (for reference; creds are
# entered in the Property Inspector, not needed to boot the service).
if [ -f "$PLUGIN_DIR/.env" ]; then
  set -a; . "$PLUGIN_DIR/.env"; set +a
fi

# Refuse to start on top of an already-running simulator (avoids orphaned
# processes stacking up on the port).
if lsof -ti tcp:"$SIM_PORT" >/dev/null 2>&1; then
  echo "!! Port $SIM_PORT is already in use. Run ./sim-stop.sh first." >&2
  exit 1
fi

echo "==> Starting simulator"
cd "$SIM_DIR"
node app.js >"$RUN_DIR/simulator.log" 2>&1 &
echo $! >"$RUN_DIR/simulator.pid"
sleep 1

echo "==> Starting plugin main service"
cd "$SIM_PLUGIN_DIR"
node dist/app.js "$SIM_HOST" "$SIM_PORT" "$LANG_CODE" >"$RUN_DIR/mainservice.log" 2>&1 &
echo $! >"$RUN_DIR/mainservice.pid"

sleep 1
echo ""
echo "Simulator:     http://127.0.0.1:$SIM_PORT"
echo "Logs:          $RUN_DIR/simulator.log , $RUN_DIR/mainservice.log"
echo "Stop with:     $PLUGIN_DIR/sim-stop.sh"
echo ""
echo "Next: open the URL, click 'Refresh Plugin List', drag 'Bulb Toggle' to a"
echo "key, open its Property Inspector, enter creds + aId/sId/cId, then press it."
