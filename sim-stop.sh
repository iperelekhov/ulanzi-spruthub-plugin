#!/usr/bin/env bash
#
# Stop the simulator + plugin main service started by ./sim-start.sh
#
#   ./sim-stop.sh
set -uo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$PLUGIN_DIR/.sim"

stop_pid() {
  local name="$1" pidfile="$2"
  if [ -f "$pidfile" ]; then
    local pid
    pid="$(cat "$pidfile")"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null && echo "Stopped $name (pid $pid)"
    else
      echo "$name not running (stale pid $pid)"
    fi
    rm -f "$pidfile"
  else
    echo "$name: no pid file"
  fi
}

stop_pid "plugin main service" "$RUN_DIR/mainservice.pid"
stop_pid "simulator"           "$RUN_DIR/simulator.pid"

# Fallback: kill anything still bound to the simulator port.
if lsof -ti tcp:39069 >/dev/null 2>&1; then
  echo "Killing leftover process on port 39069"
  lsof -ti tcp:39069 | xargs kill 2>/dev/null || true
fi
