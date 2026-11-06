import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntApp, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import './theme.css';

dayjs.locale('zh-cn');

ReactDOM.createRoot(document.getElementById('root')).render(
  <ConfigProvider
    locale={zhCN}
    theme={{
      token: {
        colorPrimary: '#52c41a',
        colorInfo: '#52c41a',
        borderRadius: 10,
        fontSize: 14,
        colorBgLayout: '#f5f7fa',
        colorTextBase: '#101828',
      },
      components: {
        Menu: {
          itemBorderRadius: 10,
          itemSelectedBg: 'rgba(82,196,26,0.12)',
          itemSelectedColor: '#389e0d',
          itemHoverBg: 'rgba(82,196,26,0.06)',
          itemHoverColor: '#389e0d',
        },
      },
      algorithm: antdTheme.defaultAlgorithm,
    }}
  >
    <AntApp>
      <App />
    </AntApp>
  </ConfigProvider>
);
