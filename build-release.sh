#!/usr/bin/env bash
#
# Build a slim, self-contained release bundle of this plugin, ready to copy
# onto another machine and drop into Ulanzi Studio's plugins folder.
#
#   ./build-release.sh
#
# Output (in ./dist-release/):
#   com.ulanzi.spruthub.ulanziPlugin/      <- the installable plugin folder
#   com.ulanzi.spruthub.ulanziPlugin.zip   <- the same, zipped
#   INSTALL.md                             <- install instructions (preserved)
#
# The webpack bundle inlines almost everything; only a few packages are
# require()d dynamically at runtime (ajv + its deps). This script detects those
# from the built bundle and ships just them, keeping the bundle small (~4 MB
# instead of ~52 MB).
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ID="com.ulanzi.spruthub.ulanziPlugin"
REL="$PLUGIN_DIR/dist-release"
DEST="$REL/$PLUGIN_ID"

cd "$PLUGIN_DIR"

echo "==> Installing dev dependencies (if needed)"
if [ ! -d node_modules ]; then
  npm install
fi

echo "==> Building bundle (dist/app.js)"
npm run build >/dev/null

echo "==> Detecting runtime packages the bundle require()s"
# Top-level package names dynamically required from the bundle, minus Node
# built-ins. These (and their transitive deps) must ship in node_modules.
BUILTINS='^(assert|async_hooks|buffer|child_process|constants|crypto|dgram|diagnostics_channel|dns|events|fs|http|http2|https|net|os|path|perf_hooks|process|punycode|querystring|readline|stream|string_decoder|timers|tls|url|util|v8|vm|worker_threads|zlib)$'
ROOT_PKGS=$(grep -oE 'require\("[^"/]+' dist/app.js \
  | sed 's/require("//' \
  | sort -u \
  | grep -vE "$BUILTINS" || true)

# Expand to the full transitive dependency set via `npm ls`.
RUNTIME_PKGS=""
for p in $ROOT_PKGS; do
  RUNTIME_PKGS="$RUNTIME_PKGS $p"
  deps=$(npm ls "$p" --all --parseable 2>/dev/null \
    | sed -n 's#.*/node_modules/##p' | sort -u || true)
  RUNTIME_PKGS="$RUNTIME_PKGS $deps"
done
# Fallback if detection came up empty (ajv is the known runtime require).
if [ -z "$(echo "$RUNTIME_PKGS" | tr -d '[:space:]')" ]; then
  RUNTIME_PKGS="ajv json-schema-traverse fast-deep-equal fast-uri require-from-string uri-js"
fi
RUNTIME_PKGS=$(echo "$RUNTIME_PKGS" | tr ' ' '\n' | sort -u | grep -v '^$')
echo "    runtime packages: $(echo "$RUNTIME_PKGS" | tr '\n' ' ')"

echo "==> Assembling $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
rsync -a \
  --exclude '.sim' --exclude '.npmcache' --exclude '.env' --exclude '.gitignore' \
  --exclude 'scripts' --exclude 'sim-start.sh' --exclude 'sim-stop.sh' \
  --exclude 'install.sh' --exclude 'build-release.sh' --exclude 'webpack.config.js' \
  --exclude 'node_modules' --exclude 'dist-release' \
  "$PLUGIN_DIR/" "$DEST/"

mkdir -p "$DEST/node_modules"
for pkg in $RUNTIME_PKGS; do
  if [ -d "node_modules/$pkg" ]; then
    mkdir -p "$DEST/node_modules/$(dirname "$pkg")"
    cp -R "node_modules/$pkg" "$DEST/node_modules/$pkg"
  fi
done

echo "==> Verifying the bundle is self-contained"
# Load the built app.js resolving modules ONLY from the shipped node_modules.
# Any missing runtime dep throws MODULE_NOT_FOUND here, before we ship a broken
# zip. The app tries to connect to a (non-existent) UlanziStudio socket and
# exits; we only care that requiring its modules doesn't fail.
VERIFY_OUT=$(cd "$DEST" && node -e "
  try { require('./dist/app.js'); }
  catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND') { console.error('MISSING_DEP:'+e.message); process.exit(3); }
  }
  // Give the socket attempt a tick, then succeed.
  setTimeout(() => process.exit(0), 300);
" 2>&1 || true)
if echo "$VERIFY_OUT" | grep -q 'MISSING_DEP:'; then
  echo "!! Bundle is missing a runtime dependency:" >&2
  echo "$VERIFY_OUT" | grep 'MISSING_DEP:' >&2
  echo "   Add the package to RUNTIME_PKGS detection and rebuild." >&2
  exit 1
fi
echo "    ok (no missing runtime modules)"

echo "==> Zipping"
cd "$REL"
rm -f "$PLUGIN_ID.zip"
zip -qr "$PLUGIN_ID.zip" "$PLUGIN_ID"

echo ""
echo "Done. Size: $(du -sh "$DEST" | cut -f1) (zip: $(du -h "$PLUGIN_ID.zip" | cut -f1))"
echo "  Folder: $DEST"
echo "  Zip:    $REL/$PLUGIN_ID.zip"
[ -f "$REL/INSTALL.md" ] && echo "  Guide:  $REL/INSTALL.md"
