const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const helperStart = html.indexOf('  function parseIsoDateParts(value){');
const helperEnd = html.indexOf('\n  function showToast', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Monday date helpers must exist in index.html');
const helperSource = html.slice(helperStart, helperEnd);
const helperSandbox = {};
vm.runInNewContext(helperSource, helperSandbox);

assert.strictEqual(helperSandbox.isMondayDate('2026-08-10'), true);
assert.strictEqual(helperSandbox.isMondayDate('2026-08-11'), false);
assert.strictEqual(helperSandbox.nextMondayAfter('2026-08-10'), '2026-08-17');
assert.strictEqual(helperSandbox.nextMondayAfter('2026-08-11'), '2026-08-17');
assert.strictEqual(helperSandbox.validateClientStartDate({ contractType: 'new', startDate: '2026-08-11' }), '?좉퇋 怨꾩빟 ?쒖옉?쇱? ?붿슂?쇰쭔 ?좏깮?????덉뒿?덈떎.');
assert.strictEqual(helperSandbox.validateClientStartDate({ contractType: 'new', startDate: '2026-08-10' }), '');
assert.notStrictEqual(helperSandbox.validateClientStartDate({ contractType: 'new', startDate: '' }), '',
  'a new contract without a start date must be rejected');

const start = html.indexOf('  function renderClientForm(base){');
const end = html.indexOf('\n  async function deleteClient', start);
assert.ok(start >= 0 && end > start, 'renderClientForm must exist in index.html');
const source = html.slice(start, end);

function saveRenewalClient(options) {
  const stored = [];
  const saveButton = eventTarget({ disabled: false, textContent: '' });
  const startDate = Object.hasOwn(options, 'startDate') ? options.startDate : '2026-08-10';
  const elements = {
    'c-name': { value: options.name || 'Renewal Co' },
    'c-industry': { value: '' },
    'c-manager': { value: '' },
    'c-fee': { value: '' },
    'c-start': eventTarget({ value: startDate, customValidity: '' }),
    'c-months': { value: '3' },
    'c-memo': { value: '' },
    'btn-save-client': saveButton,
    'btn-back': eventTarget({}),
    'btn-cancel': eventTarget({})
  };
  elements['c-start'].setCustomValidity = function(message) { this.customValidity = message; };
  elements['c-start'].focus = function() { this.focused = true; };
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
    validateClientStartDate: helperSandbox.validateClientStartDate,
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

  const invalidNewClient = await saveRenewalClient({ startDate: '2026-08-11' });
  assert.deepStrictEqual(invalidNewClient, [],
    'saving a new client with a non-Monday start date must not persist the client');

  const missingStartDateClient = await saveRenewalClient({ startDate: '' });
  assert.deepStrictEqual(missingStartDateClient, [],
    'saving a new client without a start date must not persist the client');

  console.log('client renewal save persistence: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
