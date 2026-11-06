// Generic SSH exec: node tools/ssh-exec.mjs "<command>"
// Connection params from env: SSH_HOST, SSH_USER, SSH_PASS (fallbacks for the two known hosts).
import { Client } from 'ssh2';

const command = process.argv[2];
if (!command) {
  console.error('Usage: node tools/ssh-exec.mjs "<command>"');
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
    host: process.env.SSH_HOST,
    port: 22,
    username: process.env.SSH_USER || 'root',
    password: process.env.SSH_PASS,
    readyTimeout: 20000,
  });
