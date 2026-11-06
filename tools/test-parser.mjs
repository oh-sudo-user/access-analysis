// Quick local test of the Xray access-log line regex used in server/index.js
const LINE_RE =
  /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z|\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\.\d+)\s+(?:\[\w+\]\s+\[access\]\s+)?from\s+(?:(?:tcp|udp):)?(\d{1,3}(?:\.\d{1,3}){3}):(\d+)\s+(accepted|rejected)\s+(?:(?:tcp|udp):(\S+?)(?::(\d+))?)?\s*\[([^\]]+)\](?:\s+email:\s*(\S+))?/;

const samples = [
  // real formats observed on the VPS
  '2026/11/06 03:07:00.610182 from 127.0.0.1:60310 accepted tcp:platform.dash.cloudflare.com:443 [z_direct_outbound] email: webguicai-vless_reality_vision',
  '2026/11/06 03:07:01.472913 from 39.174.87.214:55989 accepted tcp:127.0.0.1:45987 [dokodemo-in-VLESSReality >> z_direct_outbound]',
  '2026/11/06 03:07:03.289297 from 127.0.0.1:60336 accepted tcp:3w3w.top:443 [z_direct_outbound] email: webguicai-vless_reality_vision',
  // ISO variant (older xray / v2ray style)
  '2026-11-06T01:23:45.123Z [info] [access] from tcp:111.22.3.4:5678 accepted tcp:www.example.com:443 [dokodemo-in-VLESSReality -> z_direct_outbound]',
  '2026-11-06T01:23:47.000Z [info] [access] from tcp:45.155.3.2:40001 rejected  [dokodemo-in -> blackhole_out]',
  // WS inbound, real client ip with domain
  '2026/11/06 03:10:11.123456 from 36.24.58.89:40211 accepted tcp:www.google.com:443 [VLESS_WS_TLS >> z_direct_outbound] email: cdn-ws',
];

for (const s of samples) {
  const m = s.match(LINE_RE);
  if (!m) { console.log('NO MATCH :', s); continue; }
  const skip = /^\d{1,3}(\.\d{1,3}){3}$/.test((m[5] || '').toLowerCase()) && m[5] === '127.0.0.1';
  console.log(JSON.stringify({ ts: m[1], ip: m[2], action: m[4], host: m[5], tag: m[7], email: m[8], skipLoopback: skip }));
}
