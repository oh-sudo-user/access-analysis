# 代理访问监控系统 · 一键部署文档

本文档面向执行部署的 AI / 运维人员，按步骤执行即可在一台全新的 VPS 上完整部署本系统。跟着做，不要跳步。

## 1. 系统简介

一套监控 Xray 代理节点的单页 Web 面板：

- **后端**：NestJS（TypeScript 编译为纯 JS），读取 Xray `access.log`，解析连接事件，提供 REST API 与静态前端托管，以 systemd 服务常驻。
- **前端**：React 18 + antd 5 + AntV G2，构建后为纯静态文件，由后端直接托管。
- **登录方式**：访问密码（默认 `admin123`，可用配置项 `adminPassword` 修改）；登录后返回 token，前端每次请求携带。

### 部署后布局（目标机）

```
/opt/monitor/
  server/          后端：dist/（编译产物）+ package.json + node_modules/ + config.json + data/
  public/          前端静态文件（web/dist 的内容）
/etc/systemd/system/monitor.service
```

### 关键端口与依赖

| 项 | 值 |
|---|---|
| 监听端口 | 默认 **80**（配置项 `port`） |
| 日志来源 | Xray `access.log`（配置项 `logPath`） |
| 运行环境 | Node.js **>= 18**（推荐 20 LTS），x86_64 Linux |
| 内存限制 | systemd 限定 384M |

## 2. 部署前检查（目标 VPS）

需要 root 密码登录（SSH 22 端口）。依次确认：

```bash
# 系统与架构（需 Linux x86_64）
cat /etc/os-release | head -3; uname -m

# glibc 版本 —— CentOS 7 是 2.17，官方 Node 20 二进制需要 >= 2.28
ldd --version | head -1

# 是否已有 Node
node -v

# Xray 日志位置（常见候选，逐个试）
ls /etc/v2ray-agent/xray/access.log /usr/local/etc/xray/access.log /var/log/xray/access.log 2>/dev/null
tail -2 <找到的access.log>   # 确认格式形如 "2026/11/06 12:00:00.000000 from 1.2.3.4:5678 accepted tcp:example.com:443 [outbound] email: user"

# 80 端口未被占用
ss -tln | grep ':80 ' || echo "80 free"

# 防火墙放行 80（firewalld 为例）
systemctl is-active firewalld && firewall-cmd --list-ports | grep -w 80/tcp || echo "need to open 80"
```

> **CentOS 7 (glibc 2.17) 注意**：官方 Node 20 二进制无法运行，必须用非官方 glibc-217 构建：
> `https://unofficial-builds.nodejs.org/download/release/v20.20.2/node-v20.20.2-linux-x64-glibc-217.tar.gz`（glibc >= 2.28 的系统直接用官方 `https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-x64.tar.xz`）。
>
> **SELinux**：若为 Enforcing，node 绑定 80 可能被拦。生产环境建议 `Disabled`，或执行 `semanage port -a -t http_port_t -p tcp 80`。

## 3. 本地准备（仓库根目录）

需要本机装有 Node.js >= 18 和 npm。以下命令在**仓库根目录**执行（Windows 下用 Git Bash 时需给命令加前缀 `MSYS_NO_PATHCONV=1`，否则传给 node 的 POSIX 路径会被改写成 Windows 路径）。

```bash
# 1) 构建后端
cd server && npm install && npm run build && cd ..

# 2) 构建前端
cd web && npm install && npm run build && cd ..

# 3) 打两个包：server 与 public（仅含运行时需要的文件）
rm -rf tmp-deploy && mkdir -p tmp-deploy/server tmp-deploy/public
cp -r server/dist tmp-deploy/server/dist
cp server/package.json server/package-lock.json tmp-deploy/server/
cp -r web/dist/* tmp-deploy/public/
tar -czf tmp-deploy/server.tar.gz -C tmp-deploy server
tar -czf tmp-deploy/public.tar.gz -C tmp-deploy public
```

## 4. 目标机安装步骤

以下命令通过 SSH 在目标机上执行（`$NODE_VER` 按第 2 节检查结果选择）。

### 4.1 安装 Node.js（若已有可跳过）

```bash
# glibc >= 2.28：
curl -sL -o /tmp/node.tar.xz https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-x64.tar.xz
# glibc 2.17（CentOS 7）：
curl -sL -o /tmp/node.tar.gz https://unofficial-builds.nodejs.org/download/release/v20.20.2/node-v20.20.2-linux-x64-glibc-217.tar.gz

mkdir -p /usr/local/lib/nodejs
tar -xf /tmp/node.tar.* -C /usr/local/lib/nodejs
NODE_DIR=$(ls -d /usr/local/lib/nodejs/node-v20.*-linux-x64*)
ln -sf $NODE_DIR/bin/node /usr/local/bin/node
ln -sf $NODE_DIR/bin/npm /usr/local/bin/npm
node -v   # 应输出 v20.x
```

