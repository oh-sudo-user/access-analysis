import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const geoip = require('geoip-country');

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

function lookupCountry(ip: string): string {
  try {
    const c = geoip.lookup(ip);
    return (c && c.country) || 'ZZ';
  } catch {
    return 'ZZ';
  }
}

export function countryName(code: string): string {
  return COUNTRY_NAMES[code] || code || '未知';
}

function normalizeHost(h: string | undefined): string | null {
  if (!h) return null;
  const host = h.toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
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

  onModuleInit() {
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
    if (this.writer) this.writer.end();
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
        if (!ev.country) ev.country = lookupCountry(ev.ip);
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
      country: lookupCountry(ip),
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
          key = countryName(ev.country);
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
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
  }

  topCountriesWithCode(rangeHours: number, limit: number) {
    const from = this.cutOff(rangeHours);
    const map = new Map<string, { key: string; count: number; rejected: number }>();
    for (let i = this.indexOfFirst(from); i < this.events.length; i++) {
      const ev = this.events[i];
      const cur = map.get(ev.country) || { key: ev.country, count: 0, rejected: 0 };
      cur.count++;
      if (ev.action !== 'accepted') cur.rejected++;
      map.set(ev.country, cur);
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
      out.push(ev);
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
      countryMap.set(ev.country, (countryMap.get(ev.country) || 0) + 1);
      targets.set(ev.host, (targets.get(ev.host) || 0) + 1);
    }
    for (let i = this.events.length - 1; i >= 0 && recent.length < 50; i--) {
      const ev = this.events[i];
      if (ev.t < from) break;
      if (ev.action === 'rejected') recent.push(ev);
    }
    const toArr = (m: Map<string, number>) =>
      [...m.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    return {
      rangeHours,
      rejected,
      topIps: toArr(ipMap),
      topCountries: toArr(countryMap).map((x) => ({ ...x, name: countryName(x.key) })),
      topTargets: toArr(targets),
      recent,
    };
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
