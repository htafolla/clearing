import { missingCdpKeyEnv } from './cdp-auth.js';

export function assertProductionRail(): void {
  const hosted = Boolean(process.env.RAILWAY_ENVIRONMENT) || process.env.NODE_ENV === 'production';
  if (!hosted) return;
  if ((process.env.CLEARING_FACILITATOR || '').trim() === 'cdp') {
    const missing = missingCdpKeyEnv();
    if (missing.length > 0) {
      throw new Error(`production Clearing CDP facilitator requires ${missing.join(' and ')}`);
    }
    return;
  }
  const signer = process.env.CLEARING_SIGNER || '';
  const token = (process.env.CLEARING_RAIL_TOKEN || process.env.ZIGZAG_RAIL_TOKEN || '').trim();
  if (signer !== 'zigzag' || !token) {
    throw new Error('production Clearing requires CLEARING_SIGNER=zigzag and CLEARING_RAIL_TOKEN');
  }
}
