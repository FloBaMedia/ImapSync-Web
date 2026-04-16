#!/bin/sh
set -e

echo "🗄️  Running database migrations..."
cd /app
node node_modules/.bin/prisma migrate deploy

echo "🌱  Initializing database..."
node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function init() {
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD || 'admin';
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (!existing) {
    const passwordHash = bcrypt.hashSync(password, 12);
    await prisma.adminUser.create({ data: { email, passwordHash } });
    console.log('Admin user created: ' + email);
  }

  const defaults = [
    ['ssl1', 'true'], ['ssl2', 'true'], ['automap', 'true'],
    ['addheader', 'true'], ['syncinternaldates', 'true'], ['useuid', 'true'],
    ['subfolder2', ''], ['exclude', '(?i)Spam|Trash|Junk'],
    ['regextrans2', ''], ['extraArgs', ''],
  ];
  for (const [key, value] of defaults) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }

  // Reset stuck RUNNING jobs from a previous session
  await prisma.migrationJob.updateMany({ where: { status: 'RUNNING' }, data: { status: 'STOPPED', finishedAt: new Date() } });
  await prisma.migrationAccount.updateMany({ where: { status: 'RUNNING' }, data: { status: 'FAILED', finishedAt: new Date() } });

  console.log('Initialization complete.');
  await prisma.\$disconnect();
}
init().catch(e => { console.error(e); process.exit(1); });
"

echo "🚀  Starting application..."
exec node server.js
