// Produce dist/assimilate.html: the built game as one self-contained file (no other assets),
// convenient for sharing or hosting anywhere. Run after `npm run build`.
import { readFileSync, writeFileSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
let html = readFileSync(new URL('index.html', dist), 'utf8');
const read = (p) => readFileSync(new URL(p.replace(/^\.\//, ''), dist), 'utf8');

html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/, (_, href) => `<style>${read(href)}</style>`);
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/, (_, src) => {
  const js = read(src).replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});
// Icons and manifest are separate files; inline the SVG icon and drop the rest.
const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
html = html.replace(/<link rel="manifest"[^>]*>\s*/, '')
  .replace(/<link rel="apple-touch-icon"[^>]*>\s*/, '')
  .replace(/href="\.\/icon\.svg"/, `href="data:image/svg+xml,${encodeURIComponent(svg)}"`);
if (/src="\.\/|href="\.\/assets/.test(html)) throw new Error('Unresolved asset reference left in single-file build');
writeFileSync(new URL('assimilate.html', dist), html);
console.log(`dist/assimilate.html ${(html.length / 1024).toFixed(1)} KB`);
