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
assert.doesNotMatch(html, /id="btn-new-contract"/, 'dashboard must not expose a separate contract creation button');
assert.match(html, /data-client-tab="contracts"/, 'client detail must include a contracts tab');
assert.match(html, /id="c-renewal-count"/, 'client form must expose a renewal-count input');
assert.match(html, /id="contract-signature"/, 'contract form must include a signature canvas');
assert.match(html, /id="contract-client-name"/, 'contract form must use direct client-name entry');
assert.match(html, /id="contract-product-name"/, 'contract form must include product detail fields');
assert.match(html, /id="contract-payment-method"/, 'contract form must include payment method');
assert.match(html, /id="contract-business-number"/, 'contract form must include business details');
assert.match(html, /\?contract=/, 'contract form must expose a shareable public contract link');
assert.match(html, /renderPublicContract/, 'public contract route renderer must exist');
assert.match(html, /mutatePublicContract/, 'browser transport must support public contract saves');
assert.match(html, /await getS\("contract:"\+id\)/,
  'opening a saved contract original must reload the full contract document, not the lightweight index row');

const contractSandbox = {
  state: {
    clients: [],
    contracts: [
      { id: 'ct_1', clientId: 'cl_1', clientName: 'Client One', contractType: 'renewal', renewalCount: 2, signerName: 'Owner', submittedAt: 12345, hasSignature: true, updatedAt: 10 },
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
  functionSource('clientContracts'),
  functionSource('contractsPanel'),
  functionSource('renderContractForm')
].join('\n'), contractSandbox);

const blank = contractSandbox.blankContract();
assert.strictEqual(blank.contractType, 'new');
assert.strictEqual(blank.signatureDataUrl, '');

const filtered = contractSandbox.clientContracts('cl_1');
assert.strictEqual(filtered.length, 1);
assert.strictEqual(filtered[0].id, 'ct_1');

const panel = contractSandbox.contractsPanel({ id: 'cl_1' });
assert.match(panel, /contract-card/);
assert.match(panel, /Client One/);
assert.doesNotMatch(panel, /Client Two/);
assert.match(panel, /data-new-client-contract="cl_1"/);
assert.match(panel, /data-open-contract="ct_1"/, 'saved contract card should open the original contract');
assert.match(panel, /data-open-contract-link="ct_1"/, 'saved contract card should open the public contract link');
assert.match(panel, /data-copy-contract-link="ct_1"/, 'saved contract card should copy the public contract link');
assert.match(panel, /서명 완료|signed/i, 'signed contract cards must clearly show that a signature was received');

const renderedForm = contractSandbox.renderContractForm({
  id: 'contract_secret_123456789012345678901234',
  clientId: 'cl_secret',
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
assert.match(renderedForm, /id="contract-client-name"/);
assert.doesNotMatch(renderedForm, /id="contract-client"/);
assert.match(renderedForm, /\?contract=contract_secret_123456789012345678901234/);
assert.match(renderedForm, /btn-copy-contract-link/);
assert.match(renderedForm, /id="contract-type"/);
assert.match(renderedForm, /id="contract-renewal-count"/);
assert.doesNotMatch(renderedForm, /id="contract-renewal-count-field" style="display:none"/, 'renewal contract form must show renewal count');
assert.match(renderedForm, /id="contract-product-name"/);
assert.match(renderedForm, /value="custom"/, 'product picker should allow a custom newly-created product');
assert.doesNotMatch(renderedForm, /사진\/달 파운드/, 'photo-related product option should be removed');
assert.match(renderedForm, /id="contract-payment-method"/);
assert.match(renderedForm, /value="card"/, 'contract payment method should include card');
assert.match(renderedForm, /value="transfer"/, 'contract payment method should include bank transfer');
assert.doesNotMatch(renderedForm, /정기결제|선결제 1회차|선결제 6회차|선결제 12회차/, 'old recurring/prepay payment choices should be removed');
assert.match(renderedForm, /id="contract-base-terms"/, 'base contract terms editor should remain available');
assert.match(renderedForm, /id="btn-save-base-terms-template"/, 'base contract terms should have a reusable template save button');
assert.doesNotMatch(renderedForm, /28일 단위 정기 결제형 마케팅 서비스 계약서/, 'base contract terms should start blank until a template is saved');
assert.match(renderedForm, /id="contract-signature"/);
assert.match(renderedForm, /id="btn-save-contract"/);
assert.doesNotMatch(renderedForm, /signature-preview/, 'signature area should not render a separate preview box under the canvas');
assert.doesNotMatch(renderedForm, /예: 최진혁\(경기\)/, 'owner placeholder example should be removed');
assert.match(renderedForm, /id="contract-start"[\s\S]*id="contract-months"[\s\S]*PRODUCT/, 'contract months should sit beside the start date in the contract application section');
const newContractForm = contractSandbox.renderContractForm({
  id: 'contract_secret_new_123456789012345678901',
  clientId: 'cl_new_secret',
  clientName: 'New Client',
  contractType: 'new'
});
assert.match(newContractForm, /id="contract-renewal-count-field" style="display:none"/, 'new contract form must hide renewal count');

const saveSandbox = {
  Date: { now: () => 12345 },
  state: {
    clients: [],
    contracts: []
  },
  document: {
    getElementById(id) {
      const values = {
        'contract-client-name': { value: 'Client One' },
        'contract-type': { value: 'renewal' },
        'contract-renewal-count': { value: '3' },
        'contract-product-type': { value: 'custom' },
        'contract-product-name': { value: '다각화 플랜' },
        'contract-supply-price': { value: '700000' },
        'contract-payment-method': { value: 'card' },
        'contract-business-number': { value: '123-45-67890' },
        'contract-contact': { value: '010-0000-0000' },
        'contract-email': { value: 'example@domain.com' },
        'contract-start': { value: '2026-08-17' },
        'contract-months': { value: '6' },
        'contract-fee': { value: '900000' },
        'contract-terms': { value: 'special terms' },
        'contract-special-terms': { value: 'special extra' },
        'contract-internal-memo': { value: 'private memo' },
        'contract-owner': { value: 'Manager' },
        'contract-signer': { value: 'Signer' },
        'contract-signature': { toDataURL: () => 'data:image/png;base64,signed' }
      };
      return values[id];
    }
  },
  uid(prefix) { return prefix + '_new'; },
  esc(value) { return String(value == null ? '' : value); },
  showToast(message) { saveSandbox.toast = message; },
  render() { saveSandbox.rendered = true; },
  async setS(key, value) { saveSandbox.secureWrites = saveSandbox.secureWrites || []; saveSandbox.secureWrites.push({ key, value }); return true; },
  async setP(key, value) { saveSandbox.publicWrite = { key, value }; return true; }
};

vm.runInNewContext([
  functionSource('blankContract'),
  functionSource('newContractDraft'),
  functionSource('publicContractPayload'),
  functionSource('renderPublicContract'),
  functionSource('blankClient'),
  functionSource('formValue'),
  functionSource('formValueOr'),
  functionSource('signatureValueFromCanvas'),
  functionSource('collectContractFromForm'),
  functionSource('saveContractFromForm')
].join('\n'), saveSandbox);

const draft = saveSandbox.newContractDraft();
assert.match(draft.id, /^contract_/);
assert.match(draft.clientId, /^cl_/);
const publicPayload = saveSandbox.publicContractPayload({
  id: 'contract_public',
  clientId: 'cl_public',
  clientName: 'Visible Client',
  internalMemo: 'secret',
  owner: 'internal owner',
  terms: 'visible terms',
  submittedAt: null
});
assert.strictEqual(publicPayload.internalMemo, undefined, 'public contract payload must redact internal memo');
assert.strictEqual(publicPayload.owner, undefined, 'public contract payload must redact internal owner');
assert.strictEqual(publicPayload.clientName, 'Visible Client');
const publicHtml = saveSandbox.renderPublicContract(publicPayload);
assert.match(publicHtml, /public-contract/);
assert.match(publicHtml, /contract-readonly-card/, 'public contract should present a branded read-only contract summary');
assert.doesNotMatch(publicHtml, /id="contract-client-name"/, 'public signer link must not allow editing the client name');
assert.doesNotMatch(publicHtml, /id="contract-type"/, 'public signer link must not allow editing contract type');
assert.doesNotMatch(publicHtml, /id="contract-product-name"/, 'public signer link must not allow editing product details');
assert.doesNotMatch(publicHtml, /id="contract-fee"/, 'public signer link must not allow editing the fee');
assert.match(publicHtml, /contract-public-inputs/, 'public signer link should separate the small set of editable signer fields');
assert.match(publicHtml, /계약 내용을 확인하고 서명해 주세요|계약 내용/, 'public signer link should read like a confirmation and signing page');
assert.doesNotMatch(publicHtml, /contract-internal-memo/);
assert.doesNotMatch(publicHtml, /contract-base-terms/, 'public signer link should not expose base terms as an editable field');
assert.doesNotMatch(publicHtml, /사진\/달 파운드/, 'public signer link should not show photo product wording');
assert.doesNotMatch(publicHtml, /signature-preview/, 'public signer link should not show a redundant saved-signature preview box');
assert.doesNotMatch(publicHtml, /정기결제|선결제 1회차|선결제 6회차|선결제 12회차/, 'public contract should not show old recurring/prepay labels');
assert.doesNotMatch(saveSandbox.renderPublicContract(Object.assign({}, publicPayload, { contractType: 'new' })), /id="contract-renewal-count"/, 'public new contract must not expose renewal-count editing');
assert.doesNotMatch(saveSandbox.renderPublicContract(Object.assign({}, publicPayload, { contractType: 'renewal' })), /id="contract-renewal-count"/, 'public renewal contract must show renewal count as read-only text, not an input');
const submittedPublicHtml = saveSandbox.renderPublicContract(Object.assign({}, publicPayload, {
  submittedAt: 12345,
  signatureDataUrl: 'data:image/png;base64,publicsigned',
  signerName: 'Owner'
}));
assert.match(submittedPublicHtml, /contract-readonly-card/,
  'submitted public contract links must still show the signed contract details');
assert.match(submittedPublicHtml, /contract-signed-preview/,
  'submitted public contract links must show the saved signature');
assert.match(submittedPublicHtml, /data:image\/png;base64,publicsigned/,
  'submitted public contract links must render the stored signature image');

const publicCollectSandbox = Object.assign({}, saveSandbox, {
  document: {
    getElementById(id) {
      const values = {
        'contract-business-number': { value: '222-22-22222' },
        'contract-contact': { value: '010-2222-2222' },
        'contract-email': { value: 'owner@example.com' },
        'contract-signer': { value: 'Owner' },
        'contract-signature': { toDataURL: () => 'data:image/png;base64,publicsigned' }
      };
      return values[id];
    }
  }
});
vm.runInNewContext([
  functionSource('blankContract'),
  functionSource('formValue'),
  functionSource('formValueOr'),
  functionSource('signatureValueFromCanvas'),
  functionSource('collectContractFromForm')
].join('\n'), publicCollectSandbox);
const collectedPublic = publicCollectSandbox.collectContractFromForm({
  id: 'contract_public',
  clientId: 'cl_public',
  clientName: 'Locked Client',
  contractType: 'renewal',
  renewalCount: 4,
  productName: 'Locked Plan',
  fee: '770000',
  startDate: '2026-08-17',
  terms: 'Locked terms'
});
assert.strictEqual(collectedPublic.clientName, 'Locked Client', 'public signature save must preserve locked client name');
assert.strictEqual(collectedPublic.contractType, 'renewal', 'public signature save must preserve locked contract type');
assert.strictEqual(collectedPublic.renewalCount, 4, 'public signature save must preserve locked renewal count');
assert.strictEqual(collectedPublic.productName, 'Locked Plan', 'public signature save must preserve locked product name');
assert.strictEqual(collectedPublic.fee, '770000', 'public signature save must preserve locked fee');
assert.strictEqual(collectedPublic.businessNumber, '222-22-22222');
assert.strictEqual(collectedPublic.signatureDataUrl, 'data:image/png;base64,publicsigned');

const preservedSignatureSandbox = Object.assign({}, saveSandbox, {
  document: {
    getElementById(id) {
      const values = {
        'contract-signer': { value: 'Owner' },
        'contract-signature': {
          dataset: { signatureDirty: '0' },
          toDataURL: () => 'data:image/png;base64,blank-white-canvas'
        }
      };
      return values[id];
    }
  }
});
vm.runInNewContext([
  functionSource('blankContract'),
  functionSource('formValue'),
  functionSource('formValueOr'),
  functionSource('signatureValueFromCanvas'),
  functionSource('collectContractFromForm')
].join('\n'), preservedSignatureSandbox);
const unchangedSignature = preservedSignatureSandbox.collectContractFromForm({
  id: 'contract_public',
  signatureDataUrl: 'data:image/png;base64,existing-signed'
});
assert.strictEqual(unchangedSignature.signatureDataUrl, 'data:image/png;base64,existing-signed',
  'opening a signed original without drawing again must preserve the saved signature');
assert.match(html, /restoreSignatureToCanvas\(document\.getElementById\("contract-signature"\),\s*state\.currentContract\.signatureDataUrl\)/,
  'admin original view must redraw saved signatures into the canvas');
assert.match(html, /restoreSignatureToCanvas\(document\.getElementById\("contract-signature"\),\s*contract\.signatureDataUrl\)/,
  'public contract view must redraw saved signatures into the canvas');

saveSandbox.saveContractFromForm().then(() => {
  const contractWrite = saveSandbox.secureWrites.find((write) => write.key === 'contract:ct_new');
  const clientWrite = saveSandbox.secureWrites.find((write) => write.key === 'client:cl_new');
  assert.ok(contractWrite, 'saving a new contract must write the contract document');
  assert.ok(clientWrite, 'saving a new contract must also create the client');
  assert.strictEqual(contractWrite.value.clientId, 'cl_new');
  assert.strictEqual(contractWrite.value.clientName, 'Client One');
  assert.strictEqual(contractWrite.value.productType, 'custom');
  assert.strictEqual(contractWrite.value.productName, '다각화 플랜');
  assert.strictEqual(contractWrite.value.baseTerms, '');
  assert.strictEqual(contractWrite.value.paymentMethod, 'card');
  assert.strictEqual(contractWrite.value.renewalCount, 3);
  assert.strictEqual(contractWrite.value.signatureDataUrl, 'data:image/png;base64,signed');
  assert.strictEqual(clientWrite.value.name, 'Client One');
  assert.strictEqual(clientWrite.value.contractType, 'renewal');
  assert.strictEqual(saveSandbox.publicWrite.key, 'contracts-index');
  assert.strictEqual(saveSandbox.publicWrite.value[0].id, 'ct_new');
  assert.strictEqual(saveSandbox.state.contracts[0].clientName, 'Client One');
  assert.strictEqual(saveSandbox.state.clients[0].id, 'cl_new');
  console.log('contract management: ok');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
