const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const guideSource = fs.readFileSync(path.join(root, 'guide.html'), 'utf8');
const authSource = fs.readFileSync(path.join(root, 'api', 'auth.js'), 'utf8');
const apiSource = fs.readdirSync(path.join(root, 'api'))
  .filter((file) => file.endsWith('.js'))
  .map((file) => fs.readFileSync(path.join(root, 'api', file), 'utf8'))
  .join('\n');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

function inlineScriptHashes(source) {
  const hashes = [];
  const matcher = /<script>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = matcher.exec(source))) {
    hashes.push('sha256-' + crypto.createHash('sha256').update(match[1], 'utf8').digest('base64'));
  }
  return hashes;
}

function contentSecurityPolicy(config) {
  for (const route of config.headers || []) {
    for (const header of route.headers || []) {
      if (String(header.key).toLowerCase() === 'content-security-policy') return header.value;
    }
  }
  return '';
}

const csp = contentSecurityPolicy(vercel);

assert.doesNotMatch(
  indexSource,
  /(?:localStorage|sessionStorage)\.setItem\(\s*['"][^'"]*(?:password|authToken|access[_-]?token|bearer)[^'"]*['"]/i,
  'browser storage must not persist authentication credentials'
);
assert.doesNotMatch(authSource, /\.json\(\s*\{[^}]*\b(?:expected|password|token)\b/i,
  'the authentication endpoint must not return password or session material');
assert.doesNotMatch(apiSource, /\bauthToken\b/,
  'server APIs must not authorize requests through the retired authToken');
assert.doesNotMatch(apiSource, /console\.(?:log|debug|info|warn|error)\s*\(/,
  'server APIs must not write potentially sensitive request or upstream errors to logs');

assert.ok(csp, 'Vercel must send a Content Security Policy');
for (const directive of [
  "default-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'"
]) {
  assert.ok(csp.includes(directive), 'CSP must include ' + directive);
}
assert.match(csp, /script-src[^;]*'self'/, 'CSP must allow same-origin static scripts');
assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/,
  'inline scripts must be authorized by hashes, not unsafe-inline');

for (const hash of [...inlineScriptHashes(indexSource), ...inlineScriptHashes(guideSource)]) {
  assert.ok(csp.includes("'" + hash + "'"),
    'CSP script-src hash must match the exact inline script contents: ' + hash);
}

console.log('security regression: ok');
