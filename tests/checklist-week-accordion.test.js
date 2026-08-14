const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
assert.match(html, /today-pending/, 'checklist rows need a pending-day status');
assert.match(html, /today-done/, 'checklist rows need a completed-day status');
assert.match(html, /today-missed/, 'checklist rows need an incomplete-day status');

function functionSource(name) {
  const match = html.match(new RegExp(
    '(^  (?:async )?function ' + name + '\\([\\s\\S]*?)(?=\\n  (?:async )?function |\\n  /\\*)',
    'm'
  ));
  assert.ok(match, name + ' helper must exist in index.html');
  return match[1];
}

const sandbox = {
  state: { setCollectionOpen: false, checklistWeeksOpen: { '1': true, closing: true } },
  esc(value) { return String(value == null ? '' : value); },
  checklistTaskTodayClass() { return ''; },
  checklistSetCollectionPanel() { return '<div class="sets"></div>'; }
};

vm.runInNewContext([
  functionSource('calendarDateOrdinal'),
  functionSource('calendarDayOrdinal'),
  functionSource('isWeekendDate'),
  functionSource('workdayOrdinal'),
  functionSource('cycleDayOrdinal'),
  functionSource('checklistPeriod'),
  functionSource('dailyPeriod'),
  functionSource('periodLabel'),
  functionSource('isoDate'),
  functionSource('isoFromUtcDate'),
  functionSource('checklistTaskPeriod'),
  functionSource('checklistSections'),
  functionSource('checklistPanel')
].join('\n'), sandbox);

const client = {
  startDate: '2026-08-10',
  excludeWeekends: true,
  checklist: [
    { id: 'day-1', day: 1, text: 'first workday', done: true },
    { id: 'day-2', day: 2, text: 'second workday', done: false },
    { id: 'legacy-2', week: '2', text: 'legacy second week', done: false },
    { id: 'closing', day: 29, text: 'closing task', done: false },
    { id: 'none', week: '', text: 'unassigned task', done: false }
  ]
};

const rendered = sandbox.checklistPanel(client, client.checklist, 1);

assert.match(rendered, /class="check-section/);
assert.match(rendered, /data-toggle-check-section="1"[^>]*aria-expanded="true"/);
assert.match(rendered, /1주차[\s\S]*1 \/ 2 완료/);
assert.match(rendered, /first workday[\s\S]*second workday/);
assert.match(rendered, /data-toggle-check-section="2"[^>]*aria-expanded="false"/);
assert.match(rendered, /check-section is-collapsed[\s\S]*?check-section-body-inner" aria-hidden="true" inert/,
  'collapsed sections must keep their task controls out of the keyboard and accessibility trees');
assert.doesNotMatch(rendered, /legacy second week[\s\S]*data-toggle-work="legacy-2"/,
  'collapsed week sections must hide their task rows until toggled open');
assert.match(rendered, /data-toggle-check-section="closing"[^>]*aria-expanded="true"/);
assert.match(rendered, /마무리[\s\S]*closing task/);
assert.match(rendered, /data-toggle-check-section="unassigned"/);
assert.match(rendered, /미배정[\s\S]*unassigned task/);
assert.match(rendered, /data-toggle-work="day-1"/);
assert.match(rendered, /data-del-work="day-1"/);
assert.match(rendered, /data-add-task/);

const originalSection = {
  classList: {
    values: new Set(['check-section', 'is-collapsed']),
    toggle(name, force) {
      if (force) this.values.add(name);
      else this.values.delete(name);
    },
    contains(name) { return this.values.has(name); }
  },
  querySelector(selector) {
    return selector === '.check-section-body-inner' ? originalBody : null;
  }
};
const originalBody = {
  attrs: { 'aria-hidden': 'true', inert: '' },
  setAttribute(name, value) { this.attrs[name] = String(value); },
  removeAttribute(name) { delete this.attrs[name]; },
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name); },
  getAttribute(name) { return this.attrs[name]; }
};
const originalToggle = {
  attrs: { 'data-toggle-check-section': '2', 'aria-expanded': 'false' },
  getAttribute(name) { return this.attrs[name]; },
  setAttribute(name, value) { this.attrs[name] = String(value); },
  closest(selector) { return selector === '.check-section' ? originalSection : null; }
};
let workspaceRenderCount = 0;
const behaviorSandbox = {
  state: { checklistWeeksOpen: {} },
  app: {
    mountedSection: originalSection,
    mountedBody: originalBody,
    querySelectorAll(selector) {
      return selector === '[data-toggle-check-section]' ? [originalToggle] : [];
    },
    querySelector() { return null; }
  },
  document: {
    querySelector() { return null; },
    getElementById() { return null; }
  },
  renderClientWorkspace() {
    workspaceRenderCount += 1;
    behaviorSandbox.app.mountedSection = { replacement: true };
    behaviorSandbox.app.mountedBody = { replacement: true };
  }
};
vm.runInNewContext(functionSource('bindChecklistPanel'), behaviorSandbox);
behaviorSandbox.bindChecklistPanel({});

const sectionRef = behaviorSandbox.app.mountedSection;
const bodyRef = behaviorSandbox.app.mountedBody;
originalToggle.onclick();
assert.equal(workspaceRenderCount, 0, 'opening a week does not rerender the workspace');
assert.equal(behaviorSandbox.app.mountedSection, sectionRef, 'the original section node persists when opening');
assert.equal(behaviorSandbox.app.mountedBody, bodyRef, 'the original section body persists when opening');
assert.equal(behaviorSandbox.state.checklistWeeksOpen['2'], true, 'opening persists the section state');
assert.equal(originalToggle.getAttribute('aria-expanded'), 'true', 'opening updates aria-expanded in place');
assert.equal(originalSection.classList.contains('is-collapsed'), false, 'opening removes the collapsed transition class');
assert.equal(originalBody.getAttribute('aria-hidden'), 'false', 'opening exposes the section body');
assert.equal(originalBody.hasAttribute('inert'), false, 'opening removes inert from the section body');

originalToggle.onclick();
assert.equal(workspaceRenderCount, 0, 'closing a week does not rerender the workspace');
assert.equal(behaviorSandbox.app.mountedSection, sectionRef, 'the original section node persists when closing');
assert.equal(behaviorSandbox.app.mountedBody, bodyRef, 'the original section body persists when closing');
assert.equal(behaviorSandbox.state.checklistWeeksOpen['2'], false, 'closing persists the section state');
assert.equal(originalToggle.getAttribute('aria-expanded'), 'false', 'closing updates aria-expanded in place');
assert.equal(originalSection.classList.contains('is-collapsed'), true, 'closing restores the collapsed transition class');
assert.equal(originalBody.getAttribute('aria-hidden'), 'true', 'closing hides the section body');
assert.equal(originalBody.hasAttribute('inert'), true, 'closing restores inert on the section body');

console.log('checklist week accordion: ok');
