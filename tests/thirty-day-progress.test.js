process.env.TZ = 'America/New_York';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/(function calendarDateOrdinal[\s\S]*?\r?\n  }\r?\n)(?=  function computeDelta)/);
assert.ok(match, 'thirtyDayProgress must exist in index.html');

const sandbox = {};
vm.runInNewContext(match[1], sandbox);
const progress = (start, today) => JSON.parse(JSON.stringify(
  sandbox.thirtyDayProgress(start, new Date(today + 'T12:00:00'))
));

assert.deepStrictEqual(progress('2026-07-22', '2026-07-21'), {
  state: 'upcoming', elapsed: 0, week: 0, percent: 0, remaining: 30
});
assert.deepStrictEqual(progress('2026-07-22', '2026-07-22'), {
  state: 'active', elapsed: 1, week: 1, percent: 3, remaining: 29
});
assert.deepStrictEqual(progress('2026-07-22', '2026-07-29'), {
  state: 'active', elapsed: 8, week: 2, percent: 27, remaining: 22
});
assert.deepStrictEqual(progress('2026-07-22', '2026-08-20'), {
  state: 'complete', elapsed: 30, week: 5, percent: 100, remaining: 0
});
assert.deepStrictEqual(progress('', '2026-08-10'), {
  state: 'missing', elapsed: 0, week: 0, percent: 0, remaining: 30
});
assert.deepStrictEqual(progress('2026-02-30', '2026-08-10'), {
  state: 'missing', elapsed: 0, week: 0, percent: 0, remaining: 30
});

assert.deepStrictEqual(progress('2026-03-07', '2026-03-14'), {
  state: 'active', elapsed: 8, week: 2, percent: 27, remaining: 22
}, 'spring DST must not shorten the elapsed calendar-day count');
assert.deepStrictEqual(progress('2026-03-07', '2026-04-04'), {
  state: 'active', elapsed: 29, week: 5, percent: 97, remaining: 1
});
assert.deepStrictEqual(progress('2026-03-07', '2026-04-05'), {
  state: 'complete', elapsed: 30, week: 5, percent: 100, remaining: 0
});

const active = progress('2026-07-22', '2026-08-02');
assert.strictEqual(active.week, 2);
assert.strictEqual(active.elapsed, 12);
assert.strictEqual(active.percent, 40);
assert.strictEqual(active.remaining, 18);
assert.match(html, /class="day-progress"/);
assert.match(html, /class="day-progress-weeks"/);
assert.match(html, /1일–7일/);
assert.match(html, /29일–30일/);
