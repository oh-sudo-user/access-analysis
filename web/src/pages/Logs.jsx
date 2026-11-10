import React, { useState } from 'react';
import { Button, Input, Modal, Segmented, Typography } from 'antd';
import { ProCard } from '@ant-design/pro-components';
import { DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import { App as AntApp } from 'antd';
import { api } from '../api';
import { useMonitor, usePoll, fmtBytes, fmtNum } from '../monitor';
import EventsTable from '../components/EventsTable';

const { Text } = Typography;

export default function Logs() {
  const { hours, refresh } = useMonitor();
  const { message, modal } = AntApp.useApp();
  const [action, setAction] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);
  const [clearing, setClearing] = useState(false);

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
          (e.email || '').toLowerCase().includes(keyword.toLowerCase()) ||
          (e.addr || '').includes(keyword)
      )
    : events;

  const doClear = () => {
    modal.confirm({
      title: '确认清理全部日志？',
      icon: <DeleteOutlined style={{ color: '#ef4444' }} />,
      content: (
        <div>
          <p style={{ marginBottom: 8 }}>
            将清空面板已积累的访问记录，并把 Xray <Text className="mono">access.log</Text> 截断为 0 字节。
          </p>
          <p style={{ marginBottom: 0, color: '#ef4444' }}>
            此操作不可撤销，清理后统计与列表将从零重新累积。
          </p>
        </div>
      ),
      okText: '确认清理',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setClearing(true);
        try {
          const r = await api.clearLogs(true);
          setEvents([]);
          setCount(0);
          message.success(`已清理日志，释放 ${fmtBytes(r.freed)}`);
          refresh();
        } catch (e) {
          message.error(`清理失败：${e.message}`);
        } finally {
          setClearing(false);
        }
      },
    });
  };

  return (
    <ProCard
      className="monitor-card"
      title="访问日志"
      subTitle={`共 ${fmtNum(count)} 条（按时间倒序）`}
      bodyStyle={{ padding: 0 }}
      extra={
        <Button danger icon={<DeleteOutlined />} loading={clearing} onClick={doClear}>
          清空日志
        </Button>
      }
    >
      <div className="logs-toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: '#98a2b3' }} />}
          placeholder="搜索 IP / 域名 / 用户 / 地址"
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
