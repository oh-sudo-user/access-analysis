import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as dns from 'dns';
import { config } from './config';

export interface AccessEvent {
  t: number;
  ip: string;
  action: 'accepted' | 'rejected';
  host: string;
  dport?: number;
  transport?: string;
  tag: string;
  email: string;
  country: string;
  addr?: string;
  targetAddr?: string;
}

interface TrafficSample {
  t: number;
  rx: number;
  tx: number;
}

const MAX_EVENTS = 200000;
const MAX_SAMPLES = 200000;

const COUNTRY_NAMES: Record<string, string> = {
  CN: '中国', US: '美国', JP: '日本', SG: '新加坡', HK: '中国香港', TW: '中国台湾',
  KR: '韩国', GB: '英国', DE: '德国', FR: '法国', NL: '荷兰', RU: '俄罗斯',
  CA: '加拿大', AU: '澳大利亚', IN: '印度', BR: '巴西', IT: '意大利', ES: '西班牙',
  SE: '瑞典', CH: '瑞士', NO: '挪威', FI: '芬兰', DK: '丹麦', IE: '爱尔兰',
  PL: '波兰', TR: '土耳其', VN: '越南', TH: '泰国', MY: '马来西亚', ID: '印度尼西亚',
  PH: '菲律宾', UA: '乌克兰', CZ: '捷克', AT: '奥地利', BE: '比利时', PT: '葡萄牙',
  ZZ: '未知',
};

const LINE_RE =
  /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z|\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\.\d+)\s+(?:\[\w+\]\s+\[access\]\s+)?from\s+(?:(tcp|udp):)?(\d{1,3}(?:\.\d{1,3}){3}):(\d+)\s+(accepted|rejected)\s+(?:((?:tcp|udp):)(\S+?)(?::(\d+))?)?\s*\[([^\]]+)\](?:\s+email:\s*(\S+))?/;

function parseTs(s: string): number {
  if (s.includes('T')) return Date.parse(s);
  const t = new Date(s.replace(/\//g, '-').replace(/(\.\d{3})\d+/, '$1'));
  return t.getTime();
}

export function countryName(code: string): string {
  return COUNTRY_NAMES[code] || code || '未知';
}

// ---------- IP 归属地解析（在线 ip-api.com + 磁盘缓存） ----------

interface GeoInfo {
  cc: string;
  country: string;
  region: string;
  city: string;
  isp?: string;
}

// 免费版限制 45 请求/分钟；批量接口单次最多 100 个 IP，2 秒一批即 30 请求/分钟
const GEO_API =
  'http://ip-api.com/batch?fields=query,status,message,countryCode,country,regionName,city,isp&lang=zh-CN';
const GEO_BATCH_INTERVAL = 2000;
const GEO_BATCH_SIZE = 100;

const PRIVATE_RE =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fc|fd|fe80)/i;

/**
 * 异步批量解析 IP 归属地：查询只读缓存（同步返回），未命中的 IP 进入队列，
 * 由后台定时器按限速批量请求 ip-api.com 并写入磁盘缓存，下一轮轮询自动补全。
 */
class GeoResolver {
  private cache = new Map<string, GeoInfo>();
  private pending = new Set<string>();
  private attempts = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;
  private readonly cacheFile: string;

  constructor(dataDir: string, private readonly logger: Logger) {
    this.cacheFile = path.join(dataDir, 'ip-geo-cache.json');
    this.load();
  }

  start() {
    this.timer = setInterval(() => void this.drain(), GEO_BATCH_INTERVAL);
    this.saveTimer = setInterval(() => this.flush(), 60000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.flush();
  }

  private load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
      for (const [ip, info] of Object.entries(raw || {})) {
        this.cache.set(ip, info as GeoInfo);
      }
      this.logger.log(`geo cache loaded: ${this.cache.size} entries`);
    } catch {
      // 首次运行无缓存文件
    }
  }

  private flush() {
    if (!this.dirty) return;
    try {
      fs.writeFileSync(this.cacheFile, JSON.stringify(Object.fromEntries(this.cache)));
      this.dirty = false;
    } catch {
      // 缓存写失败不影响主流程
    }
  }

  /** 同步读取缓存；未命中则把 IP 加入待解析队列 */
  get(ip: string): GeoInfo | null {
    const hit = this.cache.get(ip);
    if (hit) return hit;
    this.pending.add(ip);
    return null;
  }

  private async drain() {
    if (!this.pending.size) return;
    const ips = [...this.pending].slice(0, GEO_BATCH_SIZE);
    try {
      const res = await fetch(GEO_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ips),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = (await res.json()) as Array<Record<string, unknown>>;
      const byQuery = new Map(list.map((x) => [String(x.query), x]));
      for (const ip of ips) {
        this.pending.delete(ip);
        const row = byQuery.get(ip) || {};
        const ok = row.status === 'success' && (row.country || row.countryCode);
        if (ok) {
          this.cache.set(ip, {
            cc: String(row.countryCode || 'ZZ'),
            country: String(row.country || ''),
            region: String(row.regionName || ''),
            city: String(row.city || ''),
            isp: String(row.isp || ''),
          });
          this.attempts.delete(ip);
          this.dirty = true;
          continue;
        }
        const msg = String(row.message || '');
        const permanent = /reserved|private|invalid/i.test(msg);
        const tries = (this.attempts.get(ip) || 0) + 1;
        if (permanent || tries >= 3) {
          this.cache.set(ip, { cc: 'ZZ', country: '', region: '', city: '' });
          this.attempts.delete(ip);
          this.dirty = true;
        } else {
          this.attempts.set(ip, tries);
          this.pending.add(ip);
        }
      }
      // 每批解析完立即落盘，避免进程异常退出丢失缓存
      this.flush();
    } catch (e) {
      // 网络异常：IP 保留在队列中，靠定时间隔自然退避重试
      this.logger.warn(`geo batch failed: ${(e as Error).message}`);
    }
  }
}

