const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('  function renderClientForm(base){');
const end = html.indexOf('\n  async function deleteClient', start);
assert.ok(start >= 0 && end > start, 'renderClientForm must exist in index.html');
const source = html.slice(start, end);

function saveRenewalClient(options) {
  const stored = [];
  const saveButton = eventTarget({ disabled: false, textContent: '' });
  const elements = {
    'c-name': { value: options.name || 'Renewal Co' },
    'c-industry': { value: '' },
    'c-manager': { value: '' },
    'c-fee': { value: '' },
    'c-start': { value: '2026-08-01' },
    'c-months': { value: '3' },
    'c-memo': { value: '' },
    'btn-save-client': saveButton,
    'btn-back': eventTarget({}),
    'btn-cancel': eventTarget({})
  };
  const context = {
    app: { innerHTML: '' },
    state: { clients: [] },
    document: {
      getElementById(id) { return elements[id]; },
      querySelectorAll() { return []; }
    },
    esc(value) { return String(value == null ? '' : value); },
    blankClient() {
      return {
        name: '', industry: '', manager: '', contractType: 'new', startDate: '', contractMonths: '3',
        fee: '', status: 'active', memo: '', checklist: [], progress: {}, renewals: []
      };
    },
    uid() { return 'new-client'; },
    async setS(key, value) { stored.push({ key, value }); return true; },
    async setP() { return true; },
    showToast() {},
    render() {},
    console
  };
  vm.runInNewContext(source, context);
  context.renderClientForm(options.base);
  return saveButton.handlers.click.call(saveButton).then(() => stored);
}

function eventTarget(target) {
  target.handlers = {};
  target.addEventListener = function(type, handler) { this.handlers[type] = handler; };
  return target;
}

(async () => {
  const newRenewal = await saveRenewalClient({ base: { contractType: 'renewal' } });
  assert.strictEqual(newRenewal[0].value.contractType, 'renewal');
  assert.strictEqual(newRenewal[0].value.renewalCount, 1,
    'saving a new renewal client must persist renewalCount 1');

  const legacyRenewal = await saveRenewalClient({
    base: { id: 'legacy-client', name: 'Legacy Renewal', contractType: 'renewal', checklist: [], progress: {}, renewals: [] }
  });
  assert.strictEqual(legacyRenewal[0].value.renewalCount, 1,
    'saving a legacy renewal client without renewalCount must persist renewalCount 1');

  const newClient = await saveRenewalClient({
    base: { id: 'new-client', name: 'New Client', contractType: 'new', checklist: [], progress: {}, renewals: [] }
  });
  assert.strictEqual(Object.hasOwn(newClient[0].value, 'renewalCount'), false,
    'saving a non-renewal client must keep the existing data shape');

  console.log('client renewal save persistence: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
