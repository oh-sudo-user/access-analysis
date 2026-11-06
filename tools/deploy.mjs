// Build tarballs locally and upload to the VPS via SFTP.
// Usage: node tools/deploy.mjs
import { Client } from 'ssh2';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = path.join(root, 'tmp-deploy');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

console.log('[deploy] packing server...');
fs.cpSync(path.join(root, 'server'), path.join(tmp, 'server'), {
  recursive: true,
  filter: (src) => !/node_modules|test-data|data$/.test(src),
});
console.log('[deploy] packing web dist...');
fs.cpSync(path.join(root, 'web', 'dist'), path.join(tmp, 'public'), { recursive: true });

process.chdir(tmp);
execSync('tar czf bundle.tar.gz server public');
const bundle = path.join(tmp, 'bundle.tar.gz');
const size = fs.statSync(bundle).size;
console.log(`[deploy] bundle: ${(size / 1024 / 1024).toFixed(1)} MB`);

const conn = new Client();
conn
  .on('ready', () => {
    conn.sftp((err, sftp) => {
      if (err) throw err;
      sftp.fastPut(bundle, '/opt/monitor-bundle.tar.gz', (e) => {
        if (e) throw e;
        console.log('[deploy] upload done');
        conn.end();
      });
    });
  })
  .on('error', (err) => {
    console.error('SSH error:', err.message);
    process.exit(1);
  })
  .connect({
    host: process.env.SSH_HOST || '127.0.0.1',
    port: 22,
    username: process.env.SSH_USER || 'root',
    password: process.env.SSH_PASS,
    readyTimeout: 20000,
  });
