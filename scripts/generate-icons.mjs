#!/usr/bin/env node
/** Gera os ícones PNG do PWA a partir do SVG da marca (usa o Chromium do Playwright). */
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const out = resolve(import.meta.dirname, '..', 'public');
const svg = (pad, radius) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><radialGradient id="g" cx="80%" cy="10%" r="90%"><stop offset="0" stop-color="#10b981" stop-opacity=".28"/><stop offset="1" stop-color="#10b981" stop-opacity="0"/></radialGradient></defs>
  <rect width="512" height="512" rx="${radius}" fill="#070b14"/>
  <rect width="512" height="512" rx="${radius}" fill="url(#g)"/>
  <g transform="translate(${pad} ${pad}) scale(${(512 - pad * 2) / 512})">
    <rect x="118" y="276" width="64" height="120" rx="22" fill="#10b981" opacity=".55"/>
    <rect x="224" y="200" width="64" height="196" rx="22" fill="#10b981" opacity=".8"/>
    <rect x="330" y="116" width="64" height="280" rx="22" fill="#34d399"/>
  </g>
</svg>`;

const targets = [
  { file: 'pwa-192.png', size: 192, pad: 0, radius: 112 },
  { file: 'pwa-512.png', size: 512, pad: 0, radius: 112 },
  { file: 'pwa-maskable-512.png', size: 512, pad: 70, radius: 0 },
  { file: 'apple-touch-icon.png', size: 180, pad: 30, radius: 0 },
];

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(t.pad, t.radius).replace('<svg ', `<svg width="${t.size}" height="${t.size}" `)}</body></html>`);
  await page.screenshot({ path: resolve(out, t.file), omitBackground: true });
  console.log('✓', t.file);
}
await browser.close();
