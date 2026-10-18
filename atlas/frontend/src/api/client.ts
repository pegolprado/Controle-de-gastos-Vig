let csrf: string | null = null

export class ApiError extends Error {
  status: number
  detail: unknown
  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}

let csrfP: Promise<string> | null = null

/** Garante o token CSRF; chamadas simultâneas compartilham a mesma busca (evita tokens divergentes). */
export async function ensureCsrf(): Promise<string> {
  csrf = readCookie('marx_csrf') ?? csrf
  if (csrf) return csrf
  csrfP ??= fetch('/api/auth/csrf', { credentials: 'same-origin' })
    .then(async (r) => readCookie('marx_csrf') ?? (await r.json()).csrf)
    .finally(() => {
      csrfP = null
    })
  csrf = await csrfP
  return csrf!
}

type Listener = (status: number, path: string) => void
const listeners = new Set<Listener>()
export function onApiStatus(fn: Listener) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function messageFrom(detail: unknown, status: number): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((d: any) => `${(d.loc ?? []).slice(1).join('.')}: ${d.msg}`)
      .join('; ')
  }
  return `Erro ${status}`
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData; raw?: boolean } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET')
  const headers: Record<string, string> = {}
  if (method !== 'GET') headers['x-csrf-token'] = await ensureCsrf()
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const res = await fetch(`/api${path}`, { method, headers, body, credentials: 'same-origin' })
  if (!res.ok) {
    let detail: unknown = undefined
    try {
      detail = (await res.json()).detail
    } catch {
      /* resposta sem JSON */
    }
    if (res.status === 403 && typeof detail === 'string' && detail.includes('CSRF')) csrf = null
    listeners.forEach((fn) => fn(res.status, path))
    throw new ApiError(res.status, messageFrom(detail, res.status), detail)
  }
  if (opts.raw) return res as unknown as T
  const ct = res.headers.get('content-type') ?? ''
  return (ct.includes('application/json') ? await res.json() : await res.text()) as T
}

/** Baixa um arquivo (GET ou POST) respeitando cookies e CSRF. */
export async function download(path: string, body?: unknown, fallbackName = 'arquivo') {
  const res = await api<Response>(path, { method: body ? 'POST' : 'GET', body, raw: true })
  const blob = await res.blob()
  const cd = res.headers.get('content-disposition') ?? ''
  const m = cd.match(/filename="?([^";]+)"?/)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = m ? m[1] : fallbackName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
