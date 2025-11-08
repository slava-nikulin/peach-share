const GOOGLE_STUN_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun2.l.google.com:19302',
  'stun:stun3.l.google.com:19302',
  'stun:stun4.l.google.com:19302',
];

export function getIceServers(): RTCIceServer[] {
  const env = import.meta.env;
  const useEmulator = env.VITE_USE_EMULATORS === 'true';

  if (!useEmulator) {
    return GOOGLE_STUN_SERVERS.map((urls) => ({ urls }));
  }

  const hostname = window.location.hostname;
  const normalizedHost =
    hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;

  return [{ urls: `stun:${normalizedHost}:3478` }];
}
