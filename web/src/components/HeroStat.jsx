import React from 'react';
import { Statistic } from 'antd';
import { Spark } from './charts';

export default function HeroStat({ title, value, sub, spark, sparkColor = '#52c41a', color, precision, suffix }) {
  return (
    <div className="hero-stat">
      <div className="hero-main">
        <div className="hero-title">{title}</div>
        <Statistic
          value={value ?? 0}
          precision={precision}
          suffix={suffix}
          valueStyle={{ fontSize: 28, fontWeight: 700, color: color || '#101828', lineHeight: 1.2 }}
        />
        <div className="hero-sub">{sub}</div>
      </div>
      {spark ? (
        <div className="hero-spark">
          <Spark data={spark} color={sparkColor} />
        </div>
      ) : null}
    </div>
  );
}
