// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { webcrypto } from 'node:crypto'
import { type DB, type Env, handle, type Stmt } from './app'
import { totpAt } from './crypto'

/** Adaptador mínimo do D1 sobre SQLite em memória (mesma semântica usada pelo servidor). */
function memoryD1(): DB & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:')
  const stmt = (sql: string, args: unknown[] = []): Stmt => ({
    bind: (...v: unknown[]) => stmt(sql, v),
    first: async <T,>() => (raw.prepare(sql).get(...(args as any[])) as T) ?? null,
    all: async <T,>() => ({ results: raw.prepare(sql).all(...(args as any[])) as T[] }),
    run: async () => {
      const r = raw.prepare(sql).run(...(args as any[]))
      return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
    },
  })
  return {
    raw,
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => Promise.all(stmts.map((s) => s.run())),
  }
}

async function pbkdf2(password: string, saltHex: string) {
  const k = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const salt = Uint8Array.from(saltHex.match(/../g)!.map((h) => parseInt(h, 16)))
  // poucas iterações no teste: o servidor só valida o formato da chave derivada
  const bits = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1000 }, k, 256)
  return Buffer.from(bits).toString('hex')
}

class Client {
  jar = new Map<string, string>()
  constructor(public env: Env) {}
  async req(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { 'cf-connecting-ip': '10.0.0.1', ...extra }
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ')
    if (method !== 'GET' && this.jar.get('marx_csrf') && !('x-csrf-token' in extra)) headers['x-csrf-token'] = this.jar.get('marx_csrf')!
    if (body !== undefined) headers['content-type'] = 'application/json'
    const r = await handle(new Request(`https://iamarx.com.br${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), this.env)
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(';')
      const [k, v] = kv.split('=')
      if (/Max-Age=0/.test(c)) this.jar.delete(k)
      else this.jar.set(k, v)
    }
    return { status: r.status, body: (await r.json()) as any, headers: r.headers }
  }
  async keyFor(email: string, password: string) {
    const { body } = await this.req('POST', '/api/auth/salt', { email })
    return pbkdf2(password, body.salt)
  }
  async login(email: string, password: string) {
    return this.req('POST', '/api/auth/login', { email, key: await this.keyFor(email, password) })
  }
}

const SETUP = 'codigo-de-configuracao-123'
let env: Env
let db: ReturnType<typeof memoryD1>

async function client() {
  const c = new Client(env)
  await c.req('GET', '/api/auth/csrf')
  return c
}

async function setupAdmin() {
  const c = await client()
  const r = await c.req('POST', '/api/setup', { token: SETUP, email: 'Admin@Marx.local', name: 'Admin', key: await c.keyFor('admin@marx.local', 'SenhaForte123') })
  expect(r.status).toBe(200)
  return c
}

beforeEach(() => {
  db = memoryD1()
  env = { DB: db, SECRET_KEY: 'k'.repeat(48), SETUP_TOKEN: SETUP, LOGIN_MAX_ATTEMPTS: '3' }
})

describe('servidor de login', () => {
  it('guarda somente usuários e não tem rotas de dados', async () => {
    const c = await setupAdmin()
    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r: any) => r.name)
    expect(new Set(tables)).toEqual(new Set(['users', 'reset_tokens', 'login_failures']))
    await c.login('admin@marx.local', 'SenhaForte123')
    for (const p of ['/api/cases', '/api/files', '/api/events', '/api/reports', '/api/upload']) expect((await c.req('POST', p, {})).status).toBe(404)
    expect(db.raw.prepare('SELECT pw FROM users').get()).not.toHaveProperty('pw', expect.stringMatching(/SenhaForte/))
  })

  it('primeiro acesso exige o código e só funciona uma vez', async () => {
    const c = await client()
    expect((await c.req('GET', '/api/setup')).body).toEqual({ needed: true, token_configured: true })
    const k = await c.keyFor('a@b.c', 'SenhaForte123')
    expect((await c.req('POST', '/api/setup', { token: 'errado', email: 'a@b.c', name: 'A', key: k })).status).toBe(403)
    expect((await c.req('POST', '/api/setup', { token: SETUP, email: 'a@b.c', name: 'A', key: k })).status).toBe(200)
    expect((await c.req('POST', '/api/setup', { token: SETUP, email: 'x@b.c', name: 'X', key: k })).status).toBe(409)
    expect((await c.req('GET', '/api/setup')).body.needed).toBe(false)
  })

  it('login, sessão, CSRF e logout com Clear-Site-Data', async () => {
    await setupAdmin()
    const c = await client()
    expect((await c.req('GET', '/api/auth/me')).status).toBe(401)
    expect((await c.login('admin@marx.local', 'errada000000')).status).toBe(401)
    const ok = await c.login('ADMIN@marx.local', 'SenhaForte123')
    expect(ok.status).toBe(200)
    expect(ok.headers.getSetCookie().join()).toMatch(/marx_session=.*HttpOnly.*Secure|marx_session=.*Secure.*HttpOnly/)
    const me = await c.req('GET', '/api/auth/me')
    expect(me.body).toMatchObject({ email: 'admin@marx.local', role: 'admin', idle_minutes: 30 })
    expect(me.headers.get('cache-control')).toBe('no-store')
    expect((await c.req('POST', '/api/auth/logout', {}, { 'x-csrf-token': 'falso' })).status).toBe(403)
    const out = await c.req('POST', '/api/auth/logout', {})
    expect(out.headers.get('clear-site-data')).toContain('storage')
    expect((await c.req('GET', '/api/auth/me')).status).toBe(401)
  })

  it('sal igual para e-mail existente ou não (não revela contas)', async () => {
    await setupAdmin()
    const c = await client()
    const a = (await c.req('POST', '/api/auth/salt', { email: 'admin@marx.local' })).body.salt
    const b = (await c.req('POST', '/api/auth/salt', { email: 'ninguem@marx.local' })).body.salt
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(b).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })

  it('bloqueia a conta após tentativas erradas', async () => {
    await setupAdmin()
    const c = await client()
    for (let i = 0; i < 3; i++) expect((await c.login('admin@marx.local', 'errada000000')).status).toBe(401)
    expect((await c.login('admin@marx.local', 'SenhaForte123')).status).toBe(423)
  })

  it('sessão expira por inatividade', async () => {
    await setupAdmin()
    const c = await client()
    await c.login('admin@marx.local', 'SenhaForte123')
    vi.useFakeTimers({ now: Date.now() + 31 * 60_000, toFake: ['Date'] })
    try {
      expect((await c.req('GET', '/api/auth/me')).status).toBe(401)
    } finally {
      vi.useRealTimers()
    }
  })

  it('administração de usuários, ativação por link e escalada de privilégio', async () => {
    const admin = await setupAdmin()
    await admin.login('admin@marx.local', 'SenhaForte123')
    const cr = await admin.req('POST', '/api/admin/users', { email: 'ana@marx.local', name: 'Ana', role: 'user', can_export: false })
    expect(cr.status).toBe(200)
    const token = new URL(cr.body.activation_link).searchParams.get('token')!
    const u = await client()
    expect((await u.login('ana@marx.local', 'qualquer12345')).status).toBe(401)
    const info = await u.req('POST', '/api/auth/password/reset-info', { token })
    expect(info.body.email).toBe('ana@marx.local')
    expect((await u.req('POST', '/api/auth/password/reset', { token, key: await pbkdf2('SenhaDaAna123', info.body.salt) })).status).toBe(200)
    expect((await u.req('POST', '/api/auth/password/reset', { token, key: await pbkdf2('Outra1234567', info.body.salt) })).status).toBe(400)
    expect((await u.login('ana@marx.local', 'SenhaDaAna123')).body.user).toMatchObject({ role: 'user', can_export: false })
    expect((await u.req('GET', '/api/admin/users')).status).toBe(403)
    expect((await u.req('PATCH', `/api/admin/users/${cr.body.user.id}`, { role: 'admin' })).status).toBe(403)
    // desativar encerra a sessão
    expect((await admin.req('PATCH', `/api/admin/users/${cr.body.user.id}`, { is_active: false })).status).toBe(200)
    expect((await u.req('GET', '/api/auth/me')).status).toBe(401)
    expect((await admin.req('PATCH', '/api/admin/users/1', { role: 'user' })).status).toBe(400)
    expect((await admin.req('DELETE', `/api/admin/users/${cr.body.user.id}`)).status).toBe(200)
    expect((await admin.req('GET', '/api/admin/users')).body).toHaveLength(1)
  })

  it('verificação em duas etapas', async () => {
    const c = await setupAdmin()
    await c.login('admin@marx.local', 'SenhaForte123')
    const s = await c.req('POST', '/api/auth/mfa/setup', {})
    const code = await totpAt(s.body.secret, Math.floor(Date.now() / 30000))
    expect((await c.req('POST', '/api/auth/mfa/enable', { code })).status).toBe(200)
    const d = await client()
    const r = await d.login('admin@marx.local', 'SenhaForte123')
    expect(r.body.mfa_required).toBe(true)
    expect((await d.req('GET', '/api/auth/me')).status).toBe(401)
    expect((await d.req('POST', '/api/auth/mfa', { code: '000000' })).status).toBe(401)
    expect((await d.req('POST', '/api/auth/mfa', { code: await totpAt(s.body.secret, Math.floor(Date.now() / 30000)) })).status).toBe(200)
    expect((await d.req('GET', '/api/auth/me')).status).toBe(200)
  })

  it('TOTP confere com o vetor da RFC 6238', async () => {
    // segredo ASCII "12345678901234567890" em base32; T = 59 s → contador 1
    expect(await totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1, 8)).toBe('94287082')
  })

  it('troca de senha e conferência para desbloquear a tela', async () => {
    const c = await setupAdmin()
    await c.login('admin@marx.local', 'SenhaForte123')
    const cur = await c.keyFor('admin@marx.local', 'SenhaForte123')
    expect((await c.req('POST', '/api/auth/verify', { key: cur })).status).toBe(200)
    expect((await c.req('POST', '/api/auth/password/change', { current: cur, new: await c.keyFor('admin@marx.local', 'NovaSenha98765') })).status).toBe(200)
    expect((await c.req('GET', '/api/auth/me')).status).toBe(200)
    expect((await (await client()).login('admin@marx.local', 'NovaSenha98765')).status).toBe(200)
  })

  it('rejeita corpo grande e chave fora do formato', async () => {
    await setupAdmin()
    const c = await client()
    expect((await c.req('POST', '/api/auth/login', { email: 'a@b.c', key: 'x'.repeat(20000) })).status).toBe(413)
    expect((await c.req('POST', '/api/auth/login', { email: 'admin@marx.local', key: 'SenhaForte123' })).status).toBe(422)
  })
})
