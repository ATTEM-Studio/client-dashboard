const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/(function checklistPeriod[\s\S]*?\n  }\n\n  function cloneChecklistSet[\s\S]*?\n  })/);
assert.ok(match, 'calendar and checklist-set helpers must exist in index.html');

const sandbox = {};
vm.runInNewContext(match[1], sandbox);

assert.strictEqual(sandbox.checklistPeriod('2026-07-22', '2026-07-22'), '1');
assert.strictEqual(sandbox.checklistPeriod('2026-07-22', '2026-07-29'), '2');
assert.strictEqual(sandbox.checklistPeriod('2026-07-22', '2026-08-12'), '4');
assert.strictEqual(sandbox.checklistPeriod('2026-07-22', '2026-08-19'), 'closing');
assert.strictEqual(sandbox.checklistPeriod('2026-07-22', '2026-08-20'), 'closing');
assert.strictEqual(sandbox.checklistPeriod('2026-07-22', '2026-08-21'), null);
assert.strictEqual(sandbox.checklistPeriod('', '2026-08-10'), null);

const source = { id: 'set-1', items: [{ text: '키워드 점검', week: '1' }] };
const copied = sandbox.cloneChecklistSet(source, () => 'task-1');
assert.deepStrictEqual(JSON.parse(JSON.stringify(copied)), [{ id: 'task-1', text: '키워드 점검', week: '1', done: false, setId: 'set-1' }]);
copied[0].text = '변경';
assert.strictEqual(source.items[0].text, '키워드 점검');

console.log('calendar and checklist-set helpers: ok');
