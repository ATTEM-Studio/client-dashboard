const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
assert.match(html, /id=\"btn-menu-ranking\"[^>]*href=\"https:\/\/planking\.vercel\.app\/\"/);
assert.match(html, /id=\"btn-menu-ranking\"[^>]*role=\"menuitem\"/);
assert.match(html, /순위 추적/);
console.log('ranking menu link: ok');
