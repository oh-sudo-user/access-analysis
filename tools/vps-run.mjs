// Usage: node tools/vps-run.mjs "<remote shell command>"
// Runs a command on the VPS via SSH password auth.
import { Client } from 'ssh2';

const command = process.argv[2];
if (!command) {
  console.error('Usage: node tools/vps-run.mjs "<command>"');
  process.exit(1);
}

const conn = new Client();
conn
  .on('ready', () => {
    conn.exec(command, (err, stream) => {
      if (err) throw err;
      stream
        .on('close', (code) => {
          conn.end();
          process.exit(code ?? 0);
        })
        .on('data', (d) => process.stdout.write(d))
        .stderr.on('data', (d) => process.stderr.write(d));
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
