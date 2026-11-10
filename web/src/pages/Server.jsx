import React, { useState } from 'react';
import { Col, Progress, Row, Tag, Tooltip, Typography } from 'antd';
import { ProCard } from '@ant-design/pro-components';
import { api } from '../api';
import { useMonitor, usePoll, fmtBytes, fmtNum, timeAgo } from '../monitor';
import HeroStat from '../components/HeroStat';

const { Text } = Typography;

function fmtDuration(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分`;
}

function levelColor(pct) {
  if (pct >= 90) return '#ef4444';
  if (pct >= 75) return '#f59e0b';
  return '#52c41a';
}

function UsageRow({ label, sub, pct, text, color }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <Text style={{ fontSize: 13 }}>{label}</Text>
        {sub ? <Text type="secondary" style={{ fontSize: 12 }}>{sub}</Text> : null}
        <span style={{ flex: 1 }} />
        <Text className="mono" style={{ fontSize: 12.5, color: color || '#101828' }}>{text}</Text>
      </div>
      <Progress
        percent={Math.round(pct * 10) / 10}
        showInfo={false}
        strokeColor={color || levelColor(pct)}
        trailColor="#f0f1f3"
        size={['100%', 8]}
      />
    </div>
  );
}

function InfoItem({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid #f7f8fa' }}>
      <Text type="secondary" style={{ fontSize: 12.5, width: 84, flexShrink: 0 }}>{label}</Text>
      <Text style={{ fontSize: 13, wordBreak: 'break-all' }}>{children}</Text>
    </div>
  );
}

export default function Server() {
  const { tickAt } = useMonitor();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  usePoll(async () => {
    setLoading(true);
    try {
      const s = await api.server();
      setInfo(s);
    } finally {
      setLoading(false);
    }
  }, []);

  const cpu = info?.cpu;
  const mem = info?.memory;
  const disk = info?.disk;
  const net = info?.network;
  const host = info?.host;
  const proc = info?.process;

  const memPct = mem?.usagePct ?? 0;
  const diskPct = disk?.usagePct ?? 0;
  const cpuPct = cpu?.usagePct ?? 0;
  const hasQuota = (net?.quotaGB ?? 0) > 0;
  const monthPct = net?.monthUsagePct ?? 0;

  return (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <ProCard className="monitor-card hero-card" loading={loading && !info} bodyStyle={{ padding: 0 }}>
            <HeroStat
              title="CPU 使用率"
              value={cpuPct}
              precision={1}
              suffix="%"
              color={levelColor(cpuPct)}
              sub={`${cpu?.cores ?? 0} 核 · 负载 ${cpu ? `${cpu.load1.toFixed(2)} / ${cpu.load5.toFixed(2)} / ${cpu.load15.toFixed(2)}` : '—'}`}
            />
          </ProCard>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <ProCard className="monitor-card hero-card" loading={loading && !info} bodyStyle={{ padding: 0 }}>
            <HeroStat
              title="内存使用率"
              value={memPct}
              precision={1}
              suffix="%"
              color={levelColor(memPct)}
              sub={`${fmtBytes(mem?.used)} / ${fmtBytes(mem?.total)}`}
            />
          </ProCard>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <ProCard className="monitor-card hero-card" loading={loading && !info} bodyStyle={{ padding: 0 }}>
            <HeroStat
              title="磁盘使用率"
              value={diskPct}
              precision={1}
              suffix="%"
              color={levelColor(diskPct)}
              sub={`${fmtBytes(disk?.used)} / ${fmtBytes(disk?.total)}`}
            />
          </ProCard>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <ProCard className="monitor-card hero-card" loading={loading && !info} bodyStyle={{ padding: 0 }}>
            <HeroStat
              title={hasQuota ? '本月剩余流量' : '本月已用流量'}
              value={hasQuota ? fmtBytes(net?.remaining) : fmtBytes(net?.monthUsed)}
              color={hasQuota ? levelColor(monthPct) : undefined}
              sub={
                hasQuota
                  ? `配额 ${net.quotaGB} GB · 已用 ${fmtBytes(net?.monthUsed)}`
                  : `上行 ${fmtBytes(net?.monthTx)} · 下行 ${fmtBytes(net?.monthRx)}`
              }
            />
          </ProCard>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={10}>
          <ProCard className="monitor-card" title="资源使用" loading={loading && !info}>
            <UsageRow
              label="CPU"
              sub={cpu?.model}
              pct={cpuPct}
              text={`${cpuPct.toFixed(1)}%`}
            />
            <UsageRow
              label="内存"
              sub={`可用 ${fmtBytes(mem?.available)}`}
              pct={memPct}
              text={`${fmtBytes(mem?.used)} / ${fmtBytes(mem?.total)}`}
            />
            {(mem?.swapTotal ?? 0) > 0 ? (
              <UsageRow
                label="Swap"
                sub={fmtBytes(mem?.swapTotal)}
                pct={mem?.swapPct ?? 0}
                text={`${(mem?.swapPct ?? 0).toFixed(1)}%`}
              />
            ) : null}
            <UsageRow
              label="磁盘"
              sub={`${disk?.items?.length ?? 0} 个分区`}
              pct={diskPct}
              text={`${fmtBytes(disk?.used)} / ${fmtBytes(disk?.total)}`}
            />
            {hasQuota ? (
              <UsageRow
                label="本月流量"
                sub={`${net?.monthLabel} · 配额 ${net.quotaGB} GB`}
                pct={monthPct}
                text={`${fmtBytes(net?.monthUsed)} / ${net.quotaGB} GB`}
              />
            ) : null}
          </ProCard>
        </Col>

        <Col xs={24} xl={14}>
          <ProCard className="monitor-card" title="系统信息" loading={loading && !info}>
            <Row gutter={[24, 0]}>
              <Col xs={24} md={12}>
                <InfoItem label="主机名">{host?.hostname || '—'}</InfoItem>
                <InfoItem label="操作系统">{host?.os || '—'}</InfoItem>
                <InfoItem label="内核版本">{host?.kernel || '—'}</InfoItem>
                <InfoItem label="架构">{host?.arch || '—'}</InfoItem>
              </Col>
              <Col xs={24} md={12}>
                <InfoItem label="运行时长">
                  <Tooltip title={`上次启动约 ${timeAgo(Date.now() - (host?.uptimeSec || 0) * 1000)}`}>
                    {fmtDuration(host?.uptimeSec)}
                  </Tooltip>
                </InfoItem>
                <InfoItem label="时区">{host?.timezone || '—'}</InfoItem>
                <InfoItem label="Node">{host?.nodeVersion || '—'}</InfoItem>
                <InfoItem label="进程内存">{`${fmtBytes(proc?.rss)}（PID ${proc?.pid ?? '—'}）`}</InfoItem>
              </Col>
            </Row>
            {(host?.addresses?.length ?? 0) > 0 ? (
              <div style={{ marginTop: 12 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>网络地址</Text>
                <div style={{ marginTop: 6 }}>
                  {host.addresses.map((a) => (
                    <Tag key={`${a.iface}-${a.address}`} className="mono" style={{ marginBottom: 6 }}>
                      {a.iface} · {a.address}
                    </Tag>
                  ))}
                </div>
              </div>
            ) : null}
          </ProCard>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={12}>
          <ProCard className="monitor-card" title="磁盘分区" loading={loading && !info} bodyStyle={{ padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #f0f1f3' }}>
                  <th style={thStyle}>挂载点</th>
                  <th style={thStyle}>设备</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>已用 / 总量</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>使用率</th>
                </tr>
              </thead>
              <tbody>
                {(disk?.items || []).map((d) => (
                  <tr key={`${d.device}-${d.mount}`} style={{ borderBottom: '1px solid #f7f8fa' }}>
                    <td style={tdStyle}>
                      <span className="mono">{d.mount}</span>
                    </td>
                    <td style={{ ...tdStyle, color: '#667085' }}>
                      <span className="mono" style={{ fontSize: 12 }}>{d.device}</span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }} className="mono">
                      {fmtBytes(d.used)} / {fmtBytes(d.total)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <span className="mono" style={{ color: levelColor(d.usagePct) }}>
                        {d.usagePct.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ProCard>
        </Col>

        <Col xs={24} xl={12}>
          <ProCard className="monitor-card" title="网络流量" loading={loading && !info}>
            <InfoItem label="接口">{net?.iface || '—'}</InfoItem>
            <InfoItem label="实时下行">{`${fmtNum(Math.round((net?.rxRate || 0) * 8))} Kbps`}</InfoItem>
            <InfoItem label="实时上行">{`${fmtNum(Math.round((net?.txRate || 0) * 8))} Kbps`}</InfoItem>
            <InfoItem label="累计下行">{fmtBytes(net?.rxTotal)}</InfoItem>
            <InfoItem label="累计上行">{fmtBytes(net?.txTotal)}</InfoItem>
            <InfoItem label="本月用量">
              {`${fmtBytes(net?.monthUsed)}（下行 ${fmtBytes(net?.monthRx)} · 上行 ${fmtBytes(net?.monthTx)}）`}
            </InfoItem>
            <InfoItem label="流量配额">
              {hasQuota ? `${net.quotaGB} GB · 剩余 ${fmtBytes(net?.remaining)}` : '未配置（config.json 的 trafficQuotaGB）'}
            </InfoItem>
            <div style={{ marginTop: 10 }}>
              <Text type="secondary" style={{ fontSize: 11.5 }}>
                采集于 {tickAt ? timeAgo(tickAt) : '—'} · CPU / 网络为 5 秒采样瞬时值
              </Text>
            </div>
          </ProCard>
        </Col>
      </Row>
    </div>
  );
}

const thStyle = {
  textAlign: 'left',
  padding: '12px 16px',
  fontSize: 12,
  color: '#667085',
  fontWeight: 600,
  background: '#fafbfc',
};
const tdStyle = { padding: '12px 16px', fontSize: 13 };
