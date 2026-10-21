/**
 * Локальный ли адрес: этот компьютер или домашняя/офисная сеть (телефон в той же Wi-Fi).
 * На таких адресах не загружается SDK Яндекс Игр и разрешён режим отладки.
 */
export function isLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '' || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === '::1' || h === '0.0.0.0') return true;
  // IPv6: уникальные локальные (fc00::/7) и link-local (fe80::/10)
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 127 || // этот компьютер
    a === 10 || // частная сеть 10.0.0.0/8
    (a === 192 && b === 168) || // частная сеть 192.168.0.0/16
    (a === 172 && b >= 16 && b <= 31) || // частная сеть 172.16.0.0/12
    (a === 169 && b === 254) // link-local
  );
}
