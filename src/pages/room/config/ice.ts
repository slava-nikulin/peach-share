export function getIceServers(): RTCIceServer[] {
  let raw = '';
  try {
    raw = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_STUN_URLS) || '';
  } catch {}
  if (!raw && typeof process !== 'undefined') {
    raw = process.env.VITE_STUN_URLS || '';
  }

  const urls = raw.trim() || 'stun:stun.l.google.com:19302';
  return urls
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((u) => ({ urls: u }));
}
