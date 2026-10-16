import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: { rpc: vi.fn() } }));
import { errorMessage } from './errors';

describe('errorMessage', () => {
  it('falhas de rede deixam claro que nada foi salvo', () => {
    expect(errorMessage({ message: 'TypeError: Failed to fetch' })).toMatch(/nada foi salvo/);
  });
  it('traduz erros comuns', () => {
    expect(errorMessage({ message: 'Invalid login credentials' })).toBe('E-mail ou senha incorretos.');
    expect(errorMessage({ code: '42501', message: 'new row violates row-level security policy' })).toMatch(/permissão/);
    expect(errorMessage({ code: '23503', message: 'fk' })).toMatch(/arquivá-lo/);
  });
});
