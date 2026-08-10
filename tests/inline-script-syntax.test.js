const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('index.html', 'utf8');
const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
new Function(script);

assert.match(html, /id="btn-toggle-sets"[^>]*aria-expanded=/, 'checklist view must expose the compact set toggle');
assert.doesNotMatch(html, /return '<div class="workspace-columns"/, 'ordinary checklist view must not render the old two-column set panel');
assert.match(html, /data-set-period="1"/, 'set editor must navigate to week 1');
assert.match(html, /data-set-period="4"/, 'set editor must navigate to week 4');
assert.match(html, /data-set-period="closing"/, 'set editor must navigate to the closing period');
assert.match(html, /data-set-day="29"/, 'closing editor must expose day 29');
assert.match(html, /data-set-day="30"/, 'closing editor must expose day 30');
assert.match(html, /data-add-set-task/, 'each day must support adding task rows');
assert.match(html, /data-remove-set-task/, 'daily task rows must be independently removable');
console.log('inline script syntax: ok');