### 4.2 上传并解压

把 `tmp-deploy/server.tar.gz`、`tmp-deploy/public.tar.gz` 上传到目标机 `/tmp/`（SFTP/SCP 均可），然后：

```bash
mkdir -p /opt/monitor
rm -rf /opt/monitor/server /opt/monitor/public
tar -xzf /tmp/server.tar.gz -C /opt/monitor
tar -xzf /tmp/public.tar.gz -C /opt/monitor
rm -f /tmp/server.tar.gz /tmp/public.tar.gz
```

### 4.3 安装后端依赖

```bash
cd /opt/monitor/server && npm install --omit=dev --no-audit --no-fund
```

### 4.4 写入配置

```bash
cat > /opt/monitor/server/config.json <<'EOF'
{
  "port": 80,
  "token": "",
  "adminPassword": "admin123",
  "logPath": "/etc/v2ray-agent/xray/access.log",
  "dataDir": "/opt/monitor/server/data",
  "publicDir": "/opt/monitor/public",
  "rangeHours": 24,
  "trafficQuotaGB": 0
}
EOF
```

`token` 留空时首次启动自动生成 32 位十六进制并写回该文件（前端登录后自动使用，无需手工处理）。
**已有 `config.json` 的机器上升级时切勿覆盖它**（会重置 token，已登录的用户需要重新登录）。

配置项说明：

| 字段 | 默认 | 说明 |
|---|---|---|
| `port` | 8080 | 服务监听端口（部署用 80） |
| `token` | 自动生成 | API 鉴权令牌，空则自动生成 |
| `adminPassword` | `admin123` | 前端登录密码 |
| `logPath` | `/etc/v2ray-agent/xray/access.log` | Xray access.log 路径 |
| `dataDir` | `./data` | 持久化数据目录 |
| `publicDir` | `../public` | 前端静态目录 |
| `rangeHours` | 24 | 默认统计时间范围 |
| `trafficQuotaGB` | 0 | 每月流量配额（GB），>0 时「服务器」页显示本月剩余流量；0 表示不限/未配置 |

### 4.5 systemd 服务

```bash
cat > /etc/systemd/system/monitor.service <<'EOF'
[Unit]
Description=Access Monitor (NestJS)
After=network.target

[Service]
WorkingDirectory=/opt/monitor/server
ExecStart=/usr/local/bin/node dist/main.js
Restart=always
RestartSec=3
MemoryMax=384M

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now monitor
```

### 4.6 防火墙放行

```bash
# firewalld（CentOS/RHEL）
firewall-cmd --permanent --add-port=80/tcp && firewall-cmd --reload
# ufw（Debian/Ubuntu，如有）
ufw allow 80/tcp
# 云厂商控制台的安全组也需放行 80
```

## 5. 验证

```bash
systemctl is-active monitor          # 应为 active
journalctl -u monitor --no-pager -n 20   # 应看到 "monitor ready: log=..., events=N" 与 "listening on :80"
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/   # 应为 200
```

浏览器访问 `http://<VPS_IP>/`，应出现绿色主题的登录页；输入访问密码（默认 `admin123`）登录后，总览页应显示请求数、流量、速率等真实数据（日志有新写入时 30 秒内刷新）。

## 6. 升级与回滚

**升级**：本地重新构建 → 重复第 3 节打包、第 4.2 节解压（保留原 `config.json` 和 `data/`）→ `systemctl restart monitor`。

**仅更新前端**：解压新 `public` 到 `/opt/monitor/public-new`，然后：

```bash
rm -rf /opt/monitor/public-old
mv /opt/monitor/public /opt/monitor/public-old
mv /opt/monitor/public-new /opt/monitor/public
# 无需重启服务（静态文件直接读盘）；回滚则把 public-old 换回来
```

## 7. 常见问题

| 现象 | 排查 |
|---|---|
| 服务起不来，journal 报 `EADDRINUSE` | 80 被占用：`ss -tlnp \| grep :80`，换 `port` 或停用占用者 |
| 页面能开但无数据 | `journalctl -u monitor` 看 `monitor ready: log=...` 的路径是否正确、日志是否有新写入；确认 Xray 服务在跑 |
| CentOS 7 上 node 报 `GLIBC_2.28 not found` | 用了官方二进制，换成第 2 节的 unofficial glibc-217 构建 |
| SELinux  enforcing 下 80 绑定失败/访问被拒 | 见第 2 节 SELinux 说明 |
| 升级后前端要求重新登录 | `config.json` 被覆盖、token 变了，属预期 |
