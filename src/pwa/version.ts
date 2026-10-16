/** Compara versões semânticas "1.2.3". Retorna true se `current` < `target`. */
export function isOutdated(current: string, target: string): boolean {
  const a = current.split('.').map((n) => parseInt(n, 10) || 0);
  const b = target.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) < (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) > (b[i] ?? 0)) return false;
  }
  return false;
}
