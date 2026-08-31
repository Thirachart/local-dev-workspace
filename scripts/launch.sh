#!/bin/bash

# Chat Dev MCP macOS Launcher
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
cd "$DIR"

# Source environment paths
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/node@22/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"
if [ -f "$HOME/.zprofile" ]; then
  source "$HOME/.zprofile" >/dev/null 2>&1
fi
if [ -f "$HOME/.zshrc" ]; then
  source "$HOME/.zshrc" >/dev/null 2>&1
fi

echo "=================================================="
echo "  🚀 Starting Chat Dev MCP Server..."
echo "  📂 Workspace: $DIR"
echo "=================================================="

# Check if port 4100 is already in use
EXISTING_PID=$(lsof -t -i:4100 2>/dev/null)
if [ -n "$EXISTING_PID" ]; then
  echo "⚠️ Port 4100 is already in use (PID: $EXISTING_PID). Freeing port..."
  kill -9 $EXISTING_PID 2>/dev/null
  sleep 1
fi

# Ensure dist exists
if [ ! -f "dist/index.js" ]; then
  echo "📦 Building bundle..."
  npm run build
fi

# Open browser to Dashboard after 1.5 seconds
(sleep 2 && open "http://localhost:4100/logs") &

# Start Server with Ngrok tunnel
exec node dist/index.js --sse --port 4100
