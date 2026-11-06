import React from 'react';
import { Empty, Tooltip, Typography } from 'antd';

const { Text } = Typography;

export function flagEmoji(code) {
  if (!code || code.length !== 2) return '🏳️';
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 - 65 + c.charCodeAt(0))
  );
}

export default function TopNList({ items, loading, renderKey, max = 10 }) {
  if (!loading && (!items || items.length === 0)) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '32px 0' }} />;
  }
  const list = (items || []).slice(0, max);
  const total = list.reduce((s, x) => s + x.count, 0) || 1;
  const top = list.length ? list[0].count : 1;
  return (
    <div style={{ paddingTop: 4 }}>
      {list.map((it, i) => (
        <div
          key={it.key}
          className="anim-enter"
          style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}
        >
          <span className={`rank-badge ${i < 3 ? `top${i + 1}` : ''}`}>{i + 1}</span>
          <Tooltip title={it.key}>
            <Text ellipsis style={{ width: 190, flexShrink: 0, fontSize: 13 }} className={/^[\d.]+$/.test(it.key) ? 'mono' : ''}>
              {renderKey ? renderKey(it) : it.key}
            </Text>
          </Tooltip>
          <div style={{ flex: 1, height: 8, background: '#f0f1f3', borderRadius: 6, overflow: 'hidden' }}>
            <div
              style={{
                width: `${(it.count / top) * 100}%`,
                height: '100%',
                borderRadius: 6,
                background: 'linear-gradient(90deg, #95de64, #52c41a)',
                transition: 'width 0.6s cubic-bezier(0.22, 0.61, 0.36, 1)',
              }}
            />
          </div>
          <Text type="secondary" style={{ width: 78, textAlign: 'right', fontSize: 12, flexShrink: 0 }}>
            {it.count} · {((it.count / total) * 100).toFixed(0)}%
          </Text>
        </div>
      ))}
    </div>
  );
}
