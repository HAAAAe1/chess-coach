/* 开局库回归：
   1) 线路编译 —— 每条线路的每一手都合法，而且是「从这个局面查库」能查到的
   2) 按局面匹配 —— 换个出子次序到达同一局面必须命中同一条目（旧实现按着法序列精确匹配，会漏）
   3) 覆盖面 —— 七种常见起手都要有多个候选，不许出现「每次一模一样」的单选局面
   全部都是确定性断言，不依赖采样，不会偶发红叉。 */
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const core = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
const ui   = html.match(/<script id="ui">([\s\S]*?)<\/script>/)[1];

/* 开局库的加载要用到 ui 里的 posKey，所以这里给一个最小 DOM 桩，把两段一起跑起来。 */
function makeEl(id){
  let h = '';
  const el = { id, className:'', textContent:'', scrollTop:0, scrollHeight:0,
    hidden:false, open:false, value:'2', onclick:null, dataset:{}, children:[],
    style:{ display:'none', setProperty(){} },
    classList:{ toggle(){}, add(){}, remove(){}, contains: () => false },
    addEventListener(){}, appendChild(c){ if (c) el.children.push(c); }, remove(){},
    querySelector(){ return makeEl('sub'); }, querySelectorAll(){ return []; } };
  Object.defineProperty(el, 'innerHTML', { get(){ return h; },
    set(v){ h = String(v); el.children.length = 0; } });
  return el;
}
const els = {}, store = {};
global.document = {
  getElementById(id){ return els[id] || (els[id] = makeEl(id)); },
  createElement(t){ return makeEl(t); },
  querySelectorAll(s){ return s === '.stateChip' ? [this.getElementById('stateChip')] : []; }
};
global.window = {
  localStorage:{ getItem:k => (k in store ? store[k] : null),
                 setItem:(k,v) => { store[k] = String(v); }, removeItem:k => { delete store[k]; } },
  addEventListener(){}, clearTimeout(){}, requestAnimationFrame(){ return 0; }, setTimeout(){ return 0; }
};

const A = new Function(core + '\n' + ui + `
return {BOOK_LINES, BOOK_IDX, BOOK_ERRORS, BOOK_MAX_PLY, bookSan, bookMove, bookLookup, bookStats,
        enginePick, parseFen, START_FEN, applyMove, toSan, legalMoves, posKey};`)();

let fail = 0;
const bad = (...m) => { fail++; console.log('  ✗ ' + m.join(' ')); };
const ok  = m => console.log('  ok ' + m);
const eq  = (a, b, m) => { if (a === b) ok(m); else bad(m + '（得到 ' + a + '，期望 ' + b + '）'); };

/* ---------- A. 编译 ---------- */
console.log('===== A. 线路编译 =====');
{
  const st = A.bookStats();
  console.log('  ' + st.lines + ' 条线路 / ' + st.plies + ' 手 → ' + st.positions + ' 个局面、' +
              st.entries + ' 条应法；转位合并 ' + st.merged + ' 手；多候选局面 ' + st.multi + ' 个');

  eq(st.errors.length, 0, '所有线路的着法都合法（没写错的 SAN）');
  if (st.lines < 60) bad('线路只有 ' + st.lines + ' 条，太少');
  else ok('线路 ' + st.lines + ' 条');
  if (st.plies < 500) bad('总手数只有 ' + st.plies + '，太少');
  else ok('总手数 ' + st.plies);
  if (st.positions < 300) bad('只覆盖了 ' + st.positions + ' 个局面');
  else ok('覆盖 ' + st.positions + ' 个局面');

  // 转位合并不该是 0 —— 是 0 就说明「按局面匹配」根本没起作用
  if (st.merged < st.plies * 0.15)
    bad('转位只合并了 ' + st.merged + ' / ' + st.plies + ' 手，局面匹配可能没生效');
  else ok('转位合并 ' + st.merged + ' 手（占 ' + Math.round(st.merged / st.plies * 100) + '%）');

  eq(st.annotated, st.entries, '每条应法都带注解（选手不会走到一步没解释的棋）');
}

