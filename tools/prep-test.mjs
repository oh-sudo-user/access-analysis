import fs from 'fs';

const cwd = process.cwd().replace(/\\/g, '/');
const now = Date.now();
let lines = '';
const hosts = ['www.google.com', 'github.com', 'api.openai.com'];
for (let i = 0; i < 50; i++) {
  const t = new Date(now - Math.random() * 3600000);
  const ts =
    `${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, '0')}/${String(t.getDate()).padStart(2, '0')} ` +
    `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}.` +
    `${String(t.getMilliseconds()).padStart(3, '0')}000`;
  lines += `${ts} from 127.0.0.1:${20000 + i} accepted tcp:${hosts[i % 3]}:443 [z_direct_outbound] email: testuser\n`;
  if (i % 10 === 0) {
    lines += `${ts} from 45.155.3.2:${30000 + i} rejected  [VLESS_WS_TLS >> blackhole_out]\n`;
  }
}
fs.mkdirSync('test-data', { recursive: true });
fs.writeFileSync('test-data/access.log', lines);
fs.writeFileSync('test-data/config.json', JSON.stringify({
  port: 18090,
  token: 'test-token',
  logPath: `${cwd}/test-data/access.log`,
  dataDir: `${cwd}/test-data/data`,
  publicDir: `${cwd}/../web/dist`,
}));
console.log('prepared');
