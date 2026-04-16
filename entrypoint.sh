#!/bin/sh
set -e

echo "🗄️  Running database migrations..."
cd /app
node node_modules/.bin/prisma migrate deploy

echo "🌱  Initializing database..."
node /app/scripts/init.mjs

echo "🚀  Starting application..."
exec node server.js