function joinAddr(country: string, province: string, city: string): string {
  const parts: string[] = [];
  if (country) parts.push(country);
  let prov = province;
  if (prov && city && (city === prov || prov === city.replace(/[省市]$/, ''))) prov = '';
  if (prov) parts.push(prov);
  if (city) parts.push(city);
  return parts.join(' ');
}

// ---------- 目标域名 → IP 解析（DNS + 磁盘缓存） ----------

const DNS_BATCH_INTERVAL = 3000;
const DNS_BATCH_SIZE = 50;

/**
 * 目标多为域名，需先 DNS 解析出 IP 才能查归属地。
 * 同步读缓存；未命中的域名进入待解析队列，由后台定时器批量 resolve，
 * 解析出的 IP 再交给 GeoResolver 做归属地查询。解析失败记为空串，不再重试。
 */
class TargetResolver {
  private cache = new Map<string, string>(); // domain -> ip（'' 表示解析失败/无记录）
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;
  private readonly cacheFile: string;

  constructor(
    dataDir: string,
    private readonly geo: GeoResolver,
    private readonly logger: Logger,
  ) {
    this.cacheFile = path.join(dataDir, 'target-ip-cache.json');
    this.load();
  }

  start() {
    this.timer = setInterval(() => void this.drain(), DNS_BATCH_INTERVAL);
    this.saveTimer = setInterval(() => this.flush(), 60000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.flush();
  }

  private load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
      for (const [d, ip] of Object.entries(raw || {})) {
        const addr = ip as string;
        this.cache.set(d, addr);
        if (addr) this.geo.get(addr); // 预热：把已解析 IP 推入归属地队列
      }
      this.logger.log(`target dns cache loaded: ${this.cache.size} entries`);
    } catch {
      // 首次运行无缓存文件
    }
  }

  private flush() {
    if (!this.dirty) return;
    try {
      fs.writeFileSync(this.cacheFile, JSON.stringify(Object.fromEntries(this.cache)));
      this.dirty = false;
    } catch {
      // 缓存写失败不影响主流程
    }
  }

  /** 同步读取缓存；返回 ip（可能为 ''），未命中返回 null 并加入待解析队列 */
  get(domain: string): string | null {
    if (this.cache.has(domain)) return this.cache.get(domain) as string;
    this.pending.add(domain);
    return null;
  }

  private async drain() {
    if (!this.pending.size) return;
    const domains = [...this.pending].slice(0, DNS_BATCH_SIZE);
    const results = await Promise.allSettled(
      domains.map((d) => dns.promises.resolve4(d)),
    );
    for (let i = 0; i < domains.length; i++) {
      const d = domains[i];
      this.pending.delete(d);
      const r = results[i];
      if (r.status === 'fulfilled' && r.value.length) {
        const ip = r.value[0];
        this.cache.set(d, ip);
        this.geo.get(ip); // 推入归属地解析队列
      } else {
        this.cache.set(d, ''); // 解析失败，标记为永久失败
      }
      this.dirty = true;
    }
    this.flush();
  }
}

