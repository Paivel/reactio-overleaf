#!/bin/bash
# Installs the Reactio helper for the Overleaf extension (Chrome, Edge, Brave, Chromium).
# Double-click it in Finder, or run it in Terminal. Nothing needs administrator rights.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
case "$(uname -m)" in
  arm64) name="mac-arm64" ;;
  *)     name="mac-amd64" ;;
esac
# Beside this script in a release download, or in dist/host in the source tree.
binary="$here/$name"; [ -f "$binary" ] || binary="$here/../dist/host/$name"
target="$HOME/Library/Application Support/ReactioOverleaf"
mkdir -p "$target"
cp "$binary" "$target/reactio-overleaf-host"
chmod 755 "$target/reactio-overleaf-host"
xattr -d com.apple.quarantine "$target/reactio-overleaf-host" 2>/dev/null || true
manifest='{
  "name": "com.reactio.overleaf",
  "description": "Reactio Draw figures for Overleaf: opens drawings in Reactio Draw",
  "path": "'"$target/reactio-overleaf-host"'",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://hjkdmdfdknjjfdaepbeggimajobinoeg/"]
}'
for browser in "Google/Chrome" "Google/Chrome Beta" "Chromium" "Microsoft Edge" "BraveSoftware/Brave-Browser" "Arc/User Data"; do
  dir="$HOME/Library/Application Support/$browser"
  [ -d "$dir" ] || continue
  mkdir -p "$dir/NativeMessagingHosts"
  printf '%s\n' "$manifest" > "$dir/NativeMessagingHosts/com.reactio.overleaf.json"
  echo "Registered for $browser"
done
"$target/reactio-overleaf-host" --version
echo "Done. Reload the Overleaf page."
