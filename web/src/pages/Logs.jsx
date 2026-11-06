import React, { useState } from 'react';
import { Input, Segmented, Space } from 'antd';
import { ProCard } from '@ant-design/pro-components';
import { SearchOutlined } from '@ant-design/icons';
import { api } from '../api';
import { useMonitor, usePoll, fmtNum } from '../monitor';
import EventsTable from '../components/EventsTable';

export default function Logs() {
  const { hours } = useMonitor();
  const [action, setAction] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);

  usePoll(async () => {
    setLoading(true);
    try {
      const ev = await api.events({ hours, limit: 500, action: action === 'all' ? undefined : action });
      setEvents(ev.items);
      setCount(ev.items.length);
    } finally {
      setLoading(false);
    }
  }, [hours, action]);

  const filtered = keyword.trim()
    ? events.filter(
        (e) =>
          e.host.toLowerCase().includes(keyword.toLowerCase()) ||
          e.ip.includes(keyword) ||
          (e.email || '').toLowerCase().includes(keyword.toLowerCase())
      )
    : events;

  return (
    <ProCard
      className="monitor-card"
      title="访问日志"
      subTitle={`共 ${fmtNum(count)} 条（按时间倒序）`}
      bodyStyle={{ padding: 0 }}
    >
      <div className="logs-toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: '#98a2b3' }} />}
          placeholder="搜索 IP / 域名 / 用户"
          style={{ width: 260, maxWidth: '100%' }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Segmented
          value={action}
          onChange={setAction}
          options={[
            { label: '全部', value: 'all' },
            { label: '已接受', value: 'accepted' },
            { label: '已拒绝', value: 'rejected' },
          ]}
        />
      </div>
      <EventsTable events={filtered} loading={loading && events.length === 0} showPagination />
    </ProCard>
  );
}
