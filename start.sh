#!/bin/sh
set -e
echo "Enabling Corepack..."
corepack enable
echo "🚀 Starting Medusa..."

export PORT=${PORT:-9000}
echo "Listening on port $PORT"

# Show node version & working dir for debug
node -v
pwd
ls -la

# Start Medusa
npx medusa start --port $PORT || { echo "❌ Medusa failed to start"; sleep 30; exit 1; }