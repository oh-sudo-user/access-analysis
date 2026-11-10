import React, { useState } from 'react';
import { Col, Empty, Row, Tag, Typography } from 'antd';
import { ProCard } from '@ant-design/pro-components';
import { api } from '../api';
import { useMonitor, usePoll, fmtNum } from '../monitor';
import HeroStat from '../components/HeroStat';
import TopNList, { flagEmoji } from '../components/TopNList';

const { Text } = Typography;

function UserProfileCard({ user }) {
  return (
    <div className="profile-item">
      <div className="profile-head">
        <Tag color="green" style={{ marginRight: 0 }}>VLESS</Tag>
        <Text strong className="mono" style={{ fontSize: 13 }}>{user.key}</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {fmtNum(user.count)} 次访问 · {user.uniqueSites} 个网站 · {user.uniqueIps} 个 IP
        </Text>
      </div>
      <Row gutter={[16, 8]}>
        <Col xs={24} lg={12}>
          <Text type="secondary" style={{ fontSize: 12 }}>常访问网站 Top {user.sites.length}</Text>
          <TopNList items={user.sites} max={10} />
        </Col>
        <Col xs={24} lg={12}>
          <Text type="secondary" style={{ fontSize: 12 }}>来源 IP Top {user.ips.length}</Text>
          <TopNList items={user.ips} max={10} />
        </Col>
      </Row>
    </div>
  );
}

export default function Clients() {
  const { hours } = useMonitor();
  const [ov, setOv] = useState(null);
  const [ips, setIps] = useState([]);
  const [countries, setCountries] = useState([]);
  const [users, setUsers] = useState([]);
  const [transport, setTransport] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);

  usePoll(async () => {
    setLoading(true);
    try {
      const [o, ip, ct, us, tr, pf] = await Promise.all([
        api.overview(hours),
        api.top('ip', hours, 10),
        api.countries(hours, 10),
        api.top('user', hours, 10),
        api.top('transport', hours, 5),
        api.userProfile(hours, 10, 10),
      ]);
      setOv(o);
      setIps(ip.items);
      setCountries(ct.items);
      setUsers(us.items);
      setTransport(tr.items);
      setProfiles(pf.items);
    } finally {
      setLoading(false);
    }
  }, [hours]);

  return (
    <div className="page-stack">
      {/* KPI 指标：按重要性排序 接入用户 > 独立客户端 > 目标域名 > 国家地区 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <ProCard className="monitor-card hero-card" loading={loading && !ov} bodyStyle={{ padding: 0 }}>
            <HeroStat
              title="接入用户"
              value={ov?.uniqueUsers ?? 0}
              sub={users[0] ? `主力 ${users[0].key}` : '暂无数据'}
            />
          </ProCard>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <ProCard className="monitor-card hero-card" loading={loading && !ov} bodyStyle={{ padding: 0 }}>
            <HeroStat
              title="独立客户端"
              value={ov?.uniqueClients ?? 0}
              sub={`热门 IP ${ips.length ? ips[0].key : '—'}`}
            />
          </ProCard>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <ProCard className="monitor-card hero-card" loading={loading && !ov} bodyStyle={{ padding: 0 }}>
            <HeroStat
              title="访问目标域名"
              value={fmtNum(ov?.uniqueDomains)}
              sub={`共 ${fmtNum(ov?.requests)} 次请求`}
            />
          </ProCard>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <ProCard className="monitor-card hero-card" loading={loading && !ov} bodyStyle={{ padding: 0 }}>
            <HeroStat
              title="覆盖国家/地区"
              value={countries.length}
              sub={countries[0] ? `${flagEmoji(countries[0].key)} ${countries[0].name} 最多` : '暂无数据'}
            />
          </ProCard>
        </Col>
      </Row>

      {/* 排行分布：接入用户 > 客户端 IP > 国家地区 > 传输协议 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <ProCard className="monitor-card" title="接入用户" loading={loading && users.length === 0}>
            <TopNList
              items={users}
              loading={loading && users.length === 0}
              renderKey={(it) => (
                <span>
                  <Tag color="green" style={{ marginRight: 6 }}>VLESS</Tag>
                  <Text className="mono" style={{ fontSize: 12.5 }}>{it.key}</Text>
                </span>
              )}
            />
          </ProCard>
        </Col>
        <Col xs={24} lg={12}>
          <ProCard className="monitor-card" title="热门客户端 IP" loading={loading && ips.length === 0}>
            <TopNList items={ips} loading={loading && ips.length === 0} />
          </ProCard>
        </Col>
        <Col xs={24} lg={12}>
          <ProCard className="monitor-card" title="国家/地区分布" loading={loading && countries.length === 0}>
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
        <Col xs={24} lg={12}>
          <ProCard className="monitor-card" title="传输协议" loading={loading && transport.length === 0}>
            <TopNList items={transport} loading={loading && transport.length === 0} />
          </ProCard>
        </Col>
      </Row>

      {/* 明细：用户访问画像 */}
      <ProCard
        className="monitor-card"
        title="用户访问画像（常访问网站 / IP Top 10）"
        loading={loading && profiles.length === 0}
        bodyStyle={{ padding: 0 }}
      >
        {profiles.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '32px 0' }} />
        ) : (
          profiles.map((u) => <UserProfileCard key={u.key} user={u} />)
        )}
      </ProCard>
    </div>
  );
}
