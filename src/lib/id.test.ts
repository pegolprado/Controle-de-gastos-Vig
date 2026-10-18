import { describe, expect, it } from 'vitest';
import { stableUUID } from './id';

describe('stableUUID', () => {
  it('é igual ao public.stable_uuid() do banco (lançamento manual e piloto automático não duplicam)', async () => {
    // mesmo valor verificado em supabase/tests/37_renda_autopilot_push.test.sql
    expect(await stableUUID('finance-mv-fii|ws|XPML11|BRXPMLCTF000|RENDIMENTO|2026-10-23')).toBe('fc86bc7d-2014-5f59-a78f-574e6f89550e');
  });
});
