'use strict';

// Guards the client-side latency behaviour that keeps the loading overlay honest:
// a request always has a deadline, a stalled response body cannot hang the UI
// forever, writes are never silently replayed, and a user action never sits in
// the queue behind a background refresh.

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const CR = String.fromCharCode(13);
const app = fs.readFileSync('frontend/app.js', 'utf8').split(CR).join('');
const docsApp = fs.readFileSync('docs/app.js', 'utf8').split(CR).join('');
assert.strictEqual(app, docsApp, 'docs/app.js must mirror frontend/app.js');

// --- Structural invariants -------------------------------------------------

// The body has to be read before the deadline is cancelled. Cancelling on the
// response headers alone leaves a stalled body with no timeout at all.
const bodyRead = app.indexOf('const text = await response.text();');
const cancelAfterBody = app.indexOf('cancelTimeout();', bodyRead);
assert(bodyRead > 0, 'apiCallOnce must read the response body as text');
assert(cancelAfterBody === bodyRead + 'const text = await response.text();\n    '.length,
  'cancelTimeout() must come immediately after the body is read, not before');

assert(app.includes('const apiGate = { active: 0, high: [], normal: [] };'), 'API gate must have two lanes');
assert(app.includes('const next = apiGate.high.shift() || apiGate.normal.shift();'), 'high lane must drain first');
assert(app.includes('const API_MAX_TIMEOUT_ATTEMPTS = 2;'), 'timeouts need their own short retry ladder');
assert(/loadFindings\(force = false, quiet = false\)/.test(app), 'loadFindings needs a quiet mode for post-write refresh');
assert(app.includes('function refreshAfterFindingWrite()'), 'finding writes must reconcile outside the overlay');
assert(!/await loadFindings\(true\);\s*await loadDashboard/.test(app),
  'a finding write must not hold the overlay through list + dashboard reloads');

// --- Behavioural checks ----------------------------------------------------

function slice(from, to) {
  const a = app.indexOf(from), b = app.indexOf(to, a);
  assert(a >= 0 && b > a, 'could not slice ' + from);
  return app.slice(a, b);
}

const hints = [];
const sandbox = {
  console: { warn() {} }, setTimeout, clearTimeout, module: { exports: {} },
  CONFIG: { API_URL: 'https://example.invalid/exec' },
  state: { token: 't' },
  setLoadingHint: text => hints.push(text),
  isTokenError: () => false,
  translateApiMessage: message => message,
  logout() {}, showToast() {},
  // Stands in for the real Web Worker timer so the deadline fires in 50ms
  // instead of 45s — the logic under test is identical.
  makeWorkerTimeout() {
    let reject;
    const promise = new Promise((_, rej) => { reject = rej; });
    const id = setTimeout(() => reject(new Error('__timeout__')), 50);
    return { promise, cancel: () => clearTimeout(id) };
  },
  fetch: null
};
vm.createContext(sandbox);
vm.runInContext([
  slice('const RETRYABLE_HTTP_STATUS', 'async function apiCall(action'),
  slice('async function apiCall(action', 'async function apiCallOnce'),
  slice('async function apiCallOnce', 'async function apiBatch'),
  'module.exports = { apiCall, apiGate, apiGateBusy, acquireApiSlot, releaseApiSlot };'
].join('\n'), sandbox);
const api = sandbox.module.exports;

const ok = data => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, data }) });
const refused = status => ({ ok: false, status, text: async () => '' });
const stalledBody = () => ({ ok: true, status: 200, text: () => new Promise(() => {}) });

(async () => {
  // Headers arrive, the body never does: must reject, not hang the overlay.
  sandbox.fetch = async () => stalledBody();
  let rejected = null;
  await api.apiCall('getFindings', {}, { quiet: true }).catch(error => { rejected = error; });
  assert(rejected, 'a stalled response body must reject rather than hang forever');
  assert(/ใช้เวลานานเกินไป/.test(rejected.message), 'expected a timeout error, got: ' + rejected.message);
  assert.strictEqual(api.apiGate.active, 0, 'the gate slot must be released after a timeout');

  // A write may already have landed server-side, so it is never auto-replayed.
  let calls = 0;
  sandbox.fetch = async () => { calls++; return stalledBody(); };
  await api.apiCall('verifyFinding', {}, { quiet: true }).catch(() => {});
  assert.strictEqual(calls, 1, 'a write was replayed after a timeout (' + calls + ' attempts)');

  // A refused read is replayed, and the overlay says so instead of sitting mute.
  calls = 0;
  sandbox.fetch = async () => (++calls < 3 ? refused(404) : ok({ findings: [1] }));
  assert.deepEqual(await api.apiCall('getFindings', {}), { findings: [1] });
  assert.strictEqual(calls, 3, 'a refused read should be replayed');
  assert(hints.some(h => /ลองใหม่ครั้งที่ 2/.test(h)), 'retry progress was not surfaced: ' + JSON.stringify(hints));

  // The edge sometimes serves an interstitial instead of the script's JSON.
  calls = 0;
  sandbox.fetch = async () => (++calls < 2
    ? { ok: true, status: 200, text: async () => '<html>interstitial</html>' }
    : ok({ v: 1 }));
  assert.deepEqual(await api.apiCall('getDashboard', {}, { quiet: true }), { v: 1 });
  assert.strictEqual(calls, 2, 'a non-JSON body should be replayed for a read');

  // A user action must overtake background reads already waiting in the queue.
  const served = [];
  await api.acquireApiSlot('normal');
  await api.acquireApiSlot('normal');
  assert(api.apiGateBusy(), 'the gate should report itself saturated');
  api.acquireApiSlot('normal').then(() => served.push('background-1'));
  api.acquireApiSlot('normal').then(() => served.push('background-2'));
  api.acquireApiSlot('high').then(() => served.push('user-write'));
  api.releaseApiSlot();
  api.releaseApiSlot();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(served, ['user-write', 'background-1'], 'high lane must be served first, got ' + served);
  api.releaseApiSlot(); api.releaseApiSlot(); api.releaseApiSlot();
  assert.strictEqual(api.apiGate.active, 0, 'gate slots leaked: active=' + api.apiGate.active);

  console.log('API latency guard tests passed.');
})().catch(error => { console.error(error.stack); process.exit(1); });
