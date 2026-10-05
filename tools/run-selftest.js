// Headless runner for the game's built-in selfTest() (the ?test suite).
// Stubs just enough DOM for index.html to boot, then runs the page script in a
// Node vm context (no eval / dynamic Function).
const fs = require('fs');
const vm = require('vm');

const file = process.argv[2];
const html = fs.readFileSync(file, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('no <script> found'); process.exit(1); }

const stubEl = () => ({
  innerHTML: '', textContent: '', className: '', style: {}, disabled: false,
  classList: { add() {}, remove() {}, contains() { return false } },
  appendChild() {}, prepend() {}, insertAdjacentHTML() {}, onclick: null,
});

const sandbox = {
  document: {
    getElementById: stubEl,
    querySelector: stubEl,
    querySelectorAll: () => [],
    body: stubEl(),
    title: '',
    createElement: stubEl,
    createTextNode: stubEl,
  },
  localStorage: { getItem: () => null, setItem() {}, p4div: 0 },
  location: { search: '?test', reload() {} },
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
};
vm.createContext(sandbox);

const t0 = Date.now();
try {
  vm.runInContext(m[1], sandbox);
  console.log(`OK  selfTest passed in ${Date.now() - t0}ms  (${file})`);
  console.log('    document.title =', JSON.stringify(sandbox.document.title));
  process.exit(0);
} catch (e) {
  console.error('FAIL', e.message);
  process.exit(1);
}