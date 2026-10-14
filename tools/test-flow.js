// Plays a full game headlessly against a minimal fake DOM.
// Verifies the DOM-building rewrite of drawDots() and end(): the results page
// must contain the grade, score, wrong-question list and the right buttons.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const target = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(target, 'utf8');
const src = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// ---- minimal fake DOM ----
const reg = {};
// Faithful stand-ins: HTMLCollection has NO forEach (only indexed access,
// length, item() and iteration). NodeList DOES have forEach. Distinguishing the
// two is what lets this suite catch answer()'s disable loop regression.
const mkCollection = (arr) => {
  const c = {
    length: arr.length,
    item: (i) => arr[i],
    [Symbol.iterator]: function* () { for (let i = 0; i < arr.length; i++) yield arr[i]; },
  };
  for (let i = 0; i < arr.length; i++) c[i] = arr[i];
  return c;
};
const mkNodeList = (arr) => Object.assign(mkCollection(arr), {
  forEach: Array.prototype.forEach,
});

const mkNode = (tag) => {
  const n = {
    tag, id: '', className: '', disabled: false, onclick: null,
    style: {}, _text: '', _children: [], classes: new Set(),
    classList: {
      add(c) { n.classes.add(c); },
      remove(c) { n.classes.delete(c); },
      contains(c) { return n.classes.has(c); },
    },
    appendChild(c) { n._children.push(c); if (c && c.id) reg[c.id] = c; return c; },
    prepend(c) { n._children.unshift(c); return c; },
    set textContent(v) { n._text = String(v); n._children = []; },
    get textContent() { return n._text + n._children.map((c) => c.textContent).join(''); },
    get innerText() { return n.textContent; },
  };
  Object.defineProperty(n, 'children', { get: () => mkCollection(n._children) });
  return n;
};

const body = mkNode('body');
const document = {
  title: '',
  body,
  createElement: (t) => mkNode(t),
  createTextNode: (s) => { const t = mkNode('#text'); t.textContent = s; return t; },
  getElementById: (id) => reg[id] || null,
  querySelector: (sel) => {
    if (sel === '#time i') return timeBar;
    if (sel === '#opts') return reg.opts;
    return null;
  },
  querySelectorAll: (sel) => {
    if (sel === '#bar span') return mkNodeList(reg.bar._children);
    if (sel === '#opts button') return mkNodeList(reg.opts._children);
    return mkNodeList([]);
  },
};

// Register the static elements the game expects to exist.
for (const id of ['app', 'start', 'play', 'over', 'bar', 'tot', 'num', 'ok', 'combo', 'qtext', 'hint', 'pop', 'opts']) {
  reg[id] = mkNode('div');
  reg[id].id = id;
}
const timeBar = mkNode('i');

const store = {};
const localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  get p4div() { return store.p4div; },
  set p4div(v) { store.p4div = String(v); },
};

// Timers: run callbacks synchronously so a whole game completes in one tick.
const timers = new Set();
let timerId = 0;
const setTimeout_ = (fn) => { fn(); return ++timerId; };
const setInterval_ = () => ++timerId;
const clearInterval_ = (id) => { timers.delete(id); };

const sandbox = {
  document, localStorage, console,
  location: { search: '', reload() {} },
  setTimeout: setTimeout_, clearTimeout: setTimeout_,
  setInterval: setInterval_, clearInterval: clearInterval_,
  Math, JSON, Set, Object, Array, String, Number, parseInt, parseFloat,
};
vm.createContext(sandbox);
const api = vm.runInContext(
  src + '\n;({startGame,getS:()=>S,answer,more,opts,grade,PER,BANK})',
  sandbox
);

// ---- assertions ----
const fails = [];
const A = (c, m) => { if (!c) fails.push(m); };

function answerCurrent(correct) {
  const S = api.getS();
  const q = S.q[S.i];
  const optsBox = [...reg.opts.children];
  if (optsBox.length !== 4) fails.push(`expected 4 options, got ${optsBox.length}`);
  const pick = correct ? q.ans : '__wrong__';
  const btn = optsBox.find((b) => b.textContent === pick) || null;
  api.answer(pick, btn, q);
}

