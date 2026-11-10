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
        <div key={it.key} className="anim-enter topn-item">
          <span className={`rank-badge ${i < 3 ? `top${i + 1}` : ''}`}>{i + 1}</span>
          <div className="topn-key">
            <Tooltip title={it.key}>
              <Text ellipsis style={{ display: 'block', fontSize: 13 }} className={/^[\d.]+$/.test(it.key) ? 'mono' : ''}>
                {renderKey ? renderKey(it) : it.key}
              </Text>
            </Tooltip>
            {it.addr ? (
              <Tooltip title={it.addr}>
                <Text type="secondary" ellipsis style={{ display: 'block', fontSize: 11.5, lineHeight: 1.5 }}>
                  {it.addr}
                </Text>
              </Tooltip>
            ) : null}
          </div>
          <div className="topn-track">
            <div className="topn-bar" style={{ width: `${(it.count / top) * 100}%` }} />
          </div>
          <Text type="secondary" className="topn-count">
            {it.count} · {((it.count / total) * 100).toFixed(0)}%
          </Text>
        </div>
      ))}
    </div>
  );
}
