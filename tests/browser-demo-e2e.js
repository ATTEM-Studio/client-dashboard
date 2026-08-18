const assert = require('assert');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const baseUrl = process.env.DEMO_BASE_URL || 'http://127.0.0.1:8765/';
  const tabs = await fetch('http://127.0.0.1:9222/json').then((res) => res.json());
  const tab = tabs.find((item) => item.type === 'page');
  assert.ok(tab, 'Edge debugging page must exist');
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  const requests = [];
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    if (message.id && pending.has(message.id)) {
      const pair = pending.get(message.id); pending.delete(message.id);
      if (message.error) pair.reject(new Error(message.error.message)); else pair.resolve(message.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };

  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: baseUrl });
  await sleep(1000);
  assert.strictEqual(await evaluate("!!document.getElementById('btn-enter-demo')"), true, 'demo entry must render');
  await evaluate("document.getElementById('btn-enter-demo').click()");
  await sleep(900);
  const dashboard = await evaluate("({demo:document.body.innerText.includes('DEMO'),clients:document.querySelectorAll('.client-card').length,overflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth})");
  assert.strictEqual(dashboard.demo, true, 'demo badge must render');
  assert.strictEqual(dashboard.clients, 3, 'three demo clients must render');
  assert.strictEqual(dashboard.overflow, true, '390px demo dashboard must not overflow horizontally');

  await evaluate("document.getElementById('btn-dashboard-menu').click();document.getElementById('btn-menu-tools').click()");
  await sleep(500);
  await evaluate("document.getElementById('naver-keywords').value='강남맛집';document.getElementById('btn-naver-search').click()");
  await sleep(700);
  const analyzer = await evaluate("({sample:document.body.innerText.includes('실제 네이버 수치가 아닙니다'),result:document.getElementById('naver-result').innerText})");
  assert.strictEqual(analyzer.sample, true, 'demo analyzer must identify sample data');
  assert.match(analyzer.result, /강남맛집/, 'demo analyzer must render the prepared keyword');
  assert.strictEqual(requests.some((url) => /\/api\/naver-(keyword|datalab)/.test(url)), false, 'demo analyzer must not call Naver proxy APIs');

  await evaluate("document.getElementById('btn-tool-back').click();document.getElementById('btn-dashboard-menu').click();document.getElementById('btn-menu-staff-login').click()");
  await sleep(300);
  assert.strictEqual(await evaluate("!!document.getElementById('login-pw')"), true, 'staff switch must return to password login');
  socket.close();
  console.log('browser demo e2e: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
