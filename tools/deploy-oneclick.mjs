// 一键部署：node tools/deploy-oneclick.mjs
// 交互输入 IP / 账号 / 密码后自动完成：探测 → 装 Node → 上传 → 安装 → 启动 → 验证。
// 也支持参数/环境变量免交互：--ip --user --pass [--port] [--log-path]，或 DEPLOY_IP / DEPLOY_USER / DEPLOY_PASS。
import { Client } from 'ssh2';
import { execSync } from 'child_process';
import readline from 'readline';
import path from 'path';
import fs from 'fs';
import http from 'http';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

// ---------- 输入 ----------
function ask(question, def = '') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(def ? `${question} [${def}]: ` : `${question}: `, (ans) => {
      rl.close();
      resolve(ans.trim() || def);
    });
  });
}

const target = {
  host: arg('ip') || process.env.DEPLOY_IP || await ask('VPS IP'),
  user: arg('user') || process.env.DEPLOY_USER || await ask('SSH 账号', 'root'),
  pass: arg('pass') || process.env.DEPLOY_PASS || await ask('SSH 密码'),
  port: Number(arg('port') || process.env.DEPLOY_PORT || await ask('监听端口', '80')),
  logPath: arg('log-path') || process.env.DEPLOY_LOGPATH || '',
  adminPass: arg('admin-pass') || process.env.DEPLOY_ADMIN_PASS || await ask('面板登录密码（仅首次部署写入配置）', 'admin123'),
};
if (!target.host || !target.pass) {
  console.error('缺少 IP 或密码');
  process.exit(1);
}

// ---------- SSH 封装 ----------
const conn = new Client();
const connect = () => new Promise((res, rej) => {
  conn.on('ready', res).on('error', rej)
    .connect({ host: target.host, port: 22, username: target.user, password: target.pass, readyTimeout: 20000 });
});

function execRemote(cmd, { quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      let errOut = '';
      stream
        .on('close', (code) => resolve({ code: code ?? 0, out, err: errOut }))
        .on('data', (d) => { out += d; if (!quiet) process.stdout.write(d); })
        .stderr.on('data', (d) => { errOut += d; if (!quiet) process.stderr.write(d); });
    });
  });
}

// 通过 base64 投递多行脚本，避免引号转义问题
const runScript = (script, opts) =>
  execRemote(`echo ${Buffer.from(script).toString('base64')} | base64 -d | bash`, opts);

function uploadFile(local, remote) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      // 预热：首个 SFTP 请求可能竞争失败，先 readdir 一次
      sftp.readdir('/tmp', () => {
        // 该服务端 sftp 对字符串 open flags 支持有问题，用数字 flags（WRITE|CREAT|TRUNC = 26）
        sftp.open(remote, 26, (e, handle) => {
          if (e) return reject(e);
          const buf = fs.readFileSync(local);
          sftp.write(handle, buf, 0, buf.length, 0, (we) => {
            if (we) return reject(we);
            sftp.close(handle, () => resolve(buf.length));
          });
        });
      });
    });
  });
}

// ---------- 本地构建 ----------
function ensureBuilt() {
  const run = (cwd, cmd) => {
    console.log(`\n[local] ${cwd}> ${cmd}`);
    execSync(cmd, { cwd, stdio: 'inherit', shell: process.platform === 'win32' ? undefined : '/bin/bash' });
  };
  if (!fs.existsSync(path.join(root, 'server', 'node_modules'))) run(path.join(root, 'server'), 'npm install');
  if (!fs.existsSync(path.join(root, 'server', 'dist', 'main.js'))) run(path.join(root, 'server'), 'npm run build');
  if (!fs.existsSync(path.join(root, 'web', 'node_modules'))) run(path.join(root, 'web'), 'npm install');
  if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) run(path.join(root, 'web'), 'npm run build');
}

