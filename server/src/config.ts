import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

export interface AppConfig {
  port: number;
  token: string;
  adminPassword: string;
  logPath: string;
  dataDir: string;
  publicDir: string;
  rangeHours: number;
  siteName: string;
  trafficQuotaGB: number;
}

const configPath = process.env.MONITOR_CONFIG || path.join(process.cwd(), 'config.json');

const defaults: AppConfig = {
  port: 8080,
  token: '',
  // 生产环境务必在 config.json 里用 adminPassword 覆盖这个占位默认值
  adminPassword: 'admin123',
  logPath: '/etc/v2ray-agent/xray/access.log',
  dataDir: path.join(process.cwd(), 'data'),
  publicDir: path.join(process.cwd(), '..', 'public'),
  rangeHours: 24,
  siteName: '代理访问监控',
  trafficQuotaGB: 0,
};

let fileConfig: Partial<AppConfig> = {};
if (fs.existsSync(configPath)) {
  try {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    // ignore malformed config
  }
}

export const config: AppConfig = { ...defaults, ...fileConfig };

let generated = false;
if (!config.token) {
  config.token = randomBytes(16).toString('hex');
  generated = true;
}

if (!fs.existsSync(configPath)) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
} else if (generated) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

fs.mkdirSync(config.dataDir, { recursive: true });

export function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}