const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

function normalizeHost(h: string | undefined): string | null {
  if (!h) return null;
  const host = h.toLowerCase();
  if (IP_RE.test(host)) return host;
  return host.replace(/^www\./, '');
}

@Injectable()
export class MonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitorService.name);

  private events: AccessEvent[] = [];
  private samples: TrafficSample[] = [];
  private writer: fs.WriteStream | null = null;
  private writerDay = '';

  private tailPos = 0;
  private tailBuf = '';
  private tailTimer: NodeJS.Timeout | null = null;
  private stateTimer: NodeJS.Timeout | null = null;
  private trafficTimer: NodeJS.Timeout | null = null;
  private lastNet: { name: string; rx: number; tx: number } | null = null;
  netIface: string | null = null;

  private recentOuter: Array<{ t: number; ip: string }> = [];
  private geo: GeoResolver | null = null;
  private targets: TargetResolver | null = null;

  onModuleInit() {
    this.geo = new GeoResolver(config.dataDir, this.logger);
    this.geo.start();
    this.targets = new TargetResolver(config.dataDir, this.geo, this.logger);
    this.targets.start();
    this.replayToday();
    this.tailInit();
    this.startTailer();
    this.startTrafficSampler();
    this.logger.log(
      `monitor ready: log=${config.logPath}, events=${this.events.length}`,
    );
  }

  onModuleDestroy() {
    for (const t of [this.tailTimer, this.stateTimer, this.trafficTimer]) {
      if (t) clearInterval(t);
    }
    if (this.targets) this.targets.stop();
    if (this.geo) this.geo.stop();
    if (this.writer) this.writer.end();
  }

  // ---------- IP 归属地（在线解析，同步读缓存） ----------

  private geoAddr(ip: string): string {
    if (!ip) return '未知';
    if (PRIVATE_RE.test(ip)) return '内网 IP';
    const g = this.geo ? this.geo.get(ip) : null;
    if (!g) return '解析中';
    return joinAddr(g.country, g.region, g.city) || '未知';
  }

  private geoCode(ip: string, fallback: string): string {
    if (!ip || PRIVATE_RE.test(ip)) return fallback || 'ZZ';
    return (this.geo ? this.geo.get(ip) : null)?.cc || fallback || 'ZZ';
  }

  private geoCountryLabel(ip: string, fallbackCode: string): string {
    if (!ip || PRIVATE_RE.test(ip)) return '内网';
    const g = this.geo ? this.geo.get(ip) : null;
    if (g && g.country) return g.country;
    return COUNTRY_NAMES[fallbackCode] || fallbackCode || '未知';
  }

  /** 目标（域名或 IP）归属地：域名先 DNS 解析出 IP 再查归属地 */
  private targetAddr(host: string): string {
    if (!host || host === '(无目标)') return '';
    if (IP_RE.test(host)) return this.geoAddr(host);
    const ip = this.targets ? this.targets.get(host) : null;
    if (ip === null) return '解析中';
    if (!ip) return ''; // DNS 解析失败
    return this.geoAddr(ip);
  }

  // ---------- persistence ----------

  private dayFile(t: number): string {
    const d = new Date(t);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return path.join(config.dataDir, `events-${y}${m}${day}.jsonl`);
  }

  private openWriter(t: number) {
    const key = this.dayFile(t);
    if (this.writer && this.writerDay === key) return;
    if (this.writer) this.writer.end();
    this.writerDay = key;
    this.writer = fs.createWriteStream(key, { flags: 'a' });
  }

  private replayToday() {
    const f = this.dayFile(Date.now());
    if (!fs.existsSync(f)) return;
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line) as AccessEvent;
        this.events.push(ev);
      } catch {
        // skip corrupt line
      }
    }
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
    this.logger.log(`replayed ${this.events.length} events`);
  }

  // ---------- parsing ----------

  private parseLine(line: string): AccessEvent | null {
    const m = line.match(LINE_RE);
    if (!m) return null;
    const t = parseTs(m[1]);
    if (Number.isNaN(t)) return null;
    const transport = m[2] || (m[6] ? m[6].replace(':', '') : undefined);
    const srcIp = m[3];
    const host = normalizeHost(m[7]);
    if (host === '127.0.0.1') {
      this.recentOuter.push({ t, ip: srcIp });
      if (this.recentOuter.length > 1000) this.recentOuter.shift();
      return null;
    }
    let ip = srcIp;
    if (ip === '127.0.0.1') {
      ip = this.pairOuterIp(t) || ip;
    }
    return {
      t,
      ip,
      action: m[5] as 'accepted' | 'rejected',
      host: host || '(无目标)',
      dport: m[8] ? Number(m[8]) : undefined,
      transport,
      tag: (m[9] || '').split(/->|>>/)[0].trim(),
      email: m[10] || '',
      country: this.geoCode(ip, ''),
    };
  }

  private pairOuterIp(t: number): string | null {
    for (let i = this.recentOuter.length - 1; i >= 0; i--) {
      const o = this.recentOuter[i];
      if (t - o.t > 5000) break;
      if (o.t <= t + 1000) return o.ip;
    }
    return null;
  }

  private pushEvent(ev: AccessEvent) {
    this.events.push(ev);
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
    this.openWriter(ev.t);
    this.writer!.write(JSON.stringify(ev) + '\n');
  }

  // ---------- 日志清理 ----------

  /** 清理统计与日志文件，返回释放的字节数；truncateSource 为 true 时同时截断 Xray access.log */
  clearLogs(truncateSource: boolean) {
    let freed = 0;

    // 1. 面板历史数据（data/events-*.jsonl）
    try {
      for (const name of fs.readdirSync(config.dataDir)) {
        if (!/^events-\d{8}\.jsonl$/.test(name)) continue;
        const file = path.join(config.dataDir, name);
        try {
          freed += fs.statSync(file).size;
          fs.truncateSync(file, 0);
        } catch {
          // 忽略单个文件失败，继续清理其余文件
        }
      }
    } catch {
      // dataDir 不可读时跳过
    }

    // 2. 当天写入流需重新打开，避免继续写入已截断的旧句柄
    if (this.writer) {
      this.writer.end();
      this.writer = null;
      this.writerDay = '';
    }

    // 3. 内存中的事件
    this.events = [];
    this.recentOuter = [];

    // 4. Xray 原始日志
    if (truncateSource) {
      try {
        const before = fs.statSync(config.logPath).size;
        fs.truncateSync(config.logPath, 0);
        freed += before;
        this.tailPos = 0;
        this.tailBuf = '';
        try {
          fs.writeFileSync(this.tailStatePath(), JSON.stringify({ pos: 0 }));
        } catch {
          // 忽略状态写入失败
        }
      } catch {
        // 日志文件不存在或无权限时跳过
      }
    }

    this.logger.log(
      `logs cleared: freed=${freed} bytes, truncateSource=${truncateSource}`,
    );
    return { freed, truncateSource };
  }

  // ---------- log tailing ----------

  private tailStatePath(): string {
    return path.join(config.dataDir, 'tail-state.json');
  }

  private tailInit() {
    try {
      const size = fs.statSync(config.logPath).size;
      if (fs.existsSync(this.tailStatePath())) {
        const st = JSON.parse(fs.readFileSync(this.tailStatePath(), 'utf8'));
        this.tailPos = Math.min(st.pos || 0, size);
      } else {
        this.tailPos = 0;
      }
    } catch {
      this.tailPos = 0;
    }
  }

  private startTailer() {
    this.tailTimer = setInterval(() => {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(config.logPath);
      } catch {
        return;
      }
      if (stat.size < this.tailPos) this.tailPos = 0;
      if (stat.size === this.tailPos) return;
      const stream = fs.createReadStream(config.logPath, {
        start: this.tailPos,
        end: stat.size - 1,
        encoding: 'utf8',
      });
      stream.on('data', (chunk: string) => {
        this.tailBuf += chunk;
        const lines = this.tailBuf.split('\n');
        this.tailBuf = lines.pop() || '';
        for (const line of lines) {
          const ev = this.parseLine(line);
          if (ev) this.pushEvent(ev);
        }
      });
      stream.on('end', () => {
        this.tailPos = stat.size;
      });
    }, 1000);

    this.stateTimer = setInterval(() => {
      try {
        fs.writeFileSync(
          this.tailStatePath(),
          JSON.stringify({ pos: this.tailPos }),
        );
      } catch {
        // ignore
      }
    }, 10000);
  }

  // ---------- traffic sampling ----------

  private startTrafficSampler() {
    this.trafficTimer = setInterval(() => this.sampleTraffic(), 5000);
    this.sampleTraffic();
  }

  private sampleTraffic() {
    let text: string;
    try {
      text = fs.readFileSync('/proc/net/dev', 'utf8');
    } catch {
      return;
    }
    const rows = text.split('\n').slice(2);
    let best: { name: string; rx: number; tx: number } | null = null;
    for (const row of rows) {
      const mm = row.match(/^\s*([^:]+):\s*(.+)$/);
      if (!mm) continue;
      const name = mm[1].trim();
      if (name === 'lo') continue;
      const f = mm[2].trim().split(/\s+/).map(Number);
      const rx = f[0];
      const tx = f[8];
      if (!best || rx + tx > best.rx + best.tx) best = { name, rx, tx };
    }
    if (!best) return;
    if (this.netIface && best.name !== this.netIface) this.lastNet = null;
    this.netIface = best.name;
    const now = Date.now();
    if (this.lastNet && best.rx >= this.lastNet.rx && best.tx >= this.lastNet.tx) {
      this.samples.push({
        t: now,
        rx: best.rx - this.lastNet.rx,
        tx: best.tx - this.lastNet.tx,
      });
      if (this.samples.length > MAX_SAMPLES) {
        this.samples.splice(0, this.samples.length - MAX_SAMPLES);
      }
    }
    this.lastNet = best;
  }

  // ---------- queries ----------

  private indexOfFirst(t: number): number {
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private cutOff(rangeHours: number): number {
    return Date.now() - rangeHours * 3600 * 1000;
  }

  overview(rangeHours: number) {
    const from = this.cutOff(rangeHours);
    let accepted = 0;
    let rejected = 0;
    const ips = new Set<string>();
    const domains = new Set<string>();
    const users = new Set<string>();
    for (let i = this.indexOfFirst(from); i < this.events.length; i++) {
      const ev = this.events[i];
      if (ev.action === 'accepted') accepted++;
      else rejected++;
      ips.add(ev.ip);
      domains.add(ev.host);
      if (ev.email) users.add(ev.email);
    }
    let rx = 0;
    let tx = 0;
    for (const s of this.samples) {
      if (s.t >= from) {
        rx += s.rx;
        tx += s.tx;
      }
    }
    const n = this.samples.length;
    let curRx = 0;
    let curTx = 0;
    for (let i = Math.max(0, n - 12); i < n; i++) {
      curRx += this.samples[i].rx;
      curTx += this.samples[i].tx;
    }
    const total = accepted + rejected;
    return {
      rangeHours,
      requests: total,
      accepted,
      rejected,
      rejectedPct: total ? (rejected / total) * 100 : 0,
      uniqueClients: ips.size,
      uniqueDomains: domains.size,
      uniqueUsers: users.size,
      bytesRx: rx,
      bytesTx: tx,
      bytesTotal: rx + tx,
      currentKbps: ((curRx + curTx) * 8) / (12 * 5) / 1000,
      netIface: this.netIface,
      totalEvents: this.events.length,
      serverTime: Date.now(),
    };
  }

  timeseries(rangeHours: number, bucketMin: number) {
    const from = this.cutOff(rangeHours);
    const bucketMs = bucketMin * 60 * 1000;
    const start = Math.floor(from / bucketMs) * bucketMs;
    const count = Math.ceil((Date.now() - start) / bucketMs);
    const buckets = new Array(count);
    for (let i = 0; i < count; i++) {
      buckets[i] = { t: start + i * bucketMs, requests: 0, accepted: 0, rejected: 0 };
    }
    for (let i = this.indexOfFirst(from); i < this.events.length; i++) {
      const ev = this.events[i];
      const idx = Math.floor((ev.t - start) / bucketMs);
      if (idx < 0 || idx >= count) continue;
      buckets[idx].requests++;
      if (ev.action === 'accepted') buckets[idx].accepted++;
      else buckets[idx].rejected++;
    }
    const rx = new Array(count).fill(0);
    const tx = new Array(count).fill(0);
    for (const s of this.samples) {
      if (s.t < from) continue;
      const idx = Math.floor((s.t - start) / bucketMs);
      if (idx >= 0 && idx < count) {
        rx[idx] += s.rx;
        tx[idx] += s.tx;
      }
    }
    return buckets.map((b, i) => ({ ...b, rx: rx[i], tx: tx[i] }));
  }

  top(dim: string, rangeHours: number, limit: number) {
    const from = this.cutOff(rangeHours);
    const map = new Map<string, { key: string; count: number; rejected: number }>();
    for (let i = this.indexOfFirst(from); i < this.events.length; i++) {
      const ev = this.events[i];
      let key: string;
      switch (dim) {
        case 'domain':
          key = ev.host;
          break;
        case 'ip':
          key = ev.ip;
          break;
        case 'country':
          key = this.geoCountryLabel(ev.ip, ev.country);
          break;
        case 'user':
          key = ev.email || '(匿名)';
          break;
        case 'port':
          key = ev.dport ? String(ev.dport) : '(未知)';
          break;
        case 'transport':
          key = (ev.transport || 'tcp').toUpperCase();
          break;
        default:
          key = ev.host;
      }
      const cur = map.get(key) || { key, count: 0, rejected: 0 };
      cur.count++;
      if (ev.action !== 'accepted') cur.rejected++;
      map.set(key, cur);
    }
    const items = [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
    if (dim === 'ip') {
      return items.map((x) => ({ ...x, addr: this.geoAddr(x.key) }));
    }
    if (dim === 'domain') {
      return items.map((x) => ({ ...x, addr: this.targetAddr(x.key) }));
    }
    return items;
  }

  topCountriesWithCode(rangeHours: number, limit: number) {
    const from = this.cutOff(rangeHours);
    const map = new Map<string, { key: string; count: number; rejected: number }>();
    for (let i = this.indexOfFirst(from); i < this.events.length; i++) {
      const ev = this.events[i];
      const code = this.geoCode(ev.ip, ev.country);
      const cur = map.get(code) || { key: code, count: 0, rejected: 0 };
      cur.count++;
      if (ev.action !== 'accepted') cur.rejected++;
      map.set(code, cur);
    }
    return [...map.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map((x) => ({ ...x, name: countryName(x.key) }));
  }

  eventsRecent(rangeHours: number, limit: number, action?: string) {
    const from = this.cutOff(rangeHours);
    const out: AccessEvent[] = [];
    for (let i = this.events.length - 1; i >= 0 && out.length < limit; i--) {
      const ev = this.events[i];
      if (ev.t < from) break;
      if (action && ev.action !== action) continue;
      out.push({ ...ev, addr: this.geoAddr(ev.ip), targetAddr: this.targetAddr(ev.host) });
    }
    return out;
  }

  security(rangeHours: number) {
    const from = this.cutOff(rangeHours);
    let rejected = 0;
    const ipMap = new Map<string, number>();
    const countryMap = new Map<string, number>();
    const targets = new Map<string, number>();
    const recent: AccessEvent[] = [];
    for (let i = this.indexOfFirst(from); i < this.events.length; i++) {
      const ev = this.events[i];
      if (ev.action !== 'rejected') continue;
      rejected++;
      ipMap.set(ev.ip, (ipMap.get(ev.ip) || 0) + 1);
      const code = this.geoCode(ev.ip, ev.country);
      countryMap.set(code, (countryMap.get(code) || 0) + 1);
      targets.set(ev.host, (targets.get(ev.host) || 0) + 1);
    }
    for (let i = this.events.length - 1; i >= 0 && recent.length < 50; i--) {
      const ev = this.events[i];
      if (ev.t < from) break;
      if (ev.action === 'rejected')
        recent.push({ ...ev, addr: this.geoAddr(ev.ip), targetAddr: this.targetAddr(ev.host) });
    }
    const toArr = (m: Map<string, number>) =>
      [...m.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    return {
      rangeHours,
      rejected,
      topIps: toArr(ipMap).map((x) => ({ ...x, addr: this.geoAddr(x.key) })),
      topCountries: toArr(countryMap).map((x) => ({ ...x, name: countryName(x.key) })),
      topTargets: toArr(targets).map((x) => ({ ...x, addr: this.targetAddr(x.key) })),
      recent,
    };
  }

  // 每个用户常访问的网站 / 来源 IP 画像（仅统计已接受的连接）
  userProfile(rangeHours: number, userLimit: number, itemLimit: number) {
    const from = this.cutOff(rangeHours);
    const users = new Map<
      string,
      { count: number; sites: Map<string, number>; ips: Map<string, number> }
    >();
    for (let i = this.indexOfFirst(from); i < this.events.length; i++) {
      const ev = this.events[i];
      if (ev.action !== 'accepted') continue;
      const key = ev.email || '(匿名)';
      let u = users.get(key);
      if (!u) {
        u = { count: 0, sites: new Map(), ips: new Map() };
        users.set(key, u);
      }
      u.count++;
      u.sites.set(ev.host, (u.sites.get(ev.host) || 0) + 1);
      u.ips.set(ev.ip, (u.ips.get(ev.ip) || 0) + 1);
    }
    const topOf = (m: Map<string, number>) =>
      [...m.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, itemLimit);
    return [...users.entries()]
      .map(([key, u]) => ({
        key,
        count: u.count,
        uniqueSites: u.sites.size,
        uniqueIps: u.ips.size,
        sites: topOf(u.sites).map((x) => ({ ...x, addr: this.targetAddr(x.key) })),
        ips: topOf(u.ips).map((x) => ({ ...x, addr: this.geoAddr(x.key) })),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, userLimit);
  }

  // 每个用户的流量占比估算：用事件数占比拆分区间总流量
  userShare(rangeHours: number) {
    const from = this.cutOff(rangeHours);
    const map = new Map<string, number>();
    let total = 0;
    for (let i = this.indexOfFirst(from); i < this.events.length; i++) {
      const ev = this.events[i];
      if (ev.action !== 'accepted') continue;
      total++;
      const key = ev.email || '(匿名)';
      map.set(key, (map.get(key) || 0) + 1);
    }
    let bytes = 0;
    for (const s of this.samples) if (s.t >= from) bytes += s.rx + s.tx;
    return [...map.entries()]
      .map(([key, count]) => ({
        key,
        count,
        share: total ? count / total : 0,
        bytes: total ? Math.round((bytes * count) / total) : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }
}
