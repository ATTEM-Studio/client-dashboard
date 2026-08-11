const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');

function functionSource(name) {
  const match = html.match(new RegExp(
    '(^  (?:async )?function ' + name + '\\([\\s\\S]*?)(?=\\n  (?:async )?function |\\n  /\\*)',
    'm'
  ));
  assert.ok(match, name + ' helper must exist in index.html');
  return match[1];
}

assert.match(html, /id="btn-new-client"/, 'dashboard must keep the client registration button');
assert.match(html, /id="btn-new-contract"/, 'dashboard must expose a contract creation button');
assert.match(html, /data-client-tab="contracts"/, 'client detail must include a contracts tab');
assert.match(html, /id="c-renewal-count"/, 'client form must expose a renewal-count input');
assert.match(html, /id="contract-signature"/, 'contract form must include a signature canvas');

const contractSandbox = {
  state: {
    clients: [
      { id: 'cl_1', name: 'Client One', contractType: 'renewal', renewalCount: 2, startDate: '2026-08-17', status: 'active' },
      { id: 'cl_2', name: 'Client Two', contractType: 'new', startDate: '2026-08-24', status: 'active' }
    ],
    contracts: [
      { id: 'ct_1', clientId: 'cl_1', clientName: 'Client One', contractType: 'renewal', renewalCount: 2, updatedAt: 10 },
      { id: 'ct_2', clientId: 'cl_2', clientName: 'Client Two', contractType: 'new', updatedAt: 20 }
    ]
  },
  esc(value) { return String(value == null ? '' : value); },
  contractLabel(client) {
    if (client.contractType === 'renewal') return 'renewal ' + (client.renewalCount || 1);
    return 'new';
  },
  toNum(value) { return Number(String(value || '').replace(/[^\d.-]/g, '')) || 0; }
};

vm.runInNewContext([
  functionSource('blankContract'),
  functionSource('contractClientOptions'),
  functionSource('clientContracts'),
  functionSource('contractsPanel'),
  functionSource('renderContractForm')
].join('\n'), contractSandbox);

const blank = contractSandbox.blankContract();
assert.strictEqual(blank.contractType, 'new');
assert.strictEqual(blank.signatureDataUrl, '');

const options = contractSandbox.contractClientOptions(contractSandbox.state.clients);
assert.match(options, /value="cl_1"/);
assert.match(options, /Client One/);

const filtered = contractSandbox.clientContracts('cl_1');
assert.strictEqual(filtered.length, 1);
assert.strictEqual(filtered[0].id, 'ct_1');

const panel = contractSandbox.contractsPanel({ id: 'cl_1' });
assert.match(panel, /contract-card/);
assert.match(panel, /Client One/);
assert.doesNotMatch(panel, /Client Two/);
assert.match(panel, /data-new-client-contract="cl_1"/);

const renderedForm = contractSandbox.renderContractForm({
  clientId: 'cl_1',
  clientName: 'Client One',
  contractType: 'renewal',
  renewalCount: 2,
  startDate: '2026-08-17',
  contractMonths: '3',
  fee: '800000',
  terms: 'term',
  signerName: 'Signer',
  signatureDataUrl: 'data:image/png;base64,abc'
});
assert.match(renderedForm, /id="contract-client"/);
assert.match(renderedForm, /id="contract-type"/);
assert.match(renderedForm, /id="contract-renewal-count"/);
assert.match(renderedForm, /id="contract-signature"/);
assert.match(renderedForm, /id="btn-save-contract"/);
assert.match(renderedForm, /data:image\/png;base64,abc/);

const saveSandbox = {
  Date: { now: () => 12345 },
  state: {
    clients: [{ id: 'cl_1', name: 'Client One', contractType: 'renewal', renewalCount: 3, startDate: '2026-08-17' }],
    contracts: []
  },
  document: {
    getElementById(id) {
      const values = {
        'contract-client': { value: 'cl_1' },
        'contract-type': { value: 'renewal' },
        'contract-renewal-count': { value: '3' },
        'contract-start': { value: '2026-08-17' },
        'contract-months': { value: '6' },
        'contract-fee': { value: '900000' },
        'contract-terms': { value: 'special terms' },
        'contract-signer': { value: 'Signer' },
        'contract-signature': { toDataURL: () => 'data:image/png;base64,signed' }
      };
      return values[id];
    }
  },
  uid(prefix) { return prefix + '_new'; },
  showToast(message) { saveSandbox.toast = message; },
  render() { saveSandbox.rendered = true; },
  async setS(key, value) { saveSandbox.secureWrite = { key, value }; return true; },
  async setP(key, value) { saveSandbox.publicWrite = { key, value }; return true; }
};

vm.runInNewContext([
  functionSource('blankContract'),
  functionSource('saveContractFromForm')
].join('\n'), saveSandbox);

saveSandbox.saveContractFromForm().then(() => {
  assert.strictEqual(saveSandbox.secureWrite.key, 'contract:ct_new');
  assert.strictEqual(saveSandbox.secureWrite.value.renewalCount, 3);
  assert.strictEqual(saveSandbox.secureWrite.value.signatureDataUrl, 'data:image/png;base64,signed');
  assert.strictEqual(saveSandbox.publicWrite.key, 'contracts-index');
  assert.strictEqual(saveSandbox.publicWrite.value[0].id, 'ct_new');
  assert.strictEqual(saveSandbox.state.contracts[0].clientName, 'Client One');
  console.log('contract management: ok');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
