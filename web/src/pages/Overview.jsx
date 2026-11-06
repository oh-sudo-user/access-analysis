import React, { useState } from 'react';
import { Col, Row, Segmented, Tooltip, Typography } from 'antd';
import { ProCard } from '@ant-design/pro-components';
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { api } from '../api';
import { useMonitor, usePoll, bucketSize, fmtBytes, fmtNum, timeAgo } from '../monitor';
import { RequestsArea, ResultColumn, peakOf, fmtTime } from '../components/charts';
import HeroStat from '../components/HeroStat';
import TopNList, { flagEmoji } from '../components/TopNList';
import EventsTable from '../components/EventsTable';

const { Text } = Typography;

export default function Overview() {
  const { hours } = useMonitor();
  const [ov, setOv] = useState(null);
  const [series, setSeries] = useState([]);
  const [domains, setDomains] = useState([]);
  const [ips, setIps] = useState([]);
  const [countries, setCountries] = useState([]);
  const [events, setEvents] = useState([]);
  const [mode, setMode] = useState('requests');
  const [loading, setLoading] = useState(true);

  usePoll(async () => {
    setLoading(true);
    try {
      const [o, ts, dom, ip, ct, ev] = await Promise.all([
        api.overview(hours),
        api.timeseries(hours, bucketSize(hours)),
        api.top('domain', hours, 8),
        api.top('ip', hours, 8),
        api.countries(hours, 6),
        api.events({ hours, limit: 10 }),
      ]);
      setOv(o);
      setSeries(ts.buckets);
      setDomains(dom.items);
      setIps(ip.items);
      setCountries(ct.items);
      setEvents(ev.items);
    } finally {
      setLoading(false);
    }
  }, [hours]);

  const rangeLabel = { 1: '1小时', 6: '6小时', 24: '24小时', 168: '7天' }[hours];
  const reqSpark = series.map((b) => b.requests);
  const trafficSpark = series.map((b) => (b.rx + b.tx) / 1048576);
  const peak = peakOf(series, 'requests');
  const lastEvent = events.length ? events[0] : null;

  return (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <ProCard className="monitor-card hero-card" loading={loading && !ov} bodyStyle={{ padding: 0 }}>
            <HeroStat
              title={`请求总数（近${rangeLabel}）`}
              value={ov?.requests ?? 0}
              spark={reqSpark}
              sparkColor="#52c41a"
              sub={`接受 ${fmtNum(ov?.accepted)} · 拒绝 ${fmtNum(ov?.rejected)}`}
            />
          </ProCard>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <ProCard className="monitor-card hero-card" loading={loading && !ov} bodyStyle={{ padding: 0 }}>
            <HeroStat
              title="数据传输总量"
              value={fmtBytes(ov?.bytesTotal)}
              spark={trafficSpark}
              sparkColor="#52c41a"
              sub={
                <span>
                  <ArrowDownOutlined style={{ color: '#389e0d' }} /> {fmtBytes(ov?.bytesRx)}
                  <span style={{ margin: '0 8px' }} />
                  <ArrowUpOutlined style={{ color: '#52c41a' }} /> {fmtBytes(ov?.bytesTx)}
                </span>
              }
            />
          </ProCard>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <ProCard className="monitor-card hero-card" loading={loading && !ov} bodyStyle={{ padding: 0 }}>
            <HeroStat
              title="当前速率"
              value={ov?.currentKbps?.toFixed(0) ?? 0}
              suffix=" Kbps"
              spark={trafficSpark}
              sparkColor="#52c41a"
              sub={
                <span>
                  <span className="live-dot" />
                  {ov?.netIface ? <span className="mono" style={{ marginRight: 6 }}>{ov.netIface}</span> : null}
                  独立客户端 {ov?.uniqueClients ?? 0} · 域名 {ov?.uniqueDomains ?? 0}
                </span>
              }
            />
          </ProCard>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <ProCard className="monitor-card hero-card" loading={loading && !ov} bodyStyle={{ padding: 0 }}>
            <HeroStat
              title="拒绝率"
              value={ov?.rejectedPct ?? 0}
              precision={2}
              suffix="%"
              color={(ov?.rejectedPct ?? 0) > 10 ? '#ef4444' : '#101828'}
              spark={series.map((b) => b.rejected)}
              sparkColor={(ov?.rejectedPct ?? 0) > 10 ? '#ef4444' : '#f59e0b'}
              sub={
                lastEvent
                  ? <Tooltip title={new Date(lastEvent.t).toLocaleString('zh-CN')}>最近活动 {timeAgo(lastEvent.t)}</Tooltip>
                  : '暂无活动'
              }
            />
          </ProCard>
        </Col>
      </Row>

      <ProCard
        className="monitor-card"
        style={{ marginTop: 16 }}
        bodyStyle={{ paddingTop: 12 }}
        title={
          <span>
            请求趋势
            {peak ? (
              <Tooltip title={`${fmtTime(peak.t, hours)} 达到峰值`}>
                <Text type="secondary" style={{ fontSize: 12, fontWeight: 400, marginLeft: 12 }}>
                  峰值 {fmtNum(peak.requests)} 次
                </Text>
              </Tooltip>
            ) : null}
          </span>
        }
        extra={
          <Segmented
            size="small"
            value={mode}
            onChange={setMode}
            options={[
              { label: '总量', value: 'requests' },
              { label: '接受 / 拒绝', value: 'result' },
            ]}
          />
        }
      >
        {mode === 'requests'
          ? <RequestsArea buckets={series} hours={hours} height={300} />
          : <ResultColumn buckets={series} hours={hours} height={300} />}
      </ProCard>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={8}>
          <ProCard className="monitor-card" title="国家 / 地区" loading={loading && countries.length === 0}>
            <TopNList
              items={countries}
              loading={loading && countries.length === 0}
              renderKey={(it) => (
                <span>
                  <span className="flag">{flagEmoji(it.key)}</span>
                  {it.name}
                </span>
              )}
            />
          </ProCard>
        </Col>
        <Col xs={24} lg={8}>
          <ProCard className="monitor-card" title="热门目标域名" loading={loading && domains.length === 0}>
            <TopNList items={domains} loading={loading && domains.length === 0} />
          </ProCard>
        </Col>
        <Col xs={24} lg={8}>
          <ProCard className="monitor-card" title="热门客户端 IP" loading={loading && ips.length === 0}>
            <TopNList items={ips} loading={loading && ips.length === 0} />
          </ProCard>
        </Col>
      </Row>

      <ProCard className="monitor-card" title="最近请求" style={{ marginTop: 16 }} bodyStyle={{ padding: 0 }}>
        <EventsTable events={events} loading={loading && events.length === 0} />
      </ProCard>
    </div>
  );
}
