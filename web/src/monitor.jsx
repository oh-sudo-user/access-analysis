import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const MonitorContext = createContext(null);

export function MonitorProvider({ children }) {
  const [hours, setHoursState] = useState(() => Number(localStorage.getItem('monitor-hours')) || 24);
  const [auto, setAuto] = useState(true);
  const [tick, setTick] = useState(0);
  const [tickAt, setTickAt] = useState(() => Date.now());

  const setHours = useCallback((h) => {
    setHoursState(h);
    localStorage.setItem('monitor-hours', String(h));
  }, []);

  const refresh = useCallback(() => {
    setTickAt(Date.now());
    setTick((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!auto) return undefined;
    const id = setInterval(() => {
      setTickAt(Date.now());
      setTick((v) => v + 1);
    }, 30000);
    return () => clearInterval(id);
  }, [auto]);

  return (
    <MonitorContext.Provider value={{ hours, setHours, auto, setAuto, tick, tickAt, refresh }}>
      {children}
    </MonitorContext.Provider>
  );
}

export function useMonitor() {
  return useContext(MonitorContext);
}

// run fn whenever deps or tick change; guard against overlapping async runs
export function usePoll(fn, deps) {
  const { tick } = useMonitor();
  const busy = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    (async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        await fnRef.current();
      } catch { /* errors surfaced by caller via its own state */ }
      if (!alive) return;
      busy.current = false;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
}

export function bucketSize(hours) {
  if (hours <= 1) return 1;
  if (hours <= 6) return 5;
  if (hours <= 24) return 30;
  return 180;
}

export function fmtBytes(n) {
  if (n == null) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtNum(n) {
  return (n || 0).toLocaleString('zh-CN');
}

export function timeAgo(t, now = Date.now()) {
  if (!t) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 10) return '刚刚';
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}
