/**
 * Servidor de login do MARX (Cloudflare Pages Functions + D1, plano gratuito).
 *
 * Guarda SOMENTE a lista de usuários e links de definição de senha. Não existe rota que receba
 * arquivos, consultas ou resultados: tudo isso é processado no navegador de cada usuário.
 */
import {
  KEY_RE, newTotpSecret, passwordHash, randomToken, safeEqual, saltFor, type SessionPayload, signSession, totpVerify, verifySession, hmacHex,
} from './crypto'

export const APP_VERSION = '2.1.0'

// ---------------------------------------------------------------- tipos mínimos do D1

export interface Stmt {
  bind(...values: unknown[]): Stmt
  first<T = Record<string, any>>(): Promise<T | null>
  all<T = Record<string, any>>(): Promise<{ results: T[] }>
  run(): Promise<{ meta: { changes?: number; last_row_id?: number } }>
}
export interface DB {
  prepare(sql: string): Stmt
  batch(stmts: Stmt[]): Promise<unknown[]>
}

export type Env = {
  DB: DB
  SECRET_KEY: string
  SETUP_TOKEN?: string
  IDLE_MINUTES?: string
  SESSION_MINUTES?: string
  LOGIN_MAX_ATTEMPTS?: string
  LOGIN_LOCK_MINUTES?: string
  MAP_TILE_URL?: string
  MAP_ATTRIBUTION?: string
  PUBLIC_URL?: string
  COOKIE_INSECURE?: string
}

type User = {
  id: number; email: string; name: string; pw: string; role: 'admin' | 'user'; is_active: number; can_export: number
  mfa_secret: string | null; mfa_enabled: number; failed_logins: number; locked_until: number | null
  must_change_password: number; session_version: number; created_at: number
}

const SESSION_COOKIE = 'marx_session'
const CSRF_COOKIE = 'marx_csrf'
const MAX_BODY = 16 * 1024
const IP_WINDOW_S = 15 * 60
const IP_MAX_FAILS = 30

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, pw TEXT NOT NULL,
     role TEXT NOT NULL DEFAULT 'user', is_active INTEGER NOT NULL DEFAULT 1, can_export INTEGER NOT NULL DEFAULT 1,
     mfa_secret TEXT, mfa_enabled INTEGER NOT NULL DEFAULT 0, failed_logins INTEGER NOT NULL DEFAULT 0, locked_until INTEGER,
     must_change_password INTEGER NOT NULL DEFAULT 0, session_version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS reset_tokens (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  // Falhas de login por IP (IP guardado só como HMAC, apagado após 15 minutos) — proteção contra força bruta.
  `CREATE TABLE IF NOT EXISTS login_failures (ip_hash TEXT NOT NULL, ts INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS login_failures_ip ON login_failures (ip_hash, ts)`,
]

const schemaReady = new WeakMap<DB, Promise<void>>()
function ensureSchema(db: DB) {
  let p = schemaReady.get(db)
  if (!p) {
    p = db.batch(SCHEMA.map((s) => db.prepare(s))).then(() => undefined)
    p.catch(() => schemaReady.delete(db))
    schemaReady.set(db, p)
  }
  return p
}

// ---------------------------------------------------------------- utilidades HTTP

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const now = () => Math.floor(Date.now() / 1000)
const num = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d)

function cfg(env: Env) {
  if (!env.SECRET_KEY || env.SECRET_KEY.length < 32) throw new HttpError(500, 'Servidor sem SECRET_KEY configurada (mínimo de 32 caracteres).')
  return {
    secret: env.SECRET_KEY,
    idle: num(env.IDLE_MINUTES, 30),
    session: num(env.SESSION_MINUTES, 480),
    maxAttempts: num(env.LOGIN_MAX_ATTEMPTS, 5),
    lockMinutes: num(env.LOGIN_LOCK_MINUTES, 15),
    secure: env.COOKIE_INSECURE !== '1',
  }
}

function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

