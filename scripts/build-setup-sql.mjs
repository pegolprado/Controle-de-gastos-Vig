#!/usr/bin/env node
/** Junta todas as migrações em supabase/setup.sql (para colar no SQL Editor do Supabase de uma vez). */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(import.meta.dirname, '..', 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const header = `-- FINANCE OS — instalação completa do banco (gerado por scripts/build-setup-sql.mjs)
-- Cole TUDO no Supabase → SQL Editor → New query → Run. Execute uma única vez num projeto novo.
-- Equivale a aplicar ${files.length} migrações de supabase/migrations em ordem.
`;
const body = files.map((f) => `\n-- >>>>>>>>>> ${f}\n${readFileSync(join(dir, f), 'utf8')}`).join('\n');
writeFileSync(resolve(dir, '..', 'setup.sql'), header + body);
console.log(`supabase/setup.sql gerado com ${files.length} migrações.`);