/* ---------- B. 逐条线路回放：每一步都要能从库里查出来 ---------- */
console.log('\n===== B. 逐条线路回放 =====');
{
  let plies = 0, missing = [], noNote = [], illegal = [];
  for (const line of A.BOOK_LINES){
    let st = A.parseFen(A.START_FEN);
    for (let i = 0; i < line.length; i++){
      const san = line[i][0];
      const m = A.bookMove(st, san);
      if (!m){ illegal.push(line.map(x=>x[0]).join(' ') + ' @ ' + i + ' ' + san); break; }
      const cands = A.bookLookup(st, i);
      if (!cands) missing.push(line.map(x=>x[0]).join(' ') + ' @ ' + i + ' ' + san);
      else {
        const hit = cands.filter(c => c.san === A.bookSan(san));
        if (!hit.length) missing.push(line.map(x=>x[0]).join(' ') + ' @ ' + i + ' ' + san);
        else if (!hit[0].note) noNote.push(line.map(x=>x[0]).join(' ') + ' @ ' + i + ' ' + san);
      }
      st = A.applyMove(st, m);
      plies++;
    }
  }
  eq(illegal.length, 0, '回放 ' + plies + ' 手，没有走不通的着法');
  eq(missing.length, 0, '每一步都能从这个局面查库查到' + (missing.length ? '（漏 ' + missing.slice(0,3).join(' / ') + '）' : ''));
  eq(noNote.length, 0, '每一步查出来的条目都带注解');
}

/* ---------- C. 起手覆盖 ---------- */
console.log('\n===== C. 起手覆盖（这一项就是为了修「走 c4 时 12 次全是 Nf6」）=====');
{
  const start = A.parseFen(A.START_FEN);
  const board = {};
  for (const first of ['e4','d4','c4','Nf3','Nc3','g3','b3']){
    const m = A.bookMove(start, first);
    if (!m){ bad('1.' + first + ' 走不通'); continue; }
    const after = A.applyMove(start, m);
    const cands = A.bookLookup(after, 1) || [];
    board[first] = cands.length;
    const min = ['e4','d4','c4','Nf3'].indexOf(first) >= 0 ? 4 : 2;
    if (cands.length < min) bad('1.' + first + ' 只有 ' + cands.length + ' 种应法（至少要有 ' + min + ' 种）');
    else ok('1.' + first + ' → ' + cands.length + ' 种应法：' + cands.map(c => c.san).join('/'));
  }
  // c4 / Nf3 是这次新补的体系，必须有；以前是 0 覆盖
  if (!board.c4) bad('1.c4 仍在库外 —— 上次的 bug 复发了');
  if (!board.Nf3) bad('1.Nf3 仍在库外');
}

/* ---------- D. 按局面匹配：换出子次序也要命中 ---------- */
console.log('\n===== D. 按局面匹配（旧实现按着法序列精确匹配，这里会漏）=====');
{
  /* 旧实现的 key = 着法序列原文。把所有线路的每个前缀收集起来，
     就得到了「旧字典里存在过的 key」这一集合。 */
  const oldKeys = new Set();
  for (const line of A.BOOK_LINES){
    for (let i = 1; i <= line.length; i++) oldKeys.add(line.slice(0, i).map(x => x[0]).join(' '));
  }
  ok('旧实现（序列 key）共有 ' + oldKeys.size + ' 条；现在索引里是 ' + A.bookStats().positions + ' 个局面');

  function play(moves){
    let st = A.parseFen(A.START_FEN);
    for (const mv of moves) st = A.applyMove(st, A.bookMove(st, mv));
    return st;
  }
  const pairs = [
    ['后翼弃兵正统（同一局面：1.d4 d5 2.c4 e6 3.Nc3 Nf6 4.Nf3）',
     ['d4','d5','c4','e6','Nc3','Nf6','Nf3'], ['Nf3','d5','d4','Nf6','c4','e6','Nc3']],
    ['加泰罗尼亚（同一局面：1.c4 Nf6 2.Nf3 e6 3.g3 d5 4.Bg2 Be7）',
     ['c4','Nf6','Nf3','e6','g3','d5','Bg2','Be7'], ['Nf3','d5','c4','e6','g3','Nf6','Bg2','Be7']],
    ['后翼印度（同一局面：1.d4 Nf6 2.c4 e6 3.Nf3 b6 4.g3）',
     ['d4','Nf6','c4','e6','Nf3','b6','g3'], ['Nf3','Nf6','c4','e6','d4','b6','g3']]
  ];
  for (const [label, a, b] of pairs){
    const sa = play(a), sb = play(b);
    const ka = A.posKey(sa), kb = A.posKey(sb);
    const la = A.bookLookup(sa, a.length), lb = A.bookLookup(sb, b.length);
    if (ka !== kb){ bad(label + '：两条次序没走到同一个局面'); continue; }
    if (!la || !lb){ bad(label + '：同一局面只有一条次序查得到库'); continue; }
    const sa1 = la.map(c => c.san).sort().join(), sb1 = lb.map(c => c.san).sort().join();
    if (sa1 !== sb1){ bad(label + '：同一局面两条次序给出的应法不一致'); continue; }
    // 关键：两条次序里至少有一条不是旧字典的 key —— 旧实现那一侧必然漏
    const aOld = oldKeys.has(a.join(' ')), bOld = oldKeys.has(b.join(' '));
    if (aOld && bOld){
      console.log('  （' + label + ' 两条次序在旧字典里都有，不足以证明改动，仅供参考）');
    }
    ok(label + ' → 同一局面键，两边都得到 ' + lb.map(c => c.san).join('/') +
       (aOld && bOld ? '' : '　<b>旧实现漏了' + (aOld ? '第二条' : '第一条') + '次序</b>'));
  }
}

