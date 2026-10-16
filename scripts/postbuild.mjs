#!/usr/bin/env node
/**
 * Pós-build: calcula o hash SHA-256 do script inline de tema em dist/index.html
 * e o injeta na Content-Security-Policy de dist/_headers (sem 'unsafe-inline').
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve(import.meta.dirname, '..', 'dist');
const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const hashes = inline.map((s) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`);
const headersPath = resolve(dist, '_headers');
if (existsSync(headersPath)) {
  const headers = readFileSync(headersPath, 'utf8').replace("'sha256-REPLACED_AT_BUILD'", hashes.join(' ') || "'none'");
  writeFileSync(headersPath, headers);
}
console.log(`CSP: ${hashes.length} script(s) inline com hash.`);

// GitHub Pages não tem fallback de SPA: 404.html = index.html faz as rotas funcionarem.
if (process.env.SPA_404 === '1') {
  copyFileSync(resolve(dist, 'index.html'), resolve(dist, '404.html'));
  console.log('404.html gerado para hospedagem estática (GitHub Pages).');
}

// O manifesto (nome/ícone do app instalado) não deve ficar no cache do service
// worker: assim uma troca de nome ou ícone chega na hora para quem instala.
const swPath = resolve(dist, 'sw.js');
if (existsSync(swPath)) {
  const sw = readFileSync(swPath, 'utf8');
  const cleaned = sw.replace(/\{url:"manifest\.webmanifest",revision:"[0-9a-f]+"\},?/g, '');
  if (cleaned !== sw) {
    writeFileSync(swPath, cleaned);
    console.log('Manifesto removido do pré-cache do service worker.');
  }
}