function cookie(name: string, value: string, opts: { maxAge?: number; httpOnly?: boolean; secure: boolean }) {
  return [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Strict', opts.httpOnly ? 'HttpOnly' : '', opts.secure ? 'Secure' : '', opts.maxAge !== undefined ? `Max-Age=${opts.maxAge}` : '']
    .filter(Boolean)
    .join('; ')
}

class Res {
  headers = new Headers({ 'content-type': 'application/json; charset=utf-8' })
  status = 200
  setCookie(c: string) {
    this.headers.append('set-cookie', c)
  }
  json(body: unknown) {
    const h = this.headers
    h.set('cache-control', 'no-store')
    h.set('x-content-type-options', 'nosniff')
    h.set('x-frame-options', 'DENY')
    h.set('referrer-policy', 'no-referrer')
    h.set('cross-origin-opener-policy', 'same-origin')
    h.set('x-robots-tag', 'noindex, nofollow')
    return new Response(JSON.stringify(body), { status: this.status, headers: h })
  }
}

async function readJson(req: Request): Promise<Record<string, any>> {
  const len = Number(req.headers.get('content-length') ?? 0)
  if (len > MAX_BODY) throw new HttpError(413, 'Requisição grande demais')
  const text = await req.text()
  if (text.length > MAX_BODY) throw new HttpError(413, 'Requisição grande demais')
  if (!text) return {}
  try {
    const v = JSON.parse(text)
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error()
    return v
  } catch {
    throw new HttpError(400, 'JSON inválido')
  }
}

const str = (v: unknown, max: number, field: string) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new HttpError(422, `${field}: valor inválido`)
  return v.trim()
}
const email = (v: unknown) => {
  const e = str(v, 254, 'email').toLowerCase()
  if (!/^[^\s@]+@[^\s@]+$/.test(e)) throw new HttpError(422, 'email: endereço inválido')
  return e
}
const key = (v: unknown) => {
  if (typeof v !== 'string' || !KEY_RE.test(v)) throw new HttpError(422, 'Senha em formato inválido. Recarregue a página.')
  return v
}

function userOut(u: User) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, mfa_enabled: !!u.mfa_enabled, must_change_password: !!u.must_change_password, can_export: !!u.can_export }
}

// ---------------------------------------------------------------- contexto da requisição

type Ctx = { req: Request; env: Env; c: ReturnType<typeof cfg>; res: Res; path: string; method: string; ip: string }

async function setSession(ctx: Ctx, u: User, mfaOk: boolean) {
  const t = now()
  const p: SessionPayload = { sub: u.id, sv: u.session_version, mfa: mfaOk, iat: t, lat: t, exp: t + ctx.c.session * 60, jti: randomToken(8) }
  ctx.res.setCookie(cookie(SESSION_COOKIE, await signSession(ctx.c.secret, p), { httpOnly: true, secure: ctx.c.secure, maxAge: ctx.c.session * 60 }))
}

async function sessionPayload(ctx: Ctx): Promise<SessionPayload | null> {
  const p = await verifySession(ctx.c.secret, cookies(ctx.req)[SESSION_COOKIE])
  if (!p) return null
  const t = now()
  if (p.exp < t || t - p.lat > ctx.c.idle * 60) return null
  return p
}

async function currentUser(ctx: Ctx): Promise<User> {
  const p = await sessionPayload(ctx)
  if (!p) throw new HttpError(401, 'Sessão expirada ou inexistente')
  const u = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(p.sub).first<User>()
  if (!u || !u.is_active || u.session_version !== p.sv) throw new HttpError(401, 'Sessão inválida')
  if (u.mfa_enabled && !p.mfa) throw new HttpError(401, 'Verificação em duas etapas pendente')
  if (now() - p.lat > 60) {
    const q = { ...p, lat: now() }
    ctx.res.setCookie(cookie(SESSION_COOKIE, await signSession(ctx.c.secret, q), { httpOnly: true, secure: ctx.c.secure, maxAge: Math.max(0, q.exp - now()) }))
  }
  return u
}

async function requireAdmin(ctx: Ctx) {
  const u = await currentUser(ctx)
  if (u.role !== 'admin') throw new HttpError(403, 'Permissão insuficiente')
  return u
}

async function ipHash(ctx: Ctx) {
  return hmacHex(ctx.c.secret, `ip:${ctx.ip}`)
}

async function ipBlocked(ctx: Ctx) {
  const h = await ipHash(ctx)
  const r = await ctx.env.DB.prepare('SELECT count(*) AS n FROM login_failures WHERE ip_hash = ? AND ts > ?').bind(h, now() - IP_WINDOW_S).first<{ n: number }>()
  return (r?.n ?? 0) >= IP_MAX_FAILS
}

