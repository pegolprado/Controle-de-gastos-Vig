/**
 * Criptografia do servidor de login (Web Crypto, disponível no Cloudflare Workers e no Node 22).
 *
 * Senhas: o navegador deriva a chave com PBKDF2-SHA256 (600 mil iterações) e envia só a chave
 * derivada; o servidor guarda HMAC-SHA256(SECRET_KEY, chave). Mesmo com o banco vazado, cada
 * tentativa de adivinhar uma senha custa as 600 mil iterações — e sem a SECRET_KEY nem isso é possível.
 */
const enc = new TextEncoder()

export function hex(buf: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function b64url(buf: ArrayBuffer | Uint8Array): string {
  let s = ''
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

async function hmacKey(secret: string | Uint8Array, hash: 'SHA-256' | 'SHA-1' = 'SHA-256') {
  const raw = typeof secret === 'string' ? enc.encode(secret) : secret
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'HMAC', hash }, false, ['sign'])
}

export async function hmac(secret: string, msg: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(msg)))
}

export async function hmacHex(secret: string, msg: string): Promise<string> {
  return hex(await hmac(secret, msg))
}

/** Comparação em tempo constante. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

/** Sal da derivação no navegador: determinístico por e-mail, igual para e-mails existentes ou não. */
export function saltFor(secret: string, email: string) {
  return hmacHex(secret, `salt:${email.trim().toLowerCase()}`)
}

export function passwordHash(secret: string, key: string) {
  return hmacHex(secret, `pw:${key}`)
}

export const KEY_RE = /^[0-9a-f]{64}$/

// ---------------------------------------------------------------- sessão (token assinado)

export type SessionPayload = { sub: number; sv: number; mfa: boolean; iat: number; lat: number; exp: number; jti: string }

export async function signSession(secret: string, p: SessionPayload): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(p)))
  return `${body}.${b64url(await hmac(secret, `session:${body}`))}`
}

export async function verifySession(secret: string, token: string | null | undefined): Promise<SessionPayload | null> {
  if (!token || token.length > 2000) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = b64url(await hmac(secret, `session:${body}`))
  if (!safeEqual(sig, expected)) return null
  try {
    return JSON.parse(new TextDecoder().decode(fromB64url(body))) as SessionPayload
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- TOTP (RFC 6238)

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Uint8Array.from(out)
}

export async function totpAt(secretB32: string, counter: number, digits = 6): Promise<string> {
  const msg = new Uint8Array(8)
  let c = counter
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 255
    c = Math.floor(c / 256)
  }
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(base32Decode(secretB32), 'SHA-1'), msg))
  const off = sig[sig.length - 1] & 15
  const bin = ((sig[off] & 127) << 24) | (sig[off + 1] << 16) | (sig[off + 2] << 8) | sig[off + 3]
  return String(bin % 10 ** digits).padStart(digits, '0')
}

/** Aceita o código do intervalo atual e de um intervalo antes/depois (relógio do celular). */
export async function totpVerify(secretB32: string, code: string, nowMs = Date.now()): Promise<boolean> {
  const c = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(c)) return false
  const step = Math.floor(nowMs / 30000)
  for (const d of [-1, 0, 1]) if (safeEqual(await totpAt(secretB32, step + d), c)) return true
  return false
}

export function newTotpSecret() {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)))
}
