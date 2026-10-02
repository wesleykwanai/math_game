// Headless runner for the game's built-in selfTest() (the ?test suite).
// Stubs just enough DOM for index.html to boot in Node.
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('no <script> found'); process.exit(1); }

const stubEl = () => ({
  innerHTML: '', textContent: '', className: '', style: {}, disabled: false,
  classList: { add(){}, remove(){}, contains(){return false} },
  appendChild(){}, insertAdjacentHTML(){}, onclick: null,
});
global.document = {
  getElementById: stubEl,
  querySelector: stubEl,
  querySelectorAll: () => [],
  body: stubEl(),
  title: '',
};
global.localStorage = { getItem: () => null, setItem(){}, p4div: 0 };
global.location = { search: '?test', reload(){} };

const t0 = Date.now();
try {
  new Function(m[1])();
  console.log(`OK  selfTest passed in ${Date.now() - t0}ms`);
  console.log('    document.title =', JSON.stringify(document.title));
  process.exit(0);
} catch (e) {
  console.error('FAIL', e.message);
  process.exit(1);
}
