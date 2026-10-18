// Copia para public/vendor os arquivos do OCR (tesseract.js) servidos pelo próprio site:
// nada é buscado em CDN de terceiros durante o uso.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nm = join(root, 'node_modules')
const out = join(root, 'public', 'vendor', 'tesseract')
for (const d of ['', 'core', 'lang']) mkdirSync(join(out, d), { recursive: true })
copyFileSync(join(nm, 'tesseract.js', 'dist', 'worker.min.js'), join(out, 'worker.min.js'))
for (const f of readdirSync(join(nm, 'tesseract.js-core'))) if (/lstm\.(wasm\.js|wasm|js)$/.test(f)) copyFileSync(join(nm, 'tesseract.js-core', f), join(out, 'core', f))
copyFileSync(join(nm, '@tesseract.js-data', 'por', '4.0.0_best_int', 'por.traineddata.gz'), join(out, 'lang', 'por.traineddata.gz'))
console.log('vendor OCR copiado para public/vendor/tesseract')
