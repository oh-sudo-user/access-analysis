import React, { useState } from 'react';
import { Alert, Col, Row } from 'antd';
import { ProCard } from '@ant-design/pro-components';
import { api } from '../api';
import { useMonitor, usePoll, fmtNum } from '../monitor';
import HeroStat from '../components/HeroStat';
import TopNList, { flagEmoji } from '../components/TopNList';
import EventsTable from '../components/EventsTable';

export default function Security() {
  const { hours } = useMonitor();
  const [sec, setSec] = useState(null);
  const [loading, setLoading] = useState(true);

  usePoll(async () => {
    setLoading(true);
    try {
      const s = await api.security(hours);
      setSec(s);
    } finally {
      setLoading(false);
    }
  }, [hours]);

  const threatLevel =
    !sec || sec.rejected === 0 ? 'low' : sec.rejected < 50 ? 'medium' : 'high';
  const threatText = { low: '低', medium: '中', high: '高' }[threatLevel];
  const threatColor = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' }[threatLevel];

  return (
    <div>
      <Alert
        style={{ marginBottom: 16, borderRadius: 12 }}
        type={threatLevel === 'low' ? 'success' : threatLevel === 'medium' ? 'warning' : 'error'}
        showIcon
        message={
          threatLevel === 'low'
            ? '当前未检测到明显威胁，节点运行正常'
            : threatLevel === 'medium'
              ? `检测到 ${fmtNum(sec?.rejected)} 次被拒绝的连接尝试，建议关注来源 IP`
              : `警告：近 ${sec?.rangeHours} 小时内 ${fmtNum(sec?.rejected)} 次连接被拒绝，可能存在扫描或爆破行为`
        }
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <ProCard className="monitor-card hero-card" loading={loading && !sec} bodyStyle={{ padding: 0 }}>
            <HeroStat
              title="被拒绝连接"
              value={sec?.rejected ?? 0}
              color={sec?.rejected ? '#ef4444' : '#22c55e'}
              sub={sec?.rejected ? '需要关注' : '一切正常'}
            />
          </ProCard>
        </Col>
        <Col xs={24} sm={8}>
          <ProCard className="monitor-card hero-card" loading={loading && !sec} bodyStyle={{ padding: 0 }}>
            <HeroStat
              title="涉及来源 IP"
              value={sec?.topIps?.length ?? 0}
              sub="按拒绝次数排序"
            />
          </ProCard>
        </Col>
        <Col xs={24} sm={8}>
          <ProCard className="monitor-card hero-card" loading={loading && !sec} bodyStyle={{ padding: 0 }}>
            <HeroStat
              title="威胁等级"
              value={threatText}
              color={threatColor}
              sub={`近 ${sec?.rangeHours ?? hours} 小时评估`}
            />
          </ProCard>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={8}>
          <ProCard className="monitor-card" title="被拒次数最多的 IP" loading={loading && !sec}>
            <TopNList items={sec?.topIps} loading={loading && !sec} />
          </ProCard>
        </Col>
        <Col xs={24} lg={8}>
          <ProCard className="monitor-card" title="被拒来源国家/地区" loading={loading && !sec}>
            <TopNList
              items={sec?.topCountries}
              loading={loading && !sec}
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
          <ProCard className="monitor-card" title="被拒目标" loading={loading && !sec}>
            <TopNList items={sec?.topTargets} loading={loading && !sec} />
          </ProCard>
        </Col>
      </Row>

      <ProCard className="monitor-card" title="最近被拒绝的请求" style={{ marginTop: 16 }} bodyStyle={{ padding: 0 }}>
        <EventsTable events={sec?.recent || []} loading={loading && !sec} />
      </ProCard>
    </div>
  );
}
