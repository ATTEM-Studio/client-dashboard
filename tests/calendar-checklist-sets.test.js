const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/(function checklistPeriod[\s\S]*?\n  }\n  function dailyPeriod[\s\S]*?\n  }[\s\S]*?\n\n  function cloneChecklistSet[\s\S]*?\n  })/);
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

assert.strictEqual(sandbox.dailyPeriod(1), '1');
assert.strictEqual(sandbox.dailyPeriod(7), '1');
assert.strictEqual(sandbox.dailyPeriod(8), '2');
assert.strictEqual(sandbox.dailyPeriod(28), '4');
assert.strictEqual(sandbox.dailyPeriod(29), 'closing');
assert.strictEqual(sandbox.dailyPeriod(30), 'closing');
assert.strictEqual(sandbox.dailyPeriod(0), null);
assert.strictEqual(sandbox.dailyPeriod(31), null);

const source = { id: 'set-1', items: [{ text: 'legacy task', week: '1' }] };
const copied = sandbox.cloneChecklistSet(source, () => 'task-1');
assert.deepStrictEqual(JSON.parse(JSON.stringify(copied)), [{ id: 'task-1', text: 'legacy task', week: '1', done: false, setId: 'set-1' }]);
copied[0].text = 'changed legacy task';
assert.strictEqual(source.items[0].text, 'legacy task');

const dailySource = { id: 'set-daily', items: [
  { text: 'first day task', day: 1 },
  { text: 'another first day task', day: 1 },
  { text: 'closing task', day: 29 }
] };
const dailyIds = ['daily-1', 'daily-2', 'daily-3'];
const dailyCopied = sandbox.cloneChecklistSet(dailySource, () => dailyIds.shift());
assert.deepStrictEqual(JSON.parse(JSON.stringify(dailyCopied)), [
  { id: 'daily-1', text: 'first day task', day: 1, done: false, setId: 'set-daily' },
  { id: 'daily-2', text: 'another first day task', day: 1, done: false, setId: 'set-daily' },
  { id: 'daily-3', text: 'closing task', day: 29, done: false, setId: 'set-daily' }
]);
dailyCopied[0].text = 'changed task';
assert.strictEqual(dailySource.items[0].text, 'first day task');

console.log('calendar and checklist-set helpers: ok');
