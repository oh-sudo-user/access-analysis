import React, { useState } from 'react';
import { Col, Row } from 'antd';
import { ProCard } from '@ant-design/pro-components';
import { api } from '../api';
import { useMonitor, usePoll, bucketSize, fmtBytes } from '../monitor';
import { TrafficArea, ShareDonut } from '../components/charts';
import HeroStat from '../components/HeroStat';

export default function Traffic() {
  const { hours } = useMonitor();
  const [ov, setOv] = useState(null);
  const [series, setSeries] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  usePoll(async () => {
    setLoading(true);
    try {
      const [o, ts, us] = await Promise.all([
        api.overview(hours),
        api.timeseries(hours, bucketSize(hours)),
        api.userShare(hours),
      ]);
      setOv(o);
      setSeries(ts.buckets);
      setUsers(us.items);
    } finally {
      setLoading(false);
    }
  }, [hours]);

  const trafficSpark = series.map((b) => (b.rx + b.tx) / 1048576);
  const rxSpark = series.map((b) => b.rx / 1048576);
  const txSpark = series.map((b) => b.tx / 1048576);

  return (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={8}>
          <ProCard className="monitor-card hero-card" loading={loading && !ov} bodyStyle={{ padding: 0 }}>
            <HeroStat
              title="总流量"
              value={fmtBytes(ov?.bytesTotal)}
              spark={trafficSpark}
              sparkColor="#52c41a"
              sub={`接口 ${ov?.netIface || '—'} · 当前约 ${ov?.currentKbps?.toFixed(0) ?? 0} Kbps`}
            />
          </ProCard>
        </Col>
        <Col xs={24} sm={12} xl={8}>
          <ProCard className="monitor-card hero-card" loading={loading && !ov} bodyStyle={{ padding: 0 }}>
            <HeroStat
              title="下载"
              value={fmtBytes(ov?.bytesRx)}
              color="#389e0d"
              spark={rxSpark}
              sparkColor="#389e0d"
              sub="客户端 → 节点方向（估算）"
            />
          </ProCard>
        </Col>
        <Col xs={24} sm={12} xl={8}>
          <ProCard className="monitor-card hero-card" loading={loading && !ov} bodyStyle={{ padding: 0 }}>
            <HeroStat
              title="上传"
              value={fmtBytes(ov?.bytesTx)}
              spark={txSpark}
              sparkColor="#52c41a"
              sub="节点 → 客户端方向（估算）"
            />
          </ProCard>
        </Col>
      </Row>

      <ProCard className="monitor-card" title="流量趋势（MB）" style={{ marginTop: 16 }} bodyStyle={{ paddingTop: 12 }}>
        <TrafficArea buckets={series} hours={hours} height={320} />
      </ProCard>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={10}>
          <ProCard className="monitor-card" title="用户流量占比（估算）" loading={loading && users.length === 0}>
            {users.length ? (
              <ShareDonut items={users} height={320} />
            ) : null}
          </ProCard>
        </Col>
        <Col xs={24} lg={14}>
          <ProCard className="monitor-card" title="用户明细（估算）" loading={loading && users.length === 0} bodyStyle={{ padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #f0f1f3' }}>
                  <th style={thStyle}>用户</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>连接数</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>占比</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>估算流量</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.key} style={{ borderBottom: '1px solid #f7f8fa' }}>
                    <td style={tdStyle}>{u.key}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }} className="mono">{u.count}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }} className="mono">{(u.share * 100).toFixed(1)}%</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }} className="mono">{fmtBytes(u.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
