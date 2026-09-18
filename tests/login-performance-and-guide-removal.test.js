const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const dataApi = fs.readFileSync('api/data.js', 'utf8');

function sourceFor(name) {
  const match = html.match(new RegExp(`(async function ${name}\\([\\s\\S]*?\\n  \\})`));
  assert.ok(match, `${name} must exist`);
  return match[1];
}

async function assertWorkspaceReadsStartTogether() {
  const pending = [];
  const sandbox = {
    workspaceMode: 'staff',
    sessionGeneration: 2,
    state: {},
    app: { innerHTML: '' },
    isCurrentStaffGeneration() { return true; },
    createSessionExpiredError() { return new Error('expired'); },
    getP(key) { return new Promise((resolve) => pending.push({ key, resolve })); },
    getS(key) { return new Promise((resolve) => pending.push({ key, resolve })); },
    setP() { throw new Error('defaults should not be written in this test'); },
    defaultChecklistSets() { return []; },
    render() {},
    restoreVisibleDrafts() {}
  };

  vm.runInNewContext(sourceFor('loadWorkspace'), sandbox);
  const loading = sandbox.loadWorkspace();
  await Promise.resolve();

  assert.deepEqual(
    pending.map((request) => request.key).sort(),
    ['checklist-sets', 'clients-index', 'contract-base-terms-template', 'contracts-index', 'reports-index'].sort(),
    'all independent workspace reads must start in the same event-loop turn'
  );

  pending.forEach(({ key, resolve }) => {
    if (key === 'checklist-sets') resolve([]);
    else if (key === 'contract-base-terms-template') resolve('');
    else resolve([]);
  });
  await loading;
}

async function main() {
  await assertWorkspaceReadsStartTogether();

  assert.doesNotMatch(html, /data-client-tab=["']guide["']|params\.has\(["']guide["']\)/,
    'the dashboard and public router must not expose the information-guide feature');
  assert.doesNotMatch(html, /정보 안내문|업체 정보 안내문|설문 링크 발급/,
    'information-guide labels and issue actions must be absent from the delivered dashboard');
  assert.equal(fs.existsSync('guide.html'), false, 'the legacy public guide entry page must be removed');
  assert.equal(fs.existsSync('api/guide.js'), false, 'the public guide API route must be removed');
  assert.match(dataApi, /RETIRED_GUIDE_OPERATIONS\.has\(body\.operation\)[\s\S]*?status\(410\)/,
    'the generic data API must reject retired information-guide mutations before any storage access');
  const publicReadable = dataApi.match(/function isPublicReadable\(key\) \{[\s\S]*?\n\}/);
  assert.ok(publicReadable, 'the public-read policy must exist');
  assert.doesNotMatch(publicReadable[0], /Guide|guide/,
    'information-guide records must no longer be publicly readable');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
