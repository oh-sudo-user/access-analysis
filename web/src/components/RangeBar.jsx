import React, { useEffect, useState } from 'react';
import { Button, Segmented, Switch, Tooltip, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useMonitor } from '../monitor';

export const RANGES = [
  { label: '1小时', value: 1 },
  { label: '6小时', value: 6 },
  { label: '24小时', value: 24 },
  { label: '7天', value: 168 },
];

export function useCompact(breakpoint = 768) {
  const [compact, setCompact] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth < breakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return compact;
}

function CountdownChip() {
  const { auto, tickAt } = useMonitor();
  const [, force] = useState(0);
  useEffect(() => {
    if (!auto) return undefined;
    const id = setInterval(() => force((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, [auto, tickAt]);
  if (!auto) return null;
  const left = Math.max(0, 30 - Math.floor((Date.now() - tickAt) / 1000));
  return <span className="countdown-chip">{left}s</span>;
}

export default function RangeBar({ hours, onHours, auto, onAuto, onRefresh, loading }) {
  const compact = useCompact();
  return (
    <div className="top-bar">
      <Tooltip title={auto ? '自动刷新已开启（每 30 秒）' : '自动刷新已关闭'}>
        <Space size={6}>
          <Switch size="small" checked={auto} onChange={onAuto} />
          {!compact && <span style={{ color: '#667085', fontSize: 13 }}>自动刷新</span>}
        </Space>
      </Tooltip>
      <CountdownChip />
      <Segmented
        size={compact ? 'small' : 'middle'}
        options={RANGES.map((r) => ({ label: r.label, value: r.value }))}
        value={hours}
        onChange={onHours}
      />
      <Tooltip title="立即刷新">
        <Button size={compact ? 'small' : 'middle'} icon={<ReloadOutlined />} loading={loading} onClick={onRefresh} />
      </Tooltip>
    </div>
  );
}
