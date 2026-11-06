import React, { useEffect, useState } from 'react';
import { LogoutOutlined, SafetyOutlined } from '@ant-design/icons';
import { App as AntApp, Button } from 'antd';
import { api, getToken, setToken, clearToken } from './api';
import { MonitorProvider, useMonitor } from './monitor';
import RangeBar from './components/RangeBar';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Traffic from './pages/Traffic';
import Clients from './pages/Clients';
import Security from './pages/Security';
import Logs from './pages/Logs';

const TABS = [
  { key: 'overview', label: '总览' },
  { key: 'traffic', label: '流量' },
  { key: 'clients', label: '客户端' },
  { key: 'security', label: '安全' },
  { key: 'logs', label: '日志' },
];

function Shell({ onLogout, siteName }) {
  const { hours, setHours, auto, setAuto, refresh } = useMonitor();
  const [tab, setTabState] = useState(() => localStorage.getItem('monitor-tab') || 'overview');
  const [refreshing, setRefreshing] = useState(false);

  const setTab = (k) => {
    setTabState(k);
    localStorage.setItem('monitor-tab', k);
  };

  const doRefresh = () => {
    setRefreshing(true);
    refresh();
    setTimeout(() => setRefreshing(false), 600);
  };

  const active = TABS.find((t) => t.key === tab) || TABS[0];

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-logo">
              <SafetyOutlined />
            </span>
            <span className="brand-name">访问监控</span>
            <span className="brand-sub">LIVE</span>
          </div>

          <nav className="tab-nav" aria-label="监控视图切换">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`tab-btn ${t.key === active.key ? 'active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="header-actions">
            <RangeBar
              hours={hours}
              onHours={setHours}
              auto={auto}
              onAuto={setAuto}
              onRefresh={doRefresh}
              loading={refreshing}
            />
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={onLogout}
              className="logout-btn"
            >
              退出
            </Button>
          </div>
        </div>
      </header>

      <main className="app-main">
        <div key={active.key} className="anim-page tab-panel">
          {active.key === 'overview' && <Overview />}
          {active.key === 'traffic' && <Traffic />}
          {active.key === 'clients' && <Clients />}
          {active.key === 'security' && <Security />}
          {active.key === 'logs' && <Logs />}
        </div>
        <div className="app-footer">
          {siteName} · 数据来自 Xray access.log · 每 30 秒自动刷新
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const { message } = AntApp.useApp();
  const [authed, setAuthed] = useState(!!getToken());
  const [siteName, setSiteName] = useState('代理访问监控');

  useEffect(() => {
    const urlToken = new URLSearchParams(window.location.search).get('token');
    if (urlToken) {
      setToken(urlToken);
      window.history.replaceState(null, '', window.location.pathname);
      setAuthed(true);
    }
    api.meta().then((m) => setSiteName(m.siteName || siteName)).catch(() => {});
    const onExpire = () => {
      setAuthed(false);
      message.warning('登录已过期，请重新登录');
    };
    window.addEventListener('monitor-unauthorized', onExpire);
    return () => window.removeEventListener('monitor-unauthorized', onExpire);
  }, []);

  if (!authed) {
    return <Login onOk={() => setAuthed(true)} />;
  }

  return (
    <MonitorProvider>
      <Shell
        siteName={siteName}
        onLogout={() => {
          clearToken();
          setAuthed(false);
        }}
      />
    </MonitorProvider>
  );
}
