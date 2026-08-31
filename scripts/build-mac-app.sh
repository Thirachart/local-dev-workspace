#!/bin/bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
cd "$DIR"

chmod +x scripts/launch.sh
chmod +x ChatDevMCP.command

echo "🍏 Compiling standalone native macOS ChatDevMCP.app bundle..."

# Temporary AppleScript file using dynamic 'path to me'
TMP_SCRIPT=$(mktemp /tmp/chatdev_app.XXXXXX.applescript)

cat << 'EOF' > "$TMP_SCRIPT"
set appPath to POSIX path of (path to me)
set runtimeDir to appPath & "Contents/Resources/app"
tell application "Terminal"
    activate
    do script "cd \"" & runtimeDir & "\" && ./scripts/launch.sh"
end tell
EOF

# Compile using osacompile
rm -rf ChatDevMCP.app
osacompile -o ChatDevMCP.app "$TMP_SCRIPT"
rm -f "$TMP_SCRIPT"

# Embed standalone runtime into ChatDevMCP.app/Contents/Resources/app
APP_RUNTIME="ChatDevMCP.app/Contents/Resources/app"
mkdir -p "$APP_RUNTIME"

echo "📦 Bundling runtime into $APP_RUNTIME..."
cp -R dist "$APP_RUNTIME/"
cp package.json "$APP_RUNTIME/"
if [ -d "config" ]; then
  cp -R config "$APP_RUNTIME/"
fi
mkdir -p "$APP_RUNTIME/scripts"
cp scripts/launch.sh "$APP_RUNTIME/scripts/"
chmod +x "$APP_RUNTIME/scripts/launch.sh"

if [ -d "node_modules" ]; then
  echo "📦 Copying node_modules dependencies..."
  cp -R node_modules "$APP_RUNTIME/"
fi

# Copy to Applications or Desktop
if [ -d "/Applications" ] && [ -w "/Applications" ]; then
  rm -rf "/Applications/ChatDevMCP.app"
  cp -R ChatDevMCP.app "/Applications/ChatDevMCP.app"
  echo "✅ Installed ChatDevMCP.app to /Applications/ChatDevMCP.app"
fi

if [ -d "$HOME/Desktop" ]; then
  rm -rf "$HOME/Desktop/ChatDevMCP.app"
  cp -R ChatDevMCP.app "$HOME/Desktop/ChatDevMCP.app"
  echo "✅ Copied ChatDevMCP.app to $HOME/Desktop/ChatDevMCP.app"
fi

echo "🎉 Standalone build completed successfully! ChatDevMCP.app is ready."
