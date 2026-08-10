const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/(async function openClient[\s\S]*?\n  \})/);
assert.ok(match, 'client reopening behavior must exist');

async function run(){
  const draft = {
    id: null,
    name: 'typed set name',
    description: 'typed description',
    items: [{ day: 30, text: 'typed closing task' }]
  };
  let renderCalls = 0;
  const sandbox = {
    state: {
      checklistSetDraft: draft,
      checklistSetPeriod: 'closing',
      setCollectionOpen: true
    },
    async getS(){
      return { id: 'client-1', name: 'Client', checklist: [] };
    },
    showToast(){ throw new Error('client unexpectedly missing'); },
    render(){ renderCalls += 1; }
  };
  vm.runInNewContext(match[1], sandbox);

  await sandbox.openClient('client-1');

  assert.strictEqual(sandbox.state.checklistSetDraft, draft, 'Back/Edit followed by reopening a client must retain the synchronized shared-set draft');
  assert.strictEqual(sandbox.state.checklistSetPeriod, 'closing', 'reopening must restore the selected editor period');
  assert.strictEqual(sandbox.state.setCollectionOpen, false, 'the collection can reopen compactly without discarding its draft');
  assert.strictEqual(sandbox.state.currentClient.id, 'client-1');
  assert.strictEqual(renderCalls, 1);
  console.log('checklist draft preservation: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
