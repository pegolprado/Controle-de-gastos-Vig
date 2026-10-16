#!/usr/bin/env node
/**
 * Testes do banco de dados (migrações + RLS + regras financeiras).
 *
 * - Se DATABASE_URL estiver definido (CI), usa esse servidor.
 * - Caso contrário, cria um cluster PostgreSQL temporário com initdb/pg_ctl.
 *
 * Fluxo: cria um banco limpo → aplica o stub do Supabase → aplica TODAS as
 * migrações em ordem (testa as migrações) → executa supabase/tests/*.test.sql.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const migrationsDir = join(root, 'supabase', 'migrations');
const testsDir = join(root, 'supabase', 'tests');

function findPgBin() {
  const candidates = ['/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin'];
  return candidates.find((c) => existsSync(join(c, 'initdb')));
}

let cleanup = () => {};
let baseUrl = process.env.DATABASE_URL;

if (!baseUrl) {
  const bin = findPgBin();
  if (!bin) {
    console.error('PostgreSQL não encontrado. Defina DATABASE_URL ou instale o PostgreSQL 15+.');
    process.exit(1);
  }
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'financeos-pg-'));
  const port = String(54000 + Math.floor(Math.random() * 900));
  const asPg = process.getuid?.() === 0 ? ['-u', 'postgres'] : null;
  const run = (cmd, args) => {
    if (asPg) {
      execFileSync('chown', ['-R', 'postgres', dir]);
      return execFileSync('runuser', [...asPg, '--', join(bin, cmd), ...args], { stdio: 'pipe' });
    }
    return execFileSync(join(bin, cmd), args, { stdio: 'pipe' });
  };
  run('initdb', ['-D', join(dir, 'data'), '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C.UTF-8']);
  run('pg_ctl', ['-D', join(dir, 'data'), '-o', `-p ${port} -k ${dir} -c listen_addresses=''`, '-w', '-l', join(dir, 'log'), 'start']);
  baseUrl = `postgresql://postgres@/postgres?host=${dir}&port=${port}`;
  cleanup = () => {
    try { run('pg_ctl', ['-D', join(dir, 'data'), '-m', 'immediate', 'stop']); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  };
}

function psql(url, args, input) {
  return spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args], { encoding: 'utf8', input });
}

const dbName = `financeos_test_${Date.now()}`;
let failed = 0;
try {
  let r = psql(baseUrl, ['-c', `create database ${dbName}`]);
  if (r.status !== 0) throw new Error(r.stderr);
  const url = baseUrl.includes('/postgres?')
    ? baseUrl.replace('/postgres?', `/${dbName}?`)
    : baseUrl.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);

  const step = (label, file) => {
    const res = psql(url, ['-f', file]);
    if (res.status !== 0) {
      console.error(`✗ ${label}\n${res.stderr}`);
      return false;
    }
    console.log(`✓ ${label}`);
    return true;
  };

  if (!step('stub do Supabase', join(testsDir, '00_supabase_stub.sql'))) throw new Error('stub');
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    if (!step(`migração ${f}`, join(migrationsDir, f))) throw new Error(`migração ${f}`);
  }
  if (!step('helpers de teste', join(testsDir, '01_helpers.sql'))) throw new Error('helpers');

  const tests = readdirSync(testsDir).filter((f) => f.endsWith('.test.sql')).sort();
  for (const t of tests) {
    // cada arquivo abre e reverte a própria transação (begin … rollback) → isolamento entre testes
    const res = psql(url, ['-f', join(testsDir, t)]);
    if (res.status !== 0) {
      failed++;
      console.error(`✗ ${t}\n${res.stderr.split('\n').filter(Boolean).slice(0, 8).join('\n')}`);
    } else {
      const notes = (res.stderr.match(/NOTICE:\s+(.*)/g) || []).length;
      console.log(`✓ ${t}${notes ? ` (${notes} verificações)` : ''}`);
    }
  }
  // ---- setup.sql (instalação em um passo) deve gerar exatamente o mesmo schema
  const setupDb = `${dbName}_setup`;
  const setupUrl = url.replace(dbName, setupDb);
  psql(baseUrl, ['-c', `create database ${setupDb}`]);
  psql(setupUrl, ['-f', join(testsDir, '00_supabase_stub.sql')]);
  const setupRes = psql(setupUrl, ['-f', join(root, 'supabase', 'setup.sql')]);
  const shape = (u) => psql(u, ['-At', '-c', "select (select count(*) from pg_tables where schemaname='public')||'/'||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')||'/'||(select count(*) from pg_policies)"]).stdout.trim();
  if (setupRes.status !== 0 || shape(setupUrl) !== shape(url)) {
    failed++;
    console.error(`✗ supabase/setup.sql difere das migrações (rode node scripts/build-setup-sql.mjs)\n${setupRes.stderr}`);
  } else {
    console.log(`✓ supabase/setup.sql equivale às migrações (tabelas/funções/policies: ${shape(url)})`);
  }
  psql(baseUrl, ['-c', `drop database if exists ${setupDb} with (force)`]);

  // ---- Backup e restauração (procedimento real: scripts/backup.sh + restore.sh)
  const seed = psql(url, ['-f', join(testsDir, 'seed_backup.sql')]);
  if (seed.status !== 0) throw new Error(seed.stderr);
  const dumpFile = join(process.env.TMPDIR || tmpdir(), `${dbName}.dump`);
  const restoredDb = `${dbName}_restored`;
  const restoredUrl = url.replace(dbName, restoredDb);
  const sh = (script, env, args = []) => spawnSync('bash', [join(root, 'scripts', script), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  let r1 = sh('backup.sh', { SUPABASE_DB_URL: url }, [dumpFile]);
  if (r1.status !== 0) throw new Error(`backup falhou: ${r1.stderr}`);
  psql(baseUrl, ['-c', `create database ${restoredDb}`]);
  psql(restoredUrl, ['-f', join(testsDir, '00_supabase_stub.sql')]);
  r1 = sh('restore.sh', { TARGET_DB_URL: restoredUrl }, [dumpFile]);
  const counts = (u) => psql(u, ['-At', '-c', 'select (select count(*) from public.profiles)||\'/\'||(select count(*) from public.transactions)||\'/\'||(select sum(amount_cents) from public.transactions)']).stdout.trim();
  const before = counts(url);
  const after = r1.status === 0 ? counts(restoredUrl) : 'falhou';
  // a base restaurada continua funcional: cadastro (gatilhos) + RLS
  psql(restoredUrl, ['-f', join(testsDir, '01_helpers.sql')]);
  const post = r1.status === 0 ? psql(restoredUrl, ['-f', join(testsDir, '20_isolation.test.sql')]) : { status: 1, stderr: r1.stderr };
  if (r1.status !== 0 || before !== after || post.status !== 0) {
    failed++;
    console.error(`✗ backup/restauração (antes ${before}, depois ${after})\n${r1.stderr}\n${post.stderr}`);
  } else {
    console.log(`✓ backup + restauração verificados (perfis/lançamentos/soma: ${after}; RLS e cadastro funcionando na cópia)`);
  }
  rmSync(dumpFile, { force: true });
  psql(baseUrl, ['-c', `drop database if exists ${restoredDb} with (force)`]);

  psql(baseUrl, ['-c', `drop database if exists ${dbName} with (force)`]);
  console.log(`\n${tests.length - failed}/${tests.length} arquivos de teste do banco passaram${failed ? ' (com falhas)' : ''}.`);
} catch (e) {
  failed = failed || 1;
  console.error(String(e.message || e));
} finally {
  cleanup();
}
process.exit(failed ? 1 : 0);
