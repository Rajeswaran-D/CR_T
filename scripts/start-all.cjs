#!/usr/bin/env node
/**
 * Unified Runner for CIRCOR Project E2E Tracker
 * 
 * Concurrently starts:
 *  1. Backend API Server (Express + MySQL on port 5000)
 *  2. Frontend Development Server (Vite on port 5173)
 *  3. Ngrok Public Tunnel (tunnels to port 5173)
 *
 * Automatically displays all URLs once live and handles clean shutdown on Ctrl+C.
 *
 * Usage:
 *   npm run start:all
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const dotenv = require('dotenv');

const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const BE_PORT = process.env.PORT || '5000';
const FE_PORT = '5173';

function findNgrokPath() {
  const candidates = [
    path.join(process.env.APPDATA || '', 'npm/node_modules/ngrok/bin/ngrok.exe'),
    path.join(ROOT, 'node_modules/ngrok/bin/ngrok.exe'),
    'ngrok'
  ];
  for (const c of candidates) {
    if (c === 'ngrok' || fs.existsSync(c)) return c;
  }
  return 'ngrok';
}

const isWin = process.platform === 'win32';
const npxCmd = isWin ? 'npx.cmd' : 'npx';
const ngrokBin = findNgrokPath();

const children = [];

function killProcess(child) {
  if (!child || !child.pid) return;
  try {
    if (isWin) {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch {}
}

let isShuttingDown = false;
function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\n\x1b[33m[Runner] Shutting down all services...\x1b[0m');
  for (const child of children) {
    killProcess(child);
  }
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', shutdown);

if (isWin) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  rl.on('SIGINT', shutdown);
}

console.log('\x1b[36m====================================================\x1b[0m');
console.log('\x1b[36m🚀 Starting CIRCOR E2E Tracker (Unified Runner)\x1b[0m');
console.log(`⚡ Backend Port:  ${BE_PORT}`);
console.log(`⚡ Frontend Port: ${FE_PORT}`);
console.log(`⚡ Ngrok Binary:  ${ngrokBin}`);
console.log('\x1b[36m====================================================\x1b[0m\n');

// 1. Spawn Backend
const beChild = spawn(npxCmd, ['tsx', 'server/server.ts'], {
  cwd: ROOT,
  shell: true,
  env: { ...process.env, PORT: BE_PORT }
});
children.push(beChild);

beChild.stdout.on('data', d => {
  const line = d.toString().trim();
  if (line) console.log(`\x1b[34m[Backend]\x1b[0m ${line}`);
});
beChild.stderr.on('data', d => {
  const line = d.toString().trim();
  if (line) console.error(`\x1b[31m[Backend Err]\x1b[0m ${line}`);
});

// 2. Spawn Frontend (Vite)
const feChild = spawn(npxCmd, ['vite'], {
  cwd: ROOT,
  shell: true,
  env: process.env
});
children.push(feChild);

feChild.stdout.on('data', d => {
  const line = d.toString().trim();
  if (line) console.log(`\x1b[32m[Frontend]\x1b[0m ${line}`);
});
feChild.stderr.on('data', d => {
  const line = d.toString().trim();
  if (line) console.error(`\x1b[33m[Frontend Err]\x1b[0m ${line}`);
});

// 3. Spawn Ngrok — tunnel to the EXPRESS backend (port 5000) which serves
//    the built dist/ static files AND the /api routes. Tunneling to the Vite
//    dev server (5173) breaks because Vite's WebSocket HMR cannot work over
//    ngrok's HTTPS reverse proxy.
const ngrokChild = spawn(ngrokBin, ['http', FE_PORT], {
  cwd: ROOT,
  shell: false
});
children.push(ngrokChild);

ngrokChild.stderr.on('data', d => {
  const line = d.toString().trim();
  if (line && !line.includes('deprecated')) {
    console.log(`\x1b[35m[Ngrok]\x1b[0m ${line}`);
  }
});

// 4. Poll Ngrok Tunnel URL and print banner
async function waitForNgrokUrl(retries = 25) {
  for (let i = 0; i < retries; i++) {
    await new Promise(r => setTimeout(r, 600));
    try {
      const res = await fetch('http://127.0.0.1:4040/api/tunnels');
      if (res.ok) {
        const data = await res.json();
        const tunnel = data.tunnels?.[0];
        if (tunnel && tunnel.public_url) {
          console.log('\n\x1b[32m====================================================\x1b[0m');
          console.log('\x1b[32m🎉 ALL SERVICES ARE LIVE & PERSISTING TO MYSQL\x1b[0m');
          console.log('\x1b[32m====================================================\x1b[0m');
          console.log(`  ➜ \x1b[1mFrontend (Local):\x1b[0m  http://localhost:${FE_PORT}/`);
          console.log(`  ➜ \x1b[1mBackend API:\x1b[0m       http://localhost:${BE_PORT}/api`);
          console.log(`  ➜ \x1b[1mPublic Ngrok URL:\x1b[0m  \x1b[36m\x1b[4m${tunnel.public_url}\x1b[0m`);
          console.log('\x1b[32m====================================================\x1b[0m');
          console.log('Press \x1b[1mCtrl+C\x1b[0m anytime to gracefully stop all services.\n');
          return;
        }
      }
    } catch {}
  }
  console.log('\x1b[33m[Runner] Ngrok tunnel is starting up. Check http://127.0.0.1:4040 if needed.\x1b[0m');
}

void waitForNgrokUrl();

