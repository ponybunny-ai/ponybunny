#!/bin/bash
# Build script for Debug Server WebUI

set -e

echo "Building Debug Server WebUI..."

cd "$(dirname "$0")/webui"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Build Next.js app
echo "Building Next.js application..."
npm run build

echo "✓ WebUI build complete!"
echo ""
echo "The WebUI is now ready to be served by the debug server."
echo "Start the debug server with: pb debug web"
