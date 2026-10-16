/**
 * Registro global de formulários com alterações não salvas.
 * O fluxo de atualização do PWA consulta este registro para NUNCA recarregar
 * a página no meio de um lançamento.
 */
const dirty = new Set<string>();
const listeners = new Set<() => void>();

export function setFormDirty(id: string, isDirty: boolean) {
  const had = dirty.has(id);
  if (isDirty) dirty.add(id);
  else dirty.delete(id);
  if (had !== isDirty) listeners.forEach((l) => l());
}

export function hasDirtyForms() {
  return dirty.size > 0;
}

export function onDirtyChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let pending = 0;
/** Operações de escrita em andamento (salvando) também bloqueiam o recarregamento. */
export function trackPending<T>(p: Promise<T>): Promise<T> {
  pending++;
  listeners.forEach((l) => l());
  return p.finally(() => {
    pending--;
    listeners.forEach((l) => l());
  });
}
export function hasPendingWrites() {
  return pending > 0;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (dirty.size > 0 || pending > 0) {
      e.preventDefault();
    }
  });
}
