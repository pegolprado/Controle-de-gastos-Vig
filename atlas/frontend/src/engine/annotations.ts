/** Anotações do analista na linha do tempo (tabela em memória; somem ao sair). */
import { exec } from './db'
import { normalizeNumber } from './normalize'
import { nextId, nowIso, setState } from './session'
import { lit } from './text'

/** `local` no formato AAAA-MM-DDTHH:MM, horário de Brasília (UTC−3). */
export async function addAnnotation(local: string, number: string | null, text: string, author: string) {
  const ms = Date.parse(`${local.length === 16 ? local + ':00' : local}-03:00`)
  if (Number.isNaN(ms)) throw new Error('Data/hora inválida.')
  if (!text.trim()) throw new Error('Escreva o texto da anotação.')
  const utc = new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
  const num = number ? normalizeNumber(number)[0] : null
  await exec(`INSERT INTO annotations VALUES (${nextId()}, TIMESTAMP ${lit(utc)}, ${lit(num)}, ${lit(text.trim().slice(0, 2000))}, ${lit(author)}, TIMESTAMP ${lit(nowIso().replace('T', ' '))})`)
  setState({}, true)
}

export async function deleteAnnotation(id: number) {
  await exec(`DELETE FROM annotations WHERE id = ${Number(id)}`)
  setState({}, true)
}
