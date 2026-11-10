import React from 'react';
import { Table, Tag, Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';
import { timeAgo } from '../monitor';

const { Text } = Typography;

export const eventColumns = [
  {
    title: '时间',
    dataIndex: 't',
    width: 130,
    render: (t) => (
      <Tooltip title={dayjs(t).format('MM-DD HH:mm:ss')}>
        <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
          <span className="mono">{dayjs(t).format('HH:mm:ss')}</span>{' '}
          <Text type="secondary" style={{ fontSize: 12 }}>{timeAgo(t)}</Text>
        </span>
      </Tooltip>
    ),
  },
  {
    title: '客户端 IP',
    dataIndex: 'ip',
    width: 240,
    render: (ip, r) => (
      <div style={{ maxWidth: '100%' }}>
        <span className="mono" style={{ fontSize: 13 }}>{ip}</span>
        <Text type="secondary" ellipsis style={{ display: 'block', fontSize: 12, lineHeight: 1.5 }}>
          {r.addr || r.country}
        </Text>
      </div>
    ),
  },
  {
    title: '目标',
    dataIndex: 'host',
    ellipsis: true,
    render: (h, r) => (
      <Text ellipsis style={{ maxWidth: '100%', fontSize: 13 }} title={`${h}${r.dport ? `:${r.dport}` : ''}`}>
        {h}
        {r.dport ? <Text type="secondary" style={{ fontSize: 12 }}> :{r.dport}</Text> : null}
      </Text>
    ),
  },
  {
    title: '结果',
    dataIndex: 'action',
    width: 96,
    render: (a) =>
      a === 'accepted' ? <Tag color="success">已接受</Tag> : <Tag color="error">已拒绝</Tag>,
  },
  {
    title: '用户',
    dataIndex: 'email',
    width: 210,
    ellipsis: true,
    render: (e) => <span style={{ fontSize: 13 }}>{e || <Text type="secondary">—</Text>}</span>,
  },
];

export default function EventsTable({ events, loading, size = 'small', showPagination = false }) {
  return (
    <Table
      rowKey={(r) => `${r.t}-${r.ip}-${r.host}-${r.dport || 0}-${r.action}`}
      columns={eventColumns}
      dataSource={events}
      size={size}
      loading={loading}
      tableLayout="fixed"
      scroll={{ x: 'max-content' }}
      pagination={showPagination ? { pageSize: 20, size: 'small', showSizeChanger: false } : false}
    />
  );
}