async function ipFail(ctx: Ctx) {
  const h = await ipHash(ctx)
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('INSERT INTO login_failures (ip_hash, ts) VALUES (?, ?)').bind(h, now()),
    ctx.env.DB.prepare('DELETE FROM login_failures WHERE ts < ?').bind(now() - IP_WINDOW_S),
  ])
}

async function registerFailure(ctx: Ctx, u: User | null, bumpSessions = false) {
  await ipFail(ctx)
  if (!u) return
  const fails = u.failed_logins + 1
  if (fails >= ctx.c.maxAttempts)
    await ctx.env.DB.prepare(`UPDATE users SET failed_logins = 0, locked_until = ?${bumpSessions ? ', session_version = session_version + 1' : ''} WHERE id = ?`).bind(now() + ctx.c.lockMinutes * 60, u.id).run()
  else await ctx.env.DB.prepare('UPDATE users SET failed_logins = ? WHERE id = ?').bind(fails, u.id).run()
}

async function createResetLink(ctx: Ctx, userId: number, hours: number) {
  const raw = randomToken(32)
  await ctx.env.DB.prepare('INSERT INTO reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await hmacHex(ctx.c.secret, `reset:${raw}`), userId, now() + hours * 3600).run()
  const base = (ctx.env.PUBLIC_URL || new URL(ctx.req.url).origin).replace(/\/$/, '')
  return `${base}/redefinir-senha?token=${raw}`
}

async function tokenUser(ctx: Ctx, token: unknown) {
  if (typeof token !== 'string' || token.length > 200) throw new HttpError(400, 'Link inválido ou expirado')
  const th = await hmacHex(ctx.c.secret, `reset:${token}`)
  const t = await ctx.env.DB.prepare('SELECT * FROM reset_tokens WHERE token_hash = ?').bind(th).first<{ token_hash: string; user_id: number; expires_at: number }>()
  if (!t || t.expires_at < now()) throw new HttpError(400, 'Link inválido ou expirado')
  const u = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(t.user_id).first<User>()
  if (!u) throw new HttpError(400, 'Link inválido ou expirado')
  return { u, th }
}

// ---------------------------------------------------------------- rotas

type Handler = (ctx: Ctx, params: string[]) => Promise<unknown>
const routes: [string, RegExp, Handler][] = []
const route = (method: string, pattern: string, h: Handler) => routes.push([method, new RegExp(`^${pattern}$`), h])

route('GET', '/api/health', async () => ({ ok: true, version: APP_VERSION }))

route('GET', '/api/auth/csrf', async (ctx) => {
  const t = cookies(ctx.req)[CSRF_COOKIE] || randomToken(32)
  ctx.res.setCookie(cookie(CSRF_COOKIE, t, { secure: ctx.c.secure }))
  return { csrf: t }
})

route('POST', '/api/auth/salt', async (ctx) => {
  const b = await readJson(ctx.req)
  return { salt: await saltFor(ctx.c.secret, email(b.email)), iterations: 600000 }
})

route('POST', '/api/auth/login', async (ctx) => {
  if (await ipBlocked(ctx)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.')
  const b = await readJson(ctx.req)
  const e = email(b.email)
  const k = key(b.key)
  const u = await ctx.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(e).first<User>()
  if (u?.locked_until && u.locked_until > now()) throw new HttpError(423, 'Conta bloqueada temporariamente por tentativas inválidas')
  const h = await passwordHash(ctx.c.secret, k)
  if (!u || !u.is_active || !safeEqual(h, u.pw)) {
    await registerFailure(ctx, u)
    throw new HttpError(401, 'E-mail ou senha inválidos')
  }
  await ctx.env.DB.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').bind(u.id).run()
  await setSession(ctx, u, !u.mfa_enabled)
  return { user: userOut(u), mfa_required: !!u.mfa_enabled }
})

route('POST', '/api/auth/mfa', async (ctx) => {
  const p = await sessionPayload(ctx)
  if (!p) throw new HttpError(401, 'Sessão expirada')
  const b = await readJson(ctx.req)
  const u = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(p.sub).first<User>()
  if (!u || !u.is_active || u.session_version !== p.sv) throw new HttpError(401, 'Sessão inválida')
  if (!u.mfa_enabled || !u.mfa_secret) throw new HttpError(400, 'Verificação em duas etapas não está ativa')
  if (!(await totpVerify(u.mfa_secret, String(b.code ?? '')))) {
    await registerFailure(ctx, u, true)
    throw new HttpError(401, 'Código inválido')
  }
  await ctx.env.DB.prepare('UPDATE users SET failed_logins = 0 WHERE id = ?').bind(u.id).run()
  await setSession(ctx, u, true)
  return { user: userOut(u) }
})

route('POST', '/api/auth/logout', async (ctx) => {
  ctx.res.setCookie(cookie(SESSION_COOKIE, '', { httpOnly: true, secure: ctx.c.secure, maxAge: 0 }))
  // apaga cookies e armazenamento do site no navegador (o cache só tem o código do site, nunca dados)
  ctx.res.headers.set('clear-site-data', '"cookies", "storage"')
  return { ok: true }
})

route('GET', '/api/auth/me', async (ctx) => ({ ...userOut(await currentUser(ctx)), idle_minutes: ctx.c.idle }))

/** Confere a senha sem alterar a sessão (desbloqueio de tela). */
route('POST', '/api/auth/verify', async (ctx) => {
  const u = await currentUser(ctx)
  const b = await readJson(ctx.req)
  if (!safeEqual(await passwordHash(ctx.c.secret, key(b.key)), u.pw)) {
    await registerFailure(ctx, u, true)
    // 400 (e não 401): senha errada no desbloqueio não deve encerrar a sessão de imediato;
    // ao atingir o limite de tentativas, a sessão é invalidada e a análise é apagada.
    throw new HttpError(400, 'Senha incorreta')
  }
  await ctx.env.DB.prepare('UPDATE users SET failed_logins = 0 WHERE id = ?').bind(u.id).run()
  return { ok: true }
})

route('POST', '/api/auth/password/forgot', async () => ({ ok: true, message: 'Peça ao administrador um link de redefinição de senha.' }))

route('POST', '/api/auth/password/reset-info', async (ctx) => {
  const { u } = await tokenUser(ctx, (await readJson(ctx.req)).token)
  return { email: u.email, name: u.name, salt: await saltFor(ctx.c.secret, u.email), iterations: 600000 }
})

route('POST', '/api/auth/password/reset', async (ctx) => {
  const b = await readJson(ctx.req)
  const { u, th } = await tokenUser(ctx, b.token)
  const h = await passwordHash(ctx.c.secret, key(b.key))
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('UPDATE users SET pw = ?, must_change_password = 0, session_version = session_version + 1, failed_logins = 0, locked_until = NULL WHERE id = ?').bind(h, u.id),
    ctx.env.DB.prepare('DELETE FROM reset_tokens WHERE token_hash = ? OR expires_at < ?').bind(th, now()),
  ])
  return { ok: true }
})

