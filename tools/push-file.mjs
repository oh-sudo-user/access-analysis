// Upload a single local file to the VPS. Usage: node tools/push-file.mjs <local> <remote>
// Note: this ssh2 build's string open-flags ('w') misbehave against this server's
// sftp-server (ENOENT), so we open with numeric pflags WRITE|CREAT|TRUNC (26).
import { Client } from 'ssh2';
import fs from 'fs';

const [local, remote] = process.argv.slice(2);
if (!local || !remote) {
  console.error('Usage: node tools/push-file.mjs <local> <remote>');
  process.exit(1);
}

const conn = new Client();
conn
  .on('ready', () => {
    conn.sftp((err, sftp) => {
      if (err) throw err;
      // Warm-up: the first SFTP request right after subsystem start can race
      // this server's sftp-server (ENOENT); a dummy readdir settles it.
      sftp.readdir('/tmp', () => {
      sftp.open(remote, 26, (e, handle) => {
        if (e) { console.error('open error:', e.code, e.message); process.exit(1); }
        const buf = fs.readFileSync(local);
        sftp.write(handle, buf, 0, buf.length, 0, (we) => {
          if (we) { console.error('write error:', we.code, we.message); process.exit(1); }
          sftp.close(handle, () => {
            console.log(`uploaded ${local} -> ${remote} (${buf.length} bytes)`);
            conn.end();
          });
        });
      });
      });
    });
  })
  .on('error', (err) => {
    console.error('SSH error:', err.message);
    process.exit(1);
  })
  .connect({
    host: process.env.SSH_HOST || '38.59.224.205',
    port: 22,
    username: process.env.SSH_USER || 'root',
    password: process.env.SSH_PASS,
    readyTimeout: 20000,
  });
