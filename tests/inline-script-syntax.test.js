const fs = require('fs');
const assert = require('assert');
const vm = require('vm');

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

const draftNavigation = html.match(/(function setChecklistCollectionOpen[\s\S]*?\n  }\n  function setClientWorkspaceTab[\s\S]*?\n  })/);
assert.ok(draftNavigation, 'checklist set draft navigation helpers must exist');

const draft = { name: 'before typing', items: [{ day: 1, text: 'before typing' }] };
let syncCalls = 0;
const sandbox = {
  state: { setCollectionOpen: true, checklistSetDraft: draft, clientTab: 'checklist' },
  syncChecklistSetEditor(){
    syncCalls += 1;
    draft.name = 'typed set name';
    draft.items[0].text = 'typed task';
  }
};
vm.runInNewContext(draftNavigation[1], sandbox);

sandbox.setChecklistCollectionOpen(false);
assert.strictEqual(sandbox.state.setCollectionOpen, false, 'visibility toggle must collapse the collection');
assert.strictEqual(sandbox.state.checklistSetDraft, draft, 'collapsing the collection must preserve its unsaved draft');
assert.strictEqual(syncCalls, 1, 'collapsing the editor must synchronize its visible fields before rerendering');
assert.strictEqual(draft.name, 'typed set name');
assert.strictEqual(draft.items[0].text, 'typed task');
sandbox.setChecklistCollectionOpen(true);
assert.strictEqual(sandbox.state.checklistSetDraft, draft, 'reopening the collection must restore the same draft');

sandbox.setClientWorkspaceTab('reports');
assert.strictEqual(syncCalls, 2, 'tab navigation must synchronize visible editor fields before rerendering');
assert.strictEqual(sandbox.state.clientTab, 'reports');
assert.strictEqual(draft.name, 'typed set name');
assert.strictEqual(draft.items[0].text, 'typed task');
console.log('inline script syntax: ok');