route('POST', '/api/auth/password/change', async (ctx) => {
  const u = await currentUser(ctx)
  const b = await readJson(ctx.req)
  if (!safeEqual(await passwordHash(ctx.c.secret, key(b.current)), u.pw)) throw new HttpError(400, 'Senha atual incorreta')
  const nk = key(b.new)
  if (nk === b.current) throw new HttpError(422, 'A nova senha deve ser diferente da atual')
  await ctx.env.DB.prepare('UPDATE users SET pw = ?, must_change_password = 0, session_version = session_version + 1 WHERE id = ?').bind(await passwordHash(ctx.c.secret, nk), u.id).run()
  await setSession(ctx, { ...u, session_version: u.session_version + 1 }, true)
  return { ok: true }
})

route('POST', '/api/auth/mfa/setup', async (ctx) => {
  const u = await currentUser(ctx)
  if (u.mfa_enabled) throw new HttpError(400, 'Já ativa')
  const secret = newTotpSecret()
  await ctx.env.DB.prepare('UPDATE users SET mfa_secret = ? WHERE id = ?').bind(secret, u.id).run()
  return { secret, otpauth: `otpauth://totp/MARX:${encodeURIComponent(u.email)}?secret=${secret}&issuer=MARX` }
})

route('POST', '/api/auth/mfa/enable', async (ctx) => {
  const u = await currentUser(ctx)
  const b = await readJson(ctx.req)
  if (!u.mfa_secret || !(await totpVerify(u.mfa_secret, String(b.code ?? '')))) throw new HttpError(400, 'Código inválido')
  await ctx.env.DB.prepare('UPDATE users SET mfa_enabled = 1 WHERE id = ?').bind(u.id).run()
  await setSession(ctx, u, true)
  return { ok: true }
})

