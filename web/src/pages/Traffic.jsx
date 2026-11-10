import React, { useState } from 'react';
import { Col, Row, Table, Typography } from 'antd';
import { ProCard } from '@ant-design/pro-components';
import { api } from '../api';
import { useMonitor, usePoll, bucketSize, fmtBytes, fmtNum } from '../monitor';
import { TrafficArea, ShareDonut } from '../components/charts';
import HeroStat from '../components/HeroStat';

const { Text } = Typography;

const userColumns = [
  {
    title: '用户',
    dataIndex: 'key',
    ellipsis: true,
    render: (k) => <Text className="mono" style={{ fontSize: 13 }}>{k}</Text>,
  },
  {
    title: '连接数',
    dataIndex: 'count',
    width: 110,
    align: 'right',
    render: (v) => <span className="mono">{fmtNum(v)}</span>,
  },
  {
    title: '占比',
    dataIndex: 'share',
    width: 100,
    align: 'right',
    render: (v) => <span className="mono">{(v * 100).toFixed(1)}%</span>,
  },
  {
    title: '估算流量',
    dataIndex: 'bytes',
    width: 130,
    align: 'right',
    render: (v) => <span className="mono">{fmtBytes(v)}</span>,
  },
];

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
    <div className="page-stack">
      {/* KPI 指标：总流量 > 下载 > 上传 */}
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

      {/* 核心趋势 */}
      <ProCard className="monitor-card" title="流量趋势（MB）" bodyStyle={{ paddingTop: 12 }}>
        <TrafficArea buckets={series} hours={hours} height={320} />
      </ProCard>

      {/* 用户维度：明细表 + 占比图（各占 50%，边界对齐） */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <ProCard
            className="monitor-card"
            title="用户明细（估算）"
            loading={loading && users.length === 0}
            bodyStyle={{ padding: 0 }}
          >
            <Table
              rowKey="key"
              columns={userColumns}
              dataSource={users}
              size="small"
              tableLayout="fixed"
              pagination={false}
            />
          </ProCard>
        </Col>
        <Col xs={24} lg={12}>
          <ProCard className="monitor-card" title="用户流量占比（估算）" loading={loading && users.length === 0}>
            {users.length ? (
              <ShareDonut items={users} height={320} />
            ) : null}
          </ProCard>
        </Col>
      </Row>
    </div>
  );
}
