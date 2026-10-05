// Exhaustive audit of every question the game can ever generate.
// Enumerates the FULL parameter space of all 5 generators (not random samples)
// and checks the maths, the answer format, and the distractor options.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// ---- DOM stub so the game script runs ----
const stubEl = () => ({
  innerHTML: '', textContent: '', className: '', style: {}, disabled: false,
  classList: { add() {}, remove() {}, contains() { return false } },
  appendChild() {}, insertAdjacentHTML() {}, onclick: null,
});
const documentStub = {
  getElementById: stubEl, querySelector: stubEl,
  querySelectorAll: () => [], body: stubEl(), title: '',
};

// Expose the game internals for inspection.
// R is a const inside the game's own script scope, so redirect it to a
// controllable sandbox global, then evaluate the script in a vm context
// (no eval / dynamic Function).
const patched = src.replace(
  /const R=\(a,b\)=>a\+Math\.floor\(Math\.random\(\)\*\(b-a\+1\)\);/,
  'const R=(a,b)=>globalThis.__R(a,b);'
);
if (!/globalThis.__R/.test(patched)) throw new Error('failed to patch R');

const realR = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const sandbox = {
  document: documentStub,
  localStorage: { getItem: () => null, setItem() {} },
  location: { search: '', reload() {} },
  console,
  __R: () => { throw new Error('R() called before enumeration stub was installed'); },
};
vm.createContext(sandbox);
const api = vm.runInContext(
  patched +
  '\n;({qRound,qExact,qRemain,qBar,qBack,qTwo,qBig,qBigRemain,qInvBig,qEstimate,TYPES,opts,key,makeBank,R,PER,BANK,SEC})',
  sandbox
);

// Feed each generator exactly the values it asks for, in call order.
const withR = (plan, fn) => {
  let i = 0;
  sandbox.__R = () => plan[i++];
  try { return fn(); } finally { sandbox.__R = realR; }
};

const problems = [];
const bad = (m) => problems.push(m);
const seen = new Set();          // every distinct question, to spot duplicates/clashes
let checked = 0;

function audit(q) {
  checked++;
  const k = api.key(q);
  if (seen.has(k)) bad(`DUPLICATE question text: ${q.text}`);
  seen.add(k);

  // --- answer format ---
  const rm = q.ans.match(/^商(\d+) 餘(\d+)$/);
  if (!rm && !/^\d+$/.test(q.ans)) bad(`odd answer format: ${q.ans}  <- ${q.text}`);
  if (q.ans === 'NaN' || q.ans.includes('NaN')) bad(`NaN in answer: ${q.text}`);

  // --- the actual division ---
  const d = q.text.match(/(\d+) ÷ (\d+)/);
  if (d) {
    const a = +d[1], b = +d[2];
    if (!(b > 0 && a > 0)) bad(`non-positive operand: ${q.text}`);
    if (rm) {
      const [n, r] = [+rm[1], +rm[2]];
      if (r >= b) bad(`remainder NOT < divisor (${r} >= ${b}): ${q.text}`);
      if (b * n + r !== a) bad(`quotient/remainder wrong: ${q.text} (${b}*${n}+${r}=${b*n+r} != ${a})`);
      if (n < 1) bad(`quotient should be >= 1: ${q.text}`);
    } else if (q.approx) {
      // estimation question: answer must be the nearest ten to a/b
      const want = String(Math.round(a / b / 10) * 10);
      if (q.ans !== want) bad(`estimate wrong: ${q.text} (ans ${q.ans}, want ${want})`);
      if (+q.ans % 10 !== 0) bad(`estimate not a multiple of ten: ${q.text}`);
      if (q.step !== 10) bad(`estimate must declare step:10: ${q.text}`);
      if (q.hint && q.ans && new RegExp(`(^|\\D)${q.ans}(\\D|$)`).test(q.hint)) {
        bad(`hint leaks the answer: ${q.text}`);
      }
    } else {
      const n = +q.ans;
      if (a % b !== 0) bad(`not evenly divisible but answer is a bare number: ${q.text}`);
      if (a / b !== n) bad(`division wrong: ${q.text} (${a}/${b}=${a/b} != ${n})`);
    }
  }

  // --- options: 4, unique, contains answer, no negative numbers ---
  for (let rep = 0; rep < 40; rep++) {          // opts() is random, so sample repeatedly
    const o = api.opts(q);
    if (o.length !== 4) bad(`option count ${o.length} != 4: ${q.text}`);
    if (new Set(o).size !== 4) bad(`duplicate options ${JSON.stringify(o)}: ${q.text}`);
    if (!o.includes(q.ans)) bad(`answer "${q.ans}" missing from ${JSON.stringify(o)}`);
    for (const opt of o) {
      if (/商(\d+) 餘(\d+)/.test(opt)) {
        const m2 = opt.match(/^商(\d+) 餘(\d+)$/);
        const b = d ? +d[2] : 9;
        if (+m2[2] >= b) bad(`option teaches WRONG maths (remainder ${m2[2]} >= ${b}): ${opt}`);
        if (+m2[1] < 1) bad(`option has quotient 0: ${opt}`);
      } else if (/^-/.test(opt)) {
        bad(`negative option ${opt}: ${q.text}`);
      } else if (q.step) {
        if (+opt % q.step !== 0) bad(`option ${opt} breaks step:${q.step}: ${q.text}`);
      }
    }
  }
}