function pack() {
  const tmp = path.join(root, 'tmp-deploy');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, 'server'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'public'), { recursive: true });
  fs.cpSync(path.join(root, 'server', 'dist'), path.join(tmp, 'server', 'dist'), { recursive: true });
  fs.copyFileSync(path.join(root, 'server', 'package.json'), path.join(tmp, 'server', 'package.json'));
  fs.copyFileSync(path.join(root, 'server', 'package-lock.json'), path.join(tmp, 'server', 'package-lock.json'));
  fs.cpSync(path.join(root, 'web', 'dist'), path.join(tmp, 'public'), { recursive: true });
  execSync('tar -czf server.tar.gz server && tar -czf public.tar.gz public', { cwd: tmp });
  return { tmp, serverTar: path.join(tmp, 'server.tar.gz'), publicTar: path.join(tmp, 'public.tar.gz') };
}

// ---------- 主流程 ----------
try {
  console.log(`\n=== 目标 ${target.user}@${target.host}:${target.port} ===`);
  await connect();
  console.log('[ssh] 已连接');

  // 1) 探测
  const probe = await runScript(`
set -e
echo "ARCH=$(uname -m)"
echo "GLIBC=$(ldd --version | head -1 | grep -oE '[0-9]+\\.[0-9]+$')"
echo "NODE=$(node -v 2>/dev/null || echo none)"
echo "OS=$(grep -oE 'CentOS|Rocky|AlmaLinux|Ubuntu|Debian' /etc/os-release | head -1)"
for p in ${target.logPath} /etc/v2ray-agent/xray/access.log /usr/local/etc/xray/access.log /var/log/xray/access.log; do
  [ -n "$p" ] && [ -f "$p" ] && echo "LOGFOUND=$p" && break
done
systemctl is-active firewalld 2>/dev/null | sed 's/^/FIREWALLD=/' || true
ss -tln | grep -q ":${target.port} " && echo "PORT_BUSY=1" || echo "PORT_BUSY=0"
  `, { quiet: true });
  const p = Object.fromEntries(probe.out.trim().split('\n').filter(l => l.includes('=')).map(l => l.split(/=(.+)/).filter(Boolean)));
  console.log('[probe]', JSON.stringify(p));
  if (p.ARCH !== 'x86_64') console.warn('! 非 x86_64 架构，Node 安装部分可能需要调整');
  const logPath = target.logPath || p.LOGFOUND || '/etc/v2ray-agent/xray/access.log';
  console.log(`[probe] 使用日志路径: ${logPath}${p.LOGFOUND ? '' : '（未探测到文件，按默认写入配置，请确认 Xray 日志路径）'}`);

  // 2) 安装 Node
  const nodeMajor = p.NODE && p.NODE.startsWith('v') ? Number(p.NODE.split('.')[0].slice(1)) : 0;
  if (nodeMajor >= 18) {
    console.log(`[node] 已存在 ${p.NODE}，跳过安装`);
  } else {
    const glibc = Number(p.GLIBC || 0);
    const url = glibc >= 2.28
      ? 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-x64.tar.xz'
      : `https://unofficial-builds.nodejs.org/download/release/v20.20.2/node-v20.20.2-linux-x64-glibc-217.tar.gz`;
    console.log(`[node] 安装 Node 20（glibc ${p.GLIBC}）→ ${url}`);
    await runScript(`
set -e
curl -sL -o /tmp/node.tar.bin '${url}'
mkdir -p /usr/local/lib/nodejs
tar -xf /tmp/node.tar.bin -C /usr/local/lib/nodejs
NODE_DIR=$(ls -d /usr/local/lib/nodejs/node-v20.* | head -1)
ln -sf $NODE_DIR/bin/node /usr/local/bin/node
ln -sf $NODE_DIR/bin/npm /usr/local/bin/npm
ln -sf $NODE_DIR/bin/npx /usr/local/bin/npx
rm -f /tmp/node.tar.bin
node -v
    `);
  }
  const nodeBin = (await execRemote('command -v node', { quiet: true })).out.trim();

  // 3) 本地构建并打包
  console.log('\n[local] 检查并构建前后端...');
  ensureBuilt();
  const { tmp, serverTar, publicTar } = pack();
  console.log(`[local] 打包完成: ${(fs.statSync(serverTar).size / 1024).toFixed(0)}KB + ${(fs.statSync(publicTar).size / 1024).toFixed(0)}KB`);

  // 4) 上传
  console.log('[sftp] 上传 server.tar.gz ...');
  await uploadFile(serverTar, '/tmp/monitor-server.tar.gz');
  console.log('[sftp] 上传 public.tar.gz ...');
  await uploadFile(publicTar, '/tmp/monitor-public.tar.gz');

  // 5) 解压、装依赖、配置、服务
  console.log('[remote] 解压并安装...');
  await runScript(`
set -e
mkdir -p /opt/monitor
# 保留升级前的配置与历史数据（token 不变、用户不用重新登录）
rm -f /tmp/monitor-config.keep /tmp/monitor-data.keep
[ -f /opt/monitor/server/config.json ] && cp /opt/monitor/server/config.json /tmp/monitor-config.keep
[ -d /opt/monitor/server/data ] && cp -r /opt/monitor/server/data /tmp/monitor-data.keep
rm -rf /opt/monitor/server /opt/monitor/public
tar -xzf /tmp/monitor-server.tar.gz -C /opt/monitor
tar -xzf /tmp/monitor-public.tar.gz -C /opt/monitor
rm -f /tmp/monitor-server.tar.gz /tmp/monitor-public.tar.gz
[ -f /tmp/monitor-config.keep ] && mv /tmp/monitor-config.keep /opt/monitor/server/config.json
[ -d /tmp/monitor-data.keep ] && rm -rf /opt/monitor/server/data && mv /tmp/monitor-data.keep /opt/monitor/server/data
cd /opt/monitor/server
npm install --omit=dev --no-audit --no-fund

if [ ! -f config.json ]; then
  cat > config.json <<'EOF'
{
  "port": ${target.port},
  "token": "",
  "adminPassword": "${target.adminPass}",
  "logPath": "${logPath}",
  "dataDir": "/opt/monitor/server/data",
  "publicDir": "/opt/monitor/public",
  "rangeHours": 24
}
EOF
  echo '[remote] config.json 已创建（token 将自动生成）'
else
  echo '[remote] 已存在 config.json，保留原配置（token 不变）'
fi
cat > /etc/systemd/system/monitor.service <<EOF
[Unit]
Description=Access Monitor (NestJS)
After=network.target

[Service]
WorkingDirectory=/opt/monitor/server
ExecStart=${nodeBin} dist/main.js
Restart=always
RestartSec=3
MemoryMax=384M

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable monitor 2>&1 | tail -1
systemctl restart monitor
sleep 3
systemctl is-active monitor
  `);

  // 6) 防火墙
  if (p.FIREWALLD === 'active') {
    console.log('[remote] 放行 firewalld 端口...');
    await runScript(`firewall-cmd --permanent --add-port=${target.port}/tcp >/dev/null && firewall-cmd --reload >/dev/null && echo ok`);
  }

  // 7) 验证
  console.log('\n[verify] 等待服务就绪...');
  let ok = false;
  for (let i = 0; i < 15; i++) {
    ok = await new Promise((res) => {
      const req = http.get({ host: target.host, port: target.port, path: '/', timeout: 5000 }, (r) => res(r.statusCode === 200));
      req.on('error', () => res(false));
      req.on('timeout', () => { req.destroy(); res(false); });
    });
    if (ok) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const log = await execRemote('journalctl -u monitor --no-pager -n 6 2>/dev/null', { quiet: true });
  console.log(log.out);

  if (ok) {
    console.log('\n================ 部署成功 ================');
    console.log(`  面板地址:   http://${target.host}:${target.port}/`);
    console.log(`  登录密码:   ${target.adminPass}（可在 /opt/monitor/server/config.json 改 adminPassword）`);
    console.log(`  API token:  /opt/monitor/server/config.json 的 token 字段`);
    console.log(`  日志源:     ${logPath}`);
    console.log('  常用命令:   systemctl status monitor | journalctl -u monitor -f');
    console.log('==========================================');
  } else {
    console.error('\n[verify] 服务未通过 HTTP 验证，请查看上方日志排查');
    process.exitCode = 1;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  conn.end();
} catch (e) {
  console.error('\n[error]', e.message);
  process.exit(1);
}
