/** Base do app (\"/\" ou \"/Controle-de-gastos-Vig/\" no GitHub Pages). */
export const BASE_URL = import.meta.env.BASE_URL || '/';

/** URL absoluta de uma rota do app, respeitando o subcaminho de publicação. */
export function appUrl(path: string): string {
  return `${window.location.origin}${BASE_URL.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}