// ---- enumerate the FULL space of each generator ----
// Each generator calls R() a fixed number of times, in a fixed order.
// Quotient ranges mirror the game exactly; qTwo/qBig derive their range from
// the divisor, so they get a per-divisor function rather than a fixed pair.
const divisors = [10, 20, 30, 40, 50];   // qRound's fixed divisor list
const range = (lo, hi) => (lo > hi ? [] : Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));

const spec = {
  // bs = divisor range (mirrors the game exactly), q = quotient range,
  // rem = remainder range [lo, hiIgnored] meaning lo..b-1
  qRound:     { bs: divisors, q: () => range(2, 9),  rem: null, divIdx: true },
  qExact:     { bs: range(2, 9), q: () => range(2, 9),   rem: null },
  qRemain:    { bs: range(3, 9), q: () => range(3, 10),  rem: [1, null] },
  qBar:       { bs: range(3, 9), q: () => range(2, 9),   rem: null },
  qBack:      { bs: range(2, 9), q: () => range(3, 12),  rem: null },
  qTwo:       { bs: range(3, 9), q: (b) => range(11, Math.floor(99 / b)), rem: null },
  qBig:       { bs: range(2, 9), q: (b) => range(Math.ceil(120 / b), Math.floor(999 / b)), rem: null },
  qBigRemain: { bs: range(3, 9), q: () => range(11, 40),  rem: [1, null] },
  qInvBig:    { bs: range(11, 29), q: () => range(11, 29), rem: null },
  qEstimate:  { bs: range(3, 9), q: () => range(12, 49),  rem: [0, null] },  // may divide exactly
};

for (const name of api.TYPES.map((f) => f.name)) {
  const s = spec[name];
  if (!s) { bad(`audit does not know type: ${name}`); continue; }
  const before = seen.size;

  for (const b of s.bs) {
    for (const q of s.q(b)) {
      if (s.rem) {
        // R called for b, then q, then r
        for (let r = s.rem[0]; r <= b - 1; r++) audit(withR([b, q, r], api[name]));
      } else if (s.divIdx) {
        // qRound: first R(0,4) picks the divisor index, then R(2,9) the quotient
        audit(withR([s.bs.indexOf(b), q], api[name]));
      } else {
        audit(withR([b, q], api[name]));
      }
    }
  }
  console.log(`  ${name.padEnd(10)} distinct questions: ${seen.size - before}`);
}

// ---- bank integrity: 10 first, then +10 must reach exactly 20, all unique ----
for (let t = 0; t < 200; t++) {
  const bank = api.makeBank(api.BANK);
  if (bank.length !== api.BANK) bad(`bank size ${bank.length} != ${api.BANK}`);
  if (new Set(bank.map(api.key)).size !== api.BANK) bad('bank contains duplicates');
}
console.log(`\n  distinct questions in whole game: ${seen.size}`);
console.log(`  questions checked (incl. 40 option samples each): ${checked}`);
console.log(`  bank built 200x with no duplicate/size errors`);

console.log('');
if (problems.length) {
  console.log(`FAIL — ${problems.length} problem(s):`);
  [...new Set(problems)].slice(0, 30).forEach((p) => console.log('  - ' + p));
  process.exit(1);
} else {
  console.log('PASS — every possible question is mathematically correct');
}