import React, { useState } from 'react';
import { Button, Card, Form, Input, Typography, App as AntApp } from 'antd';
import { LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { api, setToken } from '../api';

const { Title, Text } = Typography;

export default function Login({ onOk }) {
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(0);

  const submit = async ({ password }) => {
    setLoading(true);
    try {
      const { token } = await api.login(password);
      setToken(token);
      message.success('登录成功，欢迎回来');
      onOk();
    } catch (e) {
      setShake((v) => v + 1);
      message.error(e.message === 'unauthorized' ? '密码错误，请重试' : `登录失败：${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-orb" style={{ width: 380, height: 380, background: '#52c41a', top: -120, right: -80 }} />
      <div className="login-orb" style={{ width: 320, height: 320, background: '#0ea5e9', bottom: -100, left: -60, animationDelay: '-4s' }} />
      <div className="login-orb" style={{ width: 200, height: 200, background: '#86efac', top: '55%', left: '18%', animationDelay: '-8s' }} />

      <Card className="login-card" variant="borderless">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 8 }}>
          <div className="login-logo">
            <SafetyCertificateOutlined />
          </div>
          <Title level={3} style={{ marginTop: 18, marginBottom: 4 }}>访问监控中心</Title>
          <Text type="secondary">Proxy Access Analytics · 实时洞察你的节点</Text>
        </div>
        <Form
          layout="vertical"
          size="large"
          onFinish={submit}
          style={{ marginTop: 20 }}
          key={shake}
        >
          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入访问密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#98a2b3' }} />}
              placeholder="访问密码"
              autoFocus
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 8 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={loading}
              style={{ height: 44, fontWeight: 600, letterSpacing: 4 }}
            >
              登 录
            </Button>
          </Form.Item>
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              仅限授权用户访问 · 所有操作将被记录
            </Text>
          </div>
        </Form>
      </Card>
    </div>
  );
}
