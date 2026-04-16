#!/bin/sh
set -e

echo "🏃  Starting imapsync runner..."
exec node /app/scripts/runner.mjs
