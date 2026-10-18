/**
 * A senha nunca sai do navegador: é transformada aqui em uma chave (PBKDF2-SHA256, 600 mil
 * iterações, com sal fornecido pelo servidor para aquele e-mail) e só a chave é enviada.
 */
import { api } from '../api/client'

export const PBKDF2_ITERATIONS = 600_000

export function passwordProblems(p: string): string[] {
  const out: string[] = []
  if (p.length < 12) out.push('mínimo de 12 caracteres')
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) out.push('use letras e números')
  if (['senha123456789', 'password12345', '123456789abc'].includes(p.toLowerCase())) out.push('senha muito comum')
  return out
}

export function assertStrong(p: string) {
  const probs = passwordProblems(p)
  if (probs.length) throw new Error(`Senha fraca: ${probs.join(', ')}`)
}

export async function deriveWithSalt(password: string, saltHex: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits'])
  const salt = Uint8Array.from(saltHex.match(/../g)!.map((h) => parseInt(h, 16)))
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256)
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function deriveKey(email: string, password: string): Promise<string> {
  const { salt, iterations } = await api<{ salt: string; iterations: number }>('/auth/salt', { body: { email: email.trim().toLowerCase() } })
  return deriveWithSalt(password, salt, iterations)
}
