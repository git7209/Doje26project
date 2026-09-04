import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const output = new URL('./dist/server/', import.meta.url);
await rm(new URL('./dist/', import.meta.url), { recursive: true, force: true });
await mkdir(output, { recursive: true });

const [html, css, script] = await Promise.all([
  readFile(new URL('./index.html', import.meta.url), 'utf8'),
  readFile(new URL('./styles.css', import.meta.url), 'utf8'),
  readFile(new URL('./script.js', import.meta.url), 'utf8'),
]);

const worker = `const files = new Map([
  ['/', { type: 'text/html; charset=utf-8', body: ${JSON.stringify(html)} }],
  ['/index.html', { type: 'text/html; charset=utf-8', body: ${JSON.stringify(html)} }],
  ['/styles.css', { type: 'text/css; charset=utf-8', body: ${JSON.stringify(css)} }],
  ['/script.js', { type: 'text/javascript; charset=utf-8', body: ${JSON.stringify(script)} }],
]);

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const file = files.get(url.pathname);
    if (!file) return new Response('Not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : file.body, {
      headers: {
        'content-type': file.type,
        'cache-control': url.pathname === '/' || url.pathname === '/index.html' ? 'no-cache' : 'public, max-age=3600',
        'x-content-type-options': 'nosniff',
      },
    });
  },
};
`;

await writeFile(new URL('./dist/server/index.js', import.meta.url), worker);
console.log('Built LXC Console website');