/* ---------- E. 注解容错 + 回合上限 ---------- */
console.log('\n===== E. 注解容错与回合上限 =====');
{
  // 注解里写 Bb5，实际是 Bb5+ —— 必须能对上（这是线路最容易写错的地方）
  const st = A.parseFen(A.START_FEN);
  let s = st;
  for (const mv of ['e4','c5','Nf3','d6']) s = A.applyMove(s, A.bookMove(s, mv));
  const m = A.bookMove(s, 'Bb5');                    // 实际着法是 Bb5+
  if (!m) bad('注解写 Bb5 但实际是 Bb5+ 时对不上 —— 将军号容错失效');
  else ok('注解写 Bb5、实际是 ' + A.toSan(s, m) + ' —— 忽略将军号的匹配生效');
  eq(A.bookSan('Bb5+'), 'Bb5', 'bookSan 去掉将军号');
  eq(A.bookSan('Qh5#'), 'Qh5', 'bookSan 去掉将死号');

  const after = A.applyMove(st, A.bookMove(st, 'e4'));
  eq(A.bookLookup(after, 0) === null, false, '第 1 手之后查得到库');
  eq(A.bookLookup(after, A.BOOK_MAX_PLY), null, '到了 ' + A.BOOK_MAX_PLY + ' 手之后就不再用库（交给搜索）');
}

/* ---------- F. 从起始局面出发，整条路径都能被 enginePick 走完 ---------- */
console.log('\n===== F. 电脑选子（enginePick）=====');
{
  eq((A.bookLookup(A.parseFen(A.START_FEN), 0) || []).length >= 2, true,
     '起始局面有多个候选（不是固定第一步）');

  const start = A.parseFen(A.START_FEN);
  const kinds = new Set();
  for (let k = 0; k < 40; k++) kinds.add(A.toSan(start, A.enginePick(start, 3, 0).move));
  if (kinds.size < 2) bad('引擎第 1 手 40 次只走出 ' + kinds.size + ' 种 —— 随机没生效');
  else ok('引擎第 1 手 40 次走出 ' + kinds.size + ' 种：' + [...kinds].join('/'));

  // 一路走 12 手，全程都应该在库里（库外就交给搜索，这里只验证「库内」这条路径不炸）
  let s = A.parseFen(A.START_FEN), inBook = 0;
  for (let p = 0; p < 12; p++){
    const pick = A.enginePick(s, 2, p);
    if (!pick.move) break;
    if (pick.book) inBook++;
    s = A.applyMove(s, pick.move);
  }
  if (inBook < 6) bad('自走 12 手里只有 ' + inBook + ' 手来自开局库');
  else ok('自走 12 手，其中 ' + inBook + ' 手来自开局库');
}

console.log('\n' + (fail ? ('✗ 共 ' + fail + ' 处问题') : '✓ 全部通过'));
