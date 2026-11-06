import React, { useId } from 'react';
import { Area, Column, Pie } from '@ant-design/plots';
import dayjs from 'dayjs';

const AXIS = {
  x: { label: { autoHide: true, autoRotate: false, style: { fill: '#98a2b3', fontSize: 11 } } },
  y: { label: { autoHide: true, style: { fill: '#98a2b3', fontSize: 11 } }, grid: { line: { style: { stroke: '#f0f1f3' } } } },
};

const GREEN = '#52c41a';
const GREEN_DARK = '#389e0d';
const GREEN_LIGHT = '#95de64';
const PIE_COLORS = [GREEN, GREEN_DARK, GREEN_LIGHT, '#8b5cf6', '#ef4444', '#06b6d4', '#f59e0b', '#64748b'];

export function fmtTime(t, hours) {
  return dayjs(t).format(hours > 48 ? 'MM-DD HH:mm' : 'HH:mm');
}

export function peakOf(buckets, field) {
  let peak = null;
  for (const b of buckets) {
    if (!peak || (b[field] || 0) > (peak[field] || 0)) peak = b;
  }
  return peak;
}

export function Spark({ data, color = GREEN, height = 44, width = 110 }) {
  const gid = useId().replace(/[:]/g, 'g');
  const list = (data || []).map((v) => +v || 0).filter((v) => Number.isFinite(v));
  if (list.length < 2) return <div style={{ height, width: '100%' }} />;
  const min = Math.min(...list);
  const max = Math.max(...list);
  const flat = max === min;
  const span = flat ? 1 : max - min;
  const padX = 2;
  const padY = 4;
  const stepX = (width - padX * 2) / (list.length - 1);
  const pts = list.map((v, i) => [
    padX + i * stepX,
    flat ? height / 2 : height - padY - ((v - min) / span) * (height - padY * 2),
  ]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const areaPath = `${line} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg
      className="spark-svg"
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.26" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.2" fill={color} />
    </svg>
  );
}

export function RequestsArea({ buckets, hours, height = 300 }) {
  const data = buckets.map((b) => ({ t: fmtTime(b.t, hours), requests: b.requests, type: '请求数' }));
  return (
    <Area
      data={data}
      xField="t"
      yField="requests"
      seriesField="type"
      colorField="type"
      smooth
      height={height}
      meta={{ color: { range: [GREEN] }, series: { range: [GREEN] } }}
      style={{ fillOpacity: 0.22 }}
      line={{ style: { lineWidth: 2 } }}
      xAxis={AXIS.x}
      yAxis={AXIS.y}
      tooltip={{ formatter: (d) => ({ name: '请求数', value: d.requests }) }}
    />
  );
}

export function TrafficArea({ buckets, hours, height = 300 }) {
  const data = [];
  for (const b of buckets) {
    const t = fmtTime(b.t, hours);
    data.push({ t, type: '下载', value: +(b.rx / 1048576).toFixed(2) });
    data.push({ t, type: '上传', value: +(b.tx / 1048576).toFixed(2) });
  }
  return (
    <Area
      data={data}
      xField="t"
      yField="value"
      seriesField="type"
      colorField="type"
      isStack
      smooth
      height={height}
      meta={{ color: { range: [GREEN_DARK, GREEN_LIGHT] }, series: { range: [GREEN_DARK, GREEN_LIGHT] } }}
      style={{ fillOpacity: 0.3 }}
      line={{ style: { lineWidth: 1.5 } }}
      xAxis={AXIS.x}
      yAxis={AXIS.y}
      legend={{ position: 'top-right' }}
      tooltip={{ formatter: (d) => ({ name: d.type, value: `${d.value} MB` }) }}
    />
  );
}

export function ResultColumn({ buckets, hours, height = 280 }) {
  const data = [];
  for (const b of buckets) {
    const t = fmtTime(b.t, hours);
    data.push({ t, type: '已接受', value: b.accepted });
    data.push({ t, type: '已拒绝', value: b.rejected });
  }
  return (
    <Column
      data={data}
      xField="t"
      yField="value"
      seriesField="type"
      colorField="type"
      isStack
      isPercent={false}
      height={height}
      meta={{ color: { range: ['#22c55e', '#ef4444'] }, series: { range: ['#22c55e', '#ef4444'] } }}
      columnStyle={{ radius: [3, 3, 0, 0] }}
      xAxis={AXIS.x}
      yAxis={AXIS.y}
      legend={{ position: 'top-right' }}
      tooltip={{ formatter: (d) => ({ name: d.type, value: d.value }) }}
    />
  );
}

export function ShareDonut({ items, height = 280, centerLabel }) {
  const data = items.map((x) => ({ type: x.key, value: x.count }));
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <Pie
      data={data}
      angleField="value"
      colorField="type"
      height={height}
      innerRadius={0.62}
      radius={0.9}
      meta={{ color: { range: PIE_COLORS } }}
      label={{ type: 'inner', offset: '-30%', content: '{percentage}', style: { fontSize: 12, textAlign: 'center' } }}
      legend={{ position: 'bottom' }}
      statistic={{
        title: false,
        content: {
          style: { fontSize: '18px', fontWeight: 600, color: '#101828' },
          formatter: () => centerLabel || `${total}`,
        },
      }}
      animation={{ appear: { animation: 'fade-in', duration: 600 } }}
    />
  );
}
