#!/usr/bin/env node
'use strict';
/* WADEH | واضح — start the local server.  Usage:  node server.js   (Node.js 22.13 or newer) */
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`WADEH needs Node.js 22.13 or newer (found ${process.versions.node}). Download the LTS from https://nodejs.org`);
  process.exit(1);
}
const os = require('node:os');
const { createApp } = require('./server/app');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const { server } = createApp();

server.listen(PORT, HOST, () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('\n  واضح | WADEH demo server is running');
  console.log(`  → http://localhost:${PORT}   (use this on this computer — passkeys/Face ID work on localhost)`);
  for (const ip of lan) console.log(`  → http://${ip}:${PORT}   (same Wi-Fi; passkeys need HTTPS on other devices)`);
  console.log('  Demo PIN: 123456   •   Press Ctrl+C to stop\n');
});
