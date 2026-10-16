import { timingSafeEqual as equalBytes } from 'node:crypto';

export const isAddress = value => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
export function timingSafeEqual(a, b) {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && equalBytes(x, y);
}