// --- round 1: 6 correct, 4 wrong ---
api.startGame();
A(reg.tot.textContent === '10', `tot should be 10, got ${reg.tot.textContent}`);
A(reg.bar.children.length === 10, `bar should have 10 dots, got ${reg.bar.children.length}`);
A(reg.num.textContent === '1', `num should be 1, got ${reg.num.textContent}`);
A(reg.opts.children.length === 4, `should render 4 option buttons`);
A(reg.qtext.textContent.length > 0, 'question text should be rendered');

for (let i = 0; i < 6; i++) answerCurrent(true);
for (let i = 0; i < 4; i++) answerCurrent(false);

// end() should have run and built the results page from DOM nodes
const over = reg.over;
const overText = over.textContent;
A(overText.includes('等第'), `results missing grade: ${overText.slice(0, 120)}`);
A(overText.includes('6/10'), `results missing score 6/10: ${overText.slice(0, 160)}`);
A(overText.includes('答對 6 題，答錯 4 題'), 'results missing correct/wrong counts');
A(overText.includes('要溫習嘅題目（4 題）'), 'results missing wrong-question count');
A(overText.includes('✅ 答案：'), 'results missing answers to review');
A(store.p4div === '60', `best score should be 60, got ${store.p4div}`);

const wrongBox = [...over.children].find((c) => c.id === 'wrong');
A(!!wrongBox, 'expected a #wrong review block');
if (wrongBox) {
  // block = [bold heading, row, row, row, row]
  A(wrongBox.children.length === 5, `#wrong should hold 4 rows + heading, got ${wrongBox.children.length}`);
}
const mark = [...over.children].find((c) => c.id === 'mark');
A(!!mark && mark.textContent === '6/10', `expected #mark = 6/10`);

const buttons = [...over.children].filter((c) => c.tag === 'button');
A(buttons.length === 2, `round 1 should offer 2 buttons (again + more), got ${buttons.length}`);
A(buttons.some((b) => b.textContent.includes('再考一次')), 'missing 再考一次 button');
const moreBtn = buttons.find((b) => b.textContent.includes('加考'));
A(!!moreBtn, 'missing 加考 button');
A(!!(moreBtn && typeof moreBtn.onclick === 'function'), '加考 button has no click handler');

// --- round 2: press 加考, answer the rest correctly ---
if (moreBtn) moreBtn.onclick();
const S2 = api.getS();
A(S2.done === 20, `after 加考 done should be 20, got ${S2.done}`);
A(reg.tot.textContent === '20', `tot should be 20, got ${reg.tot.textContent}`);
A(reg.bar.children.length === 20, `bar should have 20 dots, got ${reg.bar.children.length}`);
while (api.getS().i < api.getS().done) answerCurrent(true);

const over2 = reg.over;
A(over2.textContent.includes('16/20'), `final score should be 16/20: ${over2.textContent.slice(0, 160)}`);
A(store.p4div === '80', `best score should update to 80, got ${store.p4div}`);
const buttons2 = [...over2.children].filter((c) => c.tag === 'button');
A(buttons2.length === 1, `at 20/20 the 加考 button must be gone, got ${buttons2.length}`);

// --- a perfect round shows the all-correct message ---
// 再考一次 does location.reload() in the browser, so start a genuinely new game
store.p4div = '0';
api.startGame();
while (api.getS().i < api.getS().done) answerCurrent(true);
A(reg.over.textContent.includes('全部答對'), 'perfect game should show 💯 message');
A(store.p4div === '100', `perfect game should record 100, got ${store.p4div}`);

console.log(`  round 1: 10 questions -> results page built from DOM nodes OK`);
console.log(`  round 2: 加考 to 20 -> tot/bar/counts updated OK`);
console.log(`  perfect round -> all-correct message OK`);
console.log(`  best score tracking: 60 -> 80 OK`);

// --- static guard: HTMLCollection has no Array methods ---
// `el.children.forEach(...)` throws where HTMLCollection is not array-like.
// Spread it first: [...el.children].
const badColl = src.match(/\.children\.(forEach|map|filter|find|reduce|some|every)\s*\(/);
if (badColl) {
  const line = src.slice(0, badColl.index).split('\n').length;
  fails.push(`index.html:${line} calls .${badColl[1]}() on .children (HTMLCollection) — spread it: [...el.children].${badColl[1]}()`);
}

if (fails.length) {
  console.log(`\nFAIL — ${fails.length} problem(s) in ${target}:`);
  [...new Set(fails)].forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log(`\nPASS — full game flow renders correctly (${target})`);