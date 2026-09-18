const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const manifest = JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));
const serviceWorker = fs.readFileSync('sw.js', 'utf8');
const registration = fs.readFileSync('pwa-register.js', 'utf8');
const offline = fs.readFileSync('offline.html', 'utf8');

assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"\s*\/?>/);
assert.match(html, /<meta name="theme-color" content="#3182F6"\s*\/?>/);
assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes"\s*\/?>/);
assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/icon-192\.png"\s*\/?>/);
assert.match(html, /<script src="\/pwa-register\.js" defer><\/script>/);
assert.match(registration, /navigator\.serviceWorker\.register\(['"]\/sw\.js['"]\)/);
assert.doesNotMatch(html, /<\/title>\\n<meta/, 'head markup must contain real newlines, not literal escape text');

assert.equal(manifest.name, '그리온 업체관리');
assert.equal(manifest.short_name, '그리온 관리');
assert.equal(manifest.start_url, '/');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.theme_color, '#3182F6');
assert.equal(manifest.background_color, '#F2F4F6');
assert.ok(manifest.icons.some((icon) => icon.src === '/icons/icon-192.png' && icon.sizes === '192x192'));
assert.ok(manifest.icons.some((icon) => icon.src === '/icons/icon-512.png' && icon.sizes === '512x512'));

assert.match(serviceWorker, /offline\.html/);
assert.match(serviceWorker, /request\.mode === ['"]navigate['"]/);
assert.match(serviceWorker, /url\.pathname\.startsWith\(['"]\/api\/['"]\)\) return;/,
  'service worker must bypass authenticated API responses');
assert.doesNotMatch(serviceWorker, /cache\.put\(request/,
  'service worker must not add runtime API responses to its cache');
assert.match(offline, /네트워크 연결을 확인해 주세요/);

console.log('PWA installability: ok');
