// Copia para public/vendor os arquivos pesados servidos pelo próprio site (nada vem de CDN de terceiros):
//  - OCR (tesseract.js) e
//  - motor analítico DuckDB-WASM, dividido em partes de até 20 MB (limite de 25 MB por arquivo
//    do Cloudflare Pages gratuito). O navegador junta as partes e confere o SHA-256 antes de usar.
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nm = join(root, 'node_modules')
const out = join(root, 'public', 'vendor', 'tesseract')
for (const d of ['', 'core', 'lang']) mkdirSync(join(out, d), { recursive: true })
copyFileSync(join(nm, 'tesseract.js', 'dist', 'worker.min.js'), join(out, 'worker.min.js'))
for (const f of readdirSync(join(nm, 'tesseract.js-core'))) if (/lstm\.(wasm\.js|wasm|js)$/.test(f)) copyFileSync(join(nm, 'tesseract.js-core', f), join(out, 'core', f))
copyFileSync(join(nm, '@tesseract.js-data', 'por', '4.0.0_best_int', 'por.traineddata.gz'), join(out, 'lang', 'por.traineddata.gz'))

const wasm = readFileSync(join(nm, '@duckdb', 'duckdb-wasm', 'dist', 'duckdb-eh.wasm'))
const sha = createHash('sha256').update(wasm).digest('hex')
const dd = join(root, 'public', 'vendor', 'duckdb')
rmSync(dd, { recursive: true, force: true })
const dir = join(dd, sha.slice(0, 16))
mkdirSync(dir, { recursive: true })
const PART = 20 * 1024 * 1024
const parts = []
for (let i = 0, off = 0; off < wasm.length; i++, off += PART) {
  const name = `eh.${i}.wasm`
  writeFileSync(join(dir, name), wasm.subarray(off, off + PART))
  parts.push(`/vendor/duckdb/${sha.slice(0, 16)}/${name}`)
}
writeFileSync(join(dd, 'manifest.json'), JSON.stringify({ sha256: sha, size: wasm.length, parts }))
console.log('vendor copiado: OCR em public/vendor/tesseract; DuckDB em', parts.length, 'partes')
