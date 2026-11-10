import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { config } from './config';

const statfsSync: ((p: string) => any) | undefined = (fs as any).statfsSync;

const DISK_FS = ['ext2', 'ext3', 'ext4', 'xfs', 'btrfs'];
const SAMPLE_MS = 5000;

interface MonthTraffic {
  month: string;
  rx: number;
  tx: number;
}

function readFileText(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 服务器基础信息采集（Linux 读 /proc，其他平台退化为 Node 内置接口） */
@Injectable()
export class ServerInfoService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;

  private cpuLast: { idle: number; total: number } | null = null;
  private cpuUsage = 0;

  private netLast: { t: number; rx: number; tx: number } | null = null;
  private netRate = { rx: 0, tx: 0 };
  private netTotals = { rx: 0, tx: 0 };
  private netIface: string | null = null;

  private month: MonthTraffic = { month: monthKey(), rx: 0, tx: 0 };
  private monthDirty = false;

  onModuleInit() {
    this.loadMonth();
    this.sampleCpu();
    this.sampleNet();
    this.timer = setInterval(() => {
      this.sampleCpu();
      this.sampleNet();
    }, SAMPLE_MS);
    this.flushTimer = setInterval(() => this.flushMonth(), 60000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushMonth();
  }

  // ---------- 月度流量累计 ----------

  private monthFile(): string {
    return path.join(config.dataDir, 'monthly-traffic.json');
  }

  private loadMonth() {
    const text = readFileText(this.monthFile());
    if (!text) return;
    try {
      const saved = JSON.parse(text) as MonthTraffic;
      if (saved.month === monthKey()) {
        this.month = { month: saved.month, rx: saved.rx || 0, tx: saved.tx || 0 };
      }
    } catch {
      // ignore malformed file
    }
  }

  private flushMonth() {
    if (!this.monthDirty) return;
    try {
      fs.writeFileSync(this.monthFile(), JSON.stringify(this.month));
      this.monthDirty = false;
    } catch {
      // ignore write failure
    }
  }

  private addMonth(rx: number, tx: number) {
    const key = monthKey();
    if (this.month.month !== key) {
      this.month = { month: key, rx: 0, tx: 0 };
    }
    this.month.rx += rx;
    this.month.tx += tx;
    this.monthDirty = true;
  }

  // ---------- 采样 ----------

  private sampleCpu() {
    const text = readFileText('/proc/stat');
    if (text) {
      const line = text.split('\n')[0];
      const f = line.trim().split(/\s+/).slice(1).map(Number);
      if (f.length < 4 || f.some((n) => Number.isNaN(n))) return;
      const idle = f[3] + (f[4] || 0);
      const total = f.reduce((s, n) => s + n, 0);
      if (this.cpuLast) {
        const dTotal = total - this.cpuLast.total;
        const dIdle = idle - this.cpuLast.idle;
        if (dTotal > 0) {
          const usage = ((dTotal - dIdle) / dTotal) * 100;
          this.cpuUsage = Math.min(100, Math.max(0, usage));
        }
      }
      this.cpuLast = { idle, total };
      return;
    }
    // 非 Linux：用 os.cpus() 时间片差值估算
    const cpus = os.cpus();
    if (!cpus.length) return;
    let idle = 0;
    let total = 0;
    for (const c of cpus) {
      for (const v of Object.values(c.times)) total += v;
      idle += c.times.idle;
    }
    if (this.cpuLast) {
      const dTotal = total - this.cpuLast.total;
      const dIdle = idle - this.cpuLast.idle;
      if (dTotal > 0) {
        this.cpuUsage = Math.min(100, Math.max(0, ((dTotal - dIdle) / dTotal) * 100));
      }
    }
    this.cpuLast = { idle, total };
  }

  private readNetTotals(): { name: string; rx: number; tx: number } | null {
    const text = readFileText('/proc/net/dev');
    if (!text) return null;
    let best: { name: string; rx: number; tx: number } | null = null;
    for (const row of text.split('\n').slice(2)) {
      const m = row.match(/^\s*([^:]+):\s*(.+)$/);
      if (!m) continue;
      const name = m[1].trim();
      if (name === 'lo') continue;
      const f = m[2].trim().split(/\s+/).map(Number);
      if (f.length < 9) continue;
      const rx = f[0];
      const tx = f[8];
      if (!best || rx + tx > best.rx + best.tx) best = { name, rx, tx };
    }
    return best;
  }

  private sampleNet() {
    const cur = this.readNetTotals();
    if (!cur) return;
    const now = Date.now();
    this.netIface = cur.name;
    this.netTotals = { rx: cur.rx, tx: cur.tx };
    if (this.netLast) {
      const dRx = cur.rx - this.netLast.rx;
      const dTx = cur.tx - this.netLast.tx;
      const seconds = (now - this.netLast.t) / 1000;
      if (dRx >= 0 && dTx >= 0 && seconds > 0) {
        this.netRate = { rx: dRx / seconds, tx: dTx / seconds };
        this.addMonth(dRx, dTx);
      }
    }
    this.netLast = { t: now, rx: cur.rx, tx: cur.tx };
  }

  // ---------- 系统信息 ----------

  private osName(): string {
    const text = readFileText('/etc/os-release');
    if (text) {
      const m = text.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
      if (m) return m[1];
      const id = text.match(/^NAME="?([^"\n]+)"?/m);
      if (id) return id[1];
    }
    return `${os.type()} ${os.release()}`;
  }

  private cpuModel(): string {
    const text = readFileText('/proc/cpuinfo');
    if (text) {
      const m = text.match(/^model name\s*:\s*(.+)$/m);
      if (m) return m[1].trim();
    }
    const cpus = os.cpus();
    return cpus.length ? cpus[0].model.trim() : '未知';
  }

  private memoryInfo() {
    const text = readFileText('/proc/meminfo');
    if (!text) {
      const total = os.totalmem();
      const free = os.freemem();
      return {
        total,
        used: total - free,
        free,
        available: free,
        usagePct: total ? ((total - free) / total) * 100 : 0,
        swapTotal: 0,
        swapUsed: 0,
        swapPct: 0,
      };
    }
    const kv: Record<string, number> = {};
    for (const line of text.split('\n')) {
      const m = line.match(/^(\w+):\s+(\d+)(?:\s+kB)?/);
      if (m) kv[m[1]] = Number(m[2]) * 1024;
    }
    const total = kv.MemTotal || 0;
    const available = kv.MemAvailable || kv.MemFree || 0;
    const used = Math.max(0, total - available);
    const swapTotal = kv.SwapTotal || 0;
    const swapFree = kv.SwapFree || 0;
    const swapUsed = Math.max(0, swapTotal - swapFree);
    return {
      total,
      used,
      free: kv.MemFree || 0,
      available,
      usagePct: total ? (used / total) * 100 : 0,
      swapTotal,
      swapUsed,
      swapPct: swapTotal ? (swapUsed / swapTotal) * 100 : 0,
    };
  }

  private disks() {
    const out: Array<{
      device: string;
      mount: string;
      fsType: string;
      total: number;
      used: number;
      free: number;
      usagePct: number;
    }> = [];

    const push = (device: string, mount: string, fsType: string, skipSameTotal = false) => {
      if (!statfsSync) return;
      let st: any;
      try {
        st = statfsSync(mount);
      } catch {
        return;
      }
      if (!st || !st.bsize || !st.blocks) return;
      const total = st.blocks * st.bsize;
      const used = (st.blocks - st.bfree) * st.bsize;
      const free = (st.bavail ?? st.bfree) * st.bsize;
      if (total <= 0) return;
      // 无挂载表时无法区分设备，总量相同视为同一文件系统
      if (skipSameTotal && out.some((d) => d.total === total)) return;
      out.push({
        device,
        mount,
        fsType,
        total,
        used,
        free,
        usagePct: used + free > 0 ? (used / (used + free)) * 100 : 0,
      });
    };

    const mounts = readFileText('/proc/mounts');
    if (mounts) {
      const seen = new Set<string>();
      for (const line of mounts.split('\n')) {
        const [device, mount, fsType] = line.split(/\s+/);
        if (!device || !mount || !fsType) continue;
        if (!DISK_FS.includes(fsType)) continue;
        if (seen.has(device)) continue;
        seen.add(device);
        push(device, mount.replace(/\\040/g, ' '), fsType);
      }
    }
    if (!out.length) {
      push('(本地磁盘)', '/', 'local', true);
    }
    return out;
  }

  private netAddresses() {
    const out: Array<{ iface: string; address: string; family: string }> = [];
    const nets = os.networkInterfaces();
    for (const [iface, list] of Object.entries(nets)) {
      if (iface === 'lo') continue;
      for (const item of list || []) {
        if (typeof item.address !== 'string') continue;
        if (item.internal) continue;
        out.push({ iface, address: item.address, family: item.family });
      }
    }
    return out;
  }

  info() {
    const mem = this.memoryInfo();
    const disks = this.disks();
    const totalDisk = disks.reduce((s, d) => s + d.total, 0);
    const usedDisk = disks.reduce((s, d) => s + d.used, 0);
    const quotaGB = Number(config.trafficQuotaGB) || 0;
    const monthUsed = this.month.rx + this.month.tx;
    const quotaBytes = quotaGB * 1024 ** 3;
    const load = os.loadavg();
    const procMem = process.memoryUsage();

    return {
      host: {
        hostname: os.hostname(),
        os: this.osName(),
        kernel: os.release(),
        arch: os.arch(),
        platform: os.platform(),
        uptimeSec: os.uptime(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        nodeVersion: process.version,
        addresses: this.netAddresses(),
      },
      cpu: {
        model: this.cpuModel(),
        cores: os.cpus().length,
        usagePct: this.cpuUsage,
        load1: load[0] || 0,
        load5: load[1] || 0,
        load15: load[2] || 0,
      },
      memory: mem,
      disk: {
        items: disks,
        total: totalDisk,
        used: usedDisk,
        usagePct: totalDisk ? (usedDisk / totalDisk) * 100 : 0,
      },
      network: {
        iface: this.netIface,
        rxTotal: this.netTotals.rx,
        txTotal: this.netTotals.tx,
        rxRate: this.netRate.rx,
        txRate: this.netRate.tx,
        monthLabel: this.month.month,
        monthRx: this.month.rx,
        monthTx: this.month.tx,
        monthUsed,
        quotaGB,
        quotaBytes,
        remaining: quotaGB > 0 ? Math.max(0, quotaBytes - monthUsed) : null,
        monthUsagePct: quotaBytes > 0 ? Math.min(100, (monthUsed / quotaBytes) * 100) : 0,
      },
      process: {
        pid: process.pid,
        rss: procMem.rss,
        heapUsed: procMem.heapUsed,
        uptimeSec: process.uptime(),
      },
      serverTime: Date.now(),
    };
  }
}