route('POST', '/api/auth/mfa/disable', async (ctx) => {
  const u = await currentUser(ctx)
  const b = await readJson(ctx.req)
  const okPw = typeof b.key === 'string' && KEY_RE.test(b.key) && safeEqual(await passwordHash(ctx.c.secret, b.key), u.pw)
  if (!okPw || !u.mfa_secret || !(await totpVerify(u.mfa_secret, String(b.code ?? '')))) throw new HttpError(400, 'Senha ou código inválido')
  await ctx.env.DB.prepare('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?').bind(u.id).run()
  return { ok: true }
})

// ---------- primeiro acesso: cria o primeiro administrador (exige SETUP_TOKEN)

async function userCount(ctx: Ctx) {
  return (await ctx.env.DB.prepare('SELECT count(*) AS n FROM users').first<{ n: number }>())?.n ?? 0
}

route('GET', '/api/setup', async (ctx) => ({ needed: (await userCount(ctx)) === 0, token_configured: !!ctx.env.SETUP_TOKEN }))

route('POST', '/api/setup', async (ctx) => {
  if (await ipBlocked(ctx)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.')
  if ((await userCount(ctx)) > 0) throw new HttpError(409, 'O sistema já foi configurado.')
  if (!ctx.env.SETUP_TOKEN || ctx.env.SETUP_TOKEN.length < 12) throw new HttpError(503, 'Defina a variável SETUP_TOKEN (mínimo de 12 caracteres) no painel da Cloudflare.')
  const b = await readJson(ctx.req)
  if (typeof b.token !== 'string' || !safeEqual(b.token, ctx.env.SETUP_TOKEN)) {
    await ipFail(ctx)
    throw new HttpError(403, 'Código de configuração incorreto')
  }
  const e = email(b.email)
  await ctx.env.DB.prepare('INSERT INTO users (email, name, pw, role, created_at) VALUES (?, ?, ?, ?, ?)').bind(e, str(b.name, 200, 'nome'), await passwordHash(ctx.c.secret, key(b.key)), 'admin', now()).run()
  return { ok: true }
})

// ---------- administração de usuários

route('GET', '/api/admin/users', async (ctx) => {
  await requireAdmin(ctx)
  const { results } = await ctx.env.DB.prepare('SELECT * FROM users ORDER BY name COLLATE NOCASE').all<User>()
  return results.map((u) => ({ ...userOut(u), is_active: !!u.is_active, locked: !!(u.locked_until && u.locked_until > now()) }))
})

route('POST', '/api/admin/users', async (ctx) => {
  await requireAdmin(ctx)
  const b = await readJson(ctx.req)
  const e = email(b.email)
  const role = b.role === 'admin' ? 'admin' : b.role === 'user' || b.role === undefined ? 'user' : null
  if (!role) throw new HttpError(422, 'Perfil inválido')
  if (await ctx.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(e).first()) throw new HttpError(409, 'E-mail já cadastrado')
  // senha inutilizável até o usuário definir a dele pelo link de ativação
  const r = await ctx.env.DB.prepare('INSERT INTO users (email, name, pw, role, can_export, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
    .bind(e, str(b.name, 200, 'nome'), `!${randomToken(24)}`, role, b.can_export === false ? 0 : 1, now())
    .run()
  const id = Number(r.meta.last_row_id)
  const u = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>()
  return { user: userOut(u!), activation_link: await createResetLink(ctx, id, 72) }
})

async function target(ctx: Ctx, id: string) {
  const u = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(Number(id)).first<User>()
  if (!u) throw new HttpError(404, 'Usuário não encontrado')
  return u
}

route('PATCH', '/api/admin/users/(\\d+)', async (ctx, [id]) => {
  const admin = await requireAdmin(ctx)
  const u = await target(ctx, id)
  const b = await readJson(ctx.req)
  const sets: string[] = []
  const vals: unknown[] = []
  if (b.name !== undefined) {
    sets.push('name = ?')
    vals.push(str(b.name, 200, 'nome'))
  }
  if (b.role !== undefined) {
    if (b.role !== 'admin' && b.role !== 'user') throw new HttpError(422, 'Perfil inválido')
    if (u.id === admin.id && b.role !== 'admin') throw new HttpError(400, 'Você não pode remover seu próprio acesso administrativo')
    sets.push('role = ?')
    vals.push(b.role)
  }
  if (b.is_active !== undefined) {
    if (u.id === admin.id && !b.is_active) throw new HttpError(400, 'Você não pode desativar a si mesmo')
    sets.push('is_active = ?')
    vals.push(b.is_active ? 1 : 0)
  }
  if (b.can_export !== undefined) {
    sets.push('can_export = ?')
    vals.push(b.can_export ? 1 : 0)
  }
  if (!sets.length) return userOut(u)
  if (b.role !== undefined || b.is_active !== undefined || b.can_export !== undefined) sets.push('session_version = session_version + 1')
  await ctx.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, u.id).run()
  return userOut((await target(ctx, id))!)
})

route('DELETE', '/api/admin/users/(\\d+)', async (ctx, [id]) => {
  const admin = await requireAdmin(ctx)
  const u = await target(ctx, id)
  if (u.id === admin.id) throw new HttpError(400, 'Você não pode excluir a si mesmo')
  await ctx.env.DB.batch([ctx.env.DB.prepare('DELETE FROM reset_tokens WHERE user_id = ?').bind(u.id), ctx.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(u.id)])
  return { ok: true }
})

route('POST', '/api/admin/users/(\\d+)/reset-link', async (ctx, [id]) => {
  await requireAdmin(ctx)
  const u = await target(ctx, id)
  return { link: await createResetLink(ctx, u.id, 24), expires_hours: 24 }
})

route('POST', '/api/admin/users/(\\d+)/unlock', async (ctx, [id]) => {
  await requireAdmin(ctx)
  await ctx.env.DB.prepare('UPDATE users SET locked_until = NULL, failed_logins = 0 WHERE id = ?').bind((await target(ctx, id)).id).run()
  return { ok: true }
})

route('POST', '/api/admin/users/(\\d+)/revoke-sessions', async (ctx, [id]) => {
  await requireAdmin(ctx)
  await ctx.env.DB.prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?').bind((await target(ctx, id)).id).run()
  return { ok: true }
})

route('GET', '/api/settings', async (ctx) => {
  await currentUser(ctx)
  return {
    map_tile_url: ctx.env.MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    map_attribution: ctx.env.MAP_ATTRIBUTION ?? '&copy; colaboradores do OpenStreetMap',
    app_version: APP_VERSION,
    smtp_configured: false,
    idle_minutes: ctx.c.idle,
  }
})

// ---------------------------------------------------------------- entrada

export async function handle(req: Request, env: Env): Promise<Response> {
  const res = new Res()
  const url = new URL(req.url)
  try {
    const c = cfg(env)
    const ctx: Ctx = { req, env, c, res, path: url.pathname.replace(/\/+$/, '') || '/', method: req.method.toUpperCase(), ip: req.headers.get('cf-connecting-ip') ?? '0.0.0.0' }
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD' && ctx.path !== '/api/health') {
      const ck = cookies(req)[CSRF_COOKIE]
      const hd = req.headers.get('x-csrf-token')
      if (!ck || !hd || !safeEqual(ck, hd)) throw new HttpError(403, 'Token CSRF ausente ou inválido. Recarregue a página.')
    }
    await ensureSchema(env.DB)
    const allowed: string[] = []
    for (const [m, re, h] of routes) {
      const match = re.exec(ctx.path)
      if (!match) continue
      allowed.push(m)
      if (m === ctx.method || (m === 'GET' && ctx.method === 'HEAD')) return res.json(await h(ctx, match.slice(1)))
    }
    throw allowed.length ? new HttpError(405, 'Método não permitido') : new HttpError(404, 'Não encontrado')
  } catch (e) {
    if (e instanceof HttpError) {
      res.status = e.status
      return res.json({ detail: e.message })
    }
    console.error('erro interno', e instanceof Error ? e.message : e)
    res.status = 500
    return res.json({ detail: 'Erro interno.' })
  }
}
