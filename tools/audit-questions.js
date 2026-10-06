// Exhaustive audit of every question the game can ever generate.
// Enumerates the FULL parameter space of every generator (not random samples)
// and checks the maths, the answer format, and the distractor options.
// Usage: node tools/audit-questions.js [path/to/index.html]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const target = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(target, 'utf8');
const src = html.match(/<script>([\s\S]*?)<\/script>/)[1];
console.log(`auditing: ${target}`);

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
  '\n;({qTwo,qCarry,qBig,qSwap,qCombine,qEstimate,qEstimate3,qWord,qMissing,TYPES,opts,key,makeBank,expect,R,PER,BANK,SEC})',
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
  if (!/^\d+$/.test(q.ans)) bad(`odd answer format: ${q.ans}  <- ${q.text}`);
  if (/NaN/.test(q.text + q.ans + (q.hint || ''))) bad(`NaN in question: ${q.text}`);
  // 估算題答案一定係整十（取最接近嘅十位）
  if (q.approx && +q.ans % 10 !== 0) bad(`estimate answer not a multiple of ten: ${q.text}`);

  // --- the maths: re-derive the answer from the question text ---
  const e = api.expect(q);
  if (e) {
    if (+q.ans !== e[0]) bad(`answer wrong: ${q.text} (ans ${q.ans}, want ${e[0]} via ${e[1]})`);
  } else if (!/\d/.test(q.text)) {
    // Word problems carry their numbers in prose; make sure there is something to check.
    bad(`question has no numbers to check: ${q.text}`);
  }
  if (q.hint && q.ans && new RegExp(`(^|\\D)${q.ans}(\\D|$)`).test(q.hint)) {
    bad(`hint leaks the answer: ${q.text}`);
  }

  // --- options: 4, unique, contains answer, no negative numbers ---
  for (let rep = 0; rep < 40; rep++) {          // opts() is random, so sample repeatedly
    const o = api.opts(q);
    if (o.length !== 4) bad(`option count ${o.length} != 4: ${q.text}`);
    if (new Set(o).size !== 4) bad(`duplicate options ${JSON.stringify(o)}: ${q.text}`);
    if (!o.includes(q.ans)) bad(`answer "${q.ans}" missing from ${JSON.stringify(o)}`);
    for (const opt of o) {
      if (/^-/.test(opt)) bad(`negative option ${opt}: ${q.text}`);
      // 估算題選項全部係整十，先唔會出現「120 vs 121」呢類似是而非嘅選項
      else if (q.approx && +opt % 10 !== 0) bad(`estimate option ${opt} is not a multiple of ten: ${q.text}`);
    }
  }
}

// ---- enumerate the FULL space of each generator ----
// Each generator calls R() a fixed number of times, in a fixed order, so each
// entry in a plan is exactly the sequence of values that generator consumes.
// pick2() spends two R() calls (tens, units); pick3() spends three (h, t, u).
const units = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
const twoDigit = units(11, 99);         // both digits non-zero, as pick2() produces
const threeDigit = units(100, 999);     // as pick3() produces
const carryB = units(3, 9);             // qCarry multiplier
const carryDigit = units(1, 9);         // qCarry tens and units digits
const swapNums = units(11, 39);
const swapB = units(3, 9);
const combR = [15, 25, 35, 45];         // qCombine leading factor
const missA = units(2, 9);              // qMissing hidden factor
const twoPlan = (n) => [Math.floor(n / 10), n % 10];
const threePlan = (n) => [Math.floor(n / 100), Math.floor(n / 10) % 10, n % 10];

// Two-digit factors: every (a, b) pair, handing each generator the exact digit
// sequence pick2() would have drawn.
function* twoByTwo() {
  for (const a of twoDigit) for (const b of twoDigit) yield [...twoPlan(a), ...twoPlan(b)];
}

const spec = {
  qTwo:       twoByTwo(),
  qCarry:     (function* () { for (const b of carryB) for (const u of carryDigit) for (const t of carryDigit) yield [b, u, t]; })(),
  qBig:       (function* () { for (const a of threeDigit) for (const b of twoDigit) yield [...threePlan(a), ...twoPlan(b)]; })(),
  qSwap:      (function* () { for (const a of swapNums) for (const b of swapB) yield [a, b]; })(),
  qCombine:   (function* () { for (let ri = 0; ri < combR.length; ri++) for (const m of twoDigit) yield [ri, ...twoPlan(m)]; })(),
  qEstimate:  twoByTwo(),
  qEstimate3: twoByTwo(),
  qWord:      (function* () { for (const a of twoDigit) for (const b of twoDigit) for (const k of units(0, 3)) yield [...twoPlan(a), ...twoPlan(b), k]; })(),
  qMissing:   (function* () { for (const a of missA) for (const b of twoDigit) yield [...twoPlan(b), a]; })(),
};

const declared = api.TYPES.map((f) => f.name);
for (const name of declared) {
  const gen = spec[name];
  if (!gen) { bad(`audit does not know type: ${name}`); continue; }
  const before = seen.size;
  for (const plan of gen) audit(withR(plan, api[name]));
  console.log(`  ${name.padEnd(10)} distinct questions: ${seen.size - before}`);
}
if (declared.join() !== Object.keys(spec).join()) {
  bad(`audit covers [${Object.keys(spec)}] but the game has [${declared}]`);
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

// The intro screen advertises a question-pool size; keep it honest.
const shown = html.match(/總共有 <b>(\d+)<\/b>/);
if (!shown) {
  bad('could not find the advertised question-pool count in index.html');
} else if (+shown[1] !== seen.size) {
  bad(`intro screen says ${shown[1]} questions but the game generates ${seen.size}`);
} else {
  console.log(`  intro screen pool count (${shown[1]}) matches reality`);
}

console.log('');
if (problems.length) {
  console.log(`FAIL — ${problems.length} problem(s):`);
  [...new Set(problems)].slice(0, 30).forEach((p) => console.log('  - ' + p));
  process.exit(1);
} else {
  console.log('PASS — every possible question is mathematically correct');
}