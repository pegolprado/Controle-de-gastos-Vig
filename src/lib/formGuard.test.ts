import { describe, expect, it, vi } from 'vitest';
import { hasDirtyForms, hasPendingWrites, onDirtyChange, setFormDirty, trackPending } from './formGuard';

describe('formGuard (proteção contra recarregar no meio de um lançamento)', () => {
  it('registra formulários sujos e notifica', () => {
    const fn = vi.fn();
    const off = onDirtyChange(fn);
    setFormDirty('a', true);
    expect(hasDirtyForms()).toBe(true);
    setFormDirty('a', true); // sem mudança → sem notificação extra
    setFormDirty('a', false);
    expect(hasDirtyForms()).toBe(false);
    expect(fn).toHaveBeenCalledTimes(2);
    off();
  });
  it('considera gravações pendentes', async () => {
    let resolve!: () => void;
    const p = trackPending(new Promise<void>((r) => (resolve = r)));
    expect(hasPendingWrites()).toBe(true);
    resolve();
    await p;
    expect(hasPendingWrites()).toBe(false);
  });
});
