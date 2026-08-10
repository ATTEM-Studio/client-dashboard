const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/(function calendarMonthShift[\s\S]*?\n  })/);
assert.ok(match, 'calendarMonthShift must exist for previous and next month navigation');

const sandbox = {};
vm.runInNewContext(match[1], sandbox);
assert.strictEqual(sandbox.calendarMonthShift('2026-07', -1), '2026-06');
assert.strictEqual(sandbox.calendarMonthShift('2026-12', 1), '2027-01');
assert.strictEqual(sandbox.calendarMonthShift('2026-01', -1), '2025-12');

assert.match(html, /data-calendar-month="prev"/);
assert.match(html, /data-calendar-month="next"/);
assert.match(html, /data-add-task/);
assert.match(html, /data-del-work/);
assert.match(html, /id="btn-renew"/);
assert.match(html, /confirmDialog\("리포트를 삭제할까요\?"/);
console.log('calendar navigation and workspace controls: ok');
