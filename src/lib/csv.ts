/** Gera CSV compatível com Excel em português (separador ; e BOM UTF-8). */
export function toCSV(rows: Array<Record<string, string | number | null | undefined>>, columns: Array<{ key: string; label: string }>): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    // neutraliza injeção de fórmulas em planilhas
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = columns.map((c) => esc(c.label)).join(';');
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(';')).join('\r\n');
  return '﻿' + head + '\r\n' + body;
}

export function centsToCSV(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

export function downloadFile(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
