const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const core = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
const ui = html.match(/<script id="ui">([\s\S]*?)<\/script>/)[1];

/* ---------- 极简 DOM 桩 ---------- */
const feed = [];
function El(id){
  let _html = '';
  const el = {
    id, className: '', textContent: '', scrollTop: 0, scrollHeight: 0,
    hidden: false, open: false, value: '2',
    dataset: {}, children: [], style: { display: 'none', setProperty(){} },
    classList: { toggle(){}, add(){}, remove(){} },
    addEventListener(){},
    appendChild(c){ if (c) el.children.push(c); if (el.id === 'feed') feed.push(c ? c.innerHTML : ''); },
    remove(){},
    querySelector(){ return El('sub'); },
    querySelectorAll(){ return []; }
  };
  // 真 DOM 里 innerHTML 赋值会清空子节点，桩必须照做 ——
  // 否则 boardEl.children 会留下上一轮的 undefined，64 格重建时炸掉
  Object.defineProperty(el, 'innerHTML', {
    get(){ return _html; },
    set(v){ _html = String(v); el.children.length = 0; }
  });
  return el;
}
const els = {};
const document = {
  getElementById(id){ return els[id] || (els[id] = El(id)); },
  createElement(tag){ return El(tag); },
  querySelectorAll(){ return []; }
};
const timers = [];
const window = {
  addEventListener(){},
  setTimeout(fn){ timers.push(fn); return timers.length; }
};
function drain(){ let i = 0; while (timers.length && i++ < 400) timers.shift()(); }

const api = new Function('document', 'window', core + '\n' + ui + `
return {S: () => S, humanMove, engineTurn, analyze, explainMove, toSan, cnSan, moveFromSan,
        legalMoves, parseFen, applyMove, analyzeForHuman, newGame, doHint, undoPlay,
        setMode, loadPuzzle, loadLesson, lessonGoto, puzzleMove, loadRule, ruleShow, rulePlay,
        PZ: () => PZ, LS: () => LS, RI: () => RI, MODE: () => MODE,
        TACTICS, MATES, LESSONS, RULES, hangingLoss, hangingMap, pvLine, pvText,
        encM, inCheck, sameMove, fmtPawn, sqName};`)(document, window);

const S = () => api.S();
const clean = s => String(s).replace(/<br\s*\/?>/g, ' | ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const sfx = idx => clean(feed[idx]);
let problems = 0;
const bad = m => { problems++; console.log('  ✗ ' + m); };
const ok  = m => console.log('  ok ' + m);

console.log('===== A. 开局：体检栏 + 第一条解说 =====');
api.newGame('w');
drain();
console.log('[体检]\n' + clean(els.audit.innerHTML));
console.log('[面板元信息] ' + clean(els.panelMeta.innerHTML));
console.log('[提示] ' + sfx(0));

function play(san){
  const st = S().st;
  const m = api.legalMoves(st, st.turn).find(x => api.toSan(st, x) === san);
  if (!m) { console.log('!! 无法走 ' + san); return false; }
  feed.length = 0;
  api.humanMove(m);
  drain();
  return true;
}

function show(title, n){
  console.log('\n----- ' + title + ' -----');
  const from = Math.max(0, feed.length - (n || feed.length));
  for (let i = from; i < feed.length; i++) console.log('· ' + sfx(i));
  console.log('[体检] ' + clean(els.audit.innerHTML));
}

console.log('\n===== B. 三步正常开局（看解说是否具体） =====');
play('e4'); show('1.e4');
play('Nf3'); show('2.Nf3');
play('Bc4'); show('3.Bc4');

console.log('\n===== C. 故意走坏：送子 =====');
if (play('d3')) show('4.d3');

console.log('\n===== D. 走一个「攻击对方但自己站不住」的棋 =====');
{
  const st2 = api.parseFen('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4');
  S().st = st2; S().seq = ['e4','e5','Nf3','Nc6','Bc4']; S().analysis = null;
  const m = api.legalMoves(st2, 'w').find(x => api.toSan(st2, x) === 'Bxf7+');
  feed.length = 0;
  api.humanMove(m);
  drain();
  show('Bxf7+ 之后');
}

console.log('\n===== E. 玩家把子送到马口上（严重失误判定）=====');
{
  const st3 = api.parseFen('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 1 2');
  S().st = st3; S().seq = ['e4','e5']; S().analysis = null; S().moves = []; S().captured = {w:[],b:[]};
  const m = api.legalMoves(st3, 'w').find(x => api.toSan(st3, x) === 'Ng5');
  api.analyzeForHuman();
  feed.length = 0;
  api.humanMove(m);
  drain();
  show('2.Ng5（正常出子）');
}

console.log('\n===== F. 「给我提示」（对弈模式）=====');
{
  feed.length = 0;
  api.doHint();
  show('点「给我提示」');
  const t = feed.join(' ');
  const EN = clean(t).match(/[KQRBN]|O-O/g);
  if (EN) bad('提示里出现了棋子代号：' + Array.from(new Set(EN)).join(','));
  else ok('提示里没有棋子代号');
}

console.log('\n===== G. 悔棋 =====');
{
  const before = S().moves.length;
  api.undoPlay();
  drain();
  console.log('悔棋前 ' + before + ' 手 → 现在 ' + S().moves.length + ' 手，轮到 ' + S().st.turn);
  show('悔棋后');
}

console.log('\n===== H. 模板套话残留检查 =====');
{
  const whole = feed.join('') + els.audit.innerHTML;
  const banned = ['落点安全，对方一时半会儿动不了它', '保持子力协调', '残局阶段：把王走上来'];
  const hit = banned.filter(b => whole.indexOf(b) >= 0);
  console.log(hit.length ? '!! 仍有套话：' + hit.join(' / ') : '没有发现旧模板套话');
}

console.log('\n===== I. 主变（PV）必须是合法着法序列 =====');
{
  const st4 = api.parseFen('r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5');
  const r = api.analyze(st4, {maxDepth: 8, timeMs: 600});
  const line = api.pvLine(st4, r.pv, 8);
  console.log('主变：' + line.map(x => x.cn).join(' '));
  let cur = st4, good = true;
  for (const x of line){
    const mv = api.legalMoves(cur, cur.turn).find(y => api.toSan(cur, y) === x.san);
    if (!mv) { good = false; break; }
    cur = api.applyMove(cur, mv);
  }
  console.log(good ? '主变全程合法（' + line.length + ' 手）' : '!! 主变里出现非法着法');
}

console.log('\n===== J. 完整对局稳定性（60 手） =====');
{
  api.newGame('w');
  drain();
  let n = 0;
  while (n < 60 && !S().over){
    if (S().st.turn === 'w'){
      const an = S().analysis || api.analyze(S().st, {maxDepth: 3, timeMs: 60});
      const mv = an.ordered[Math.floor(Math.random() * Math.min(3, an.ordered.length))].move;
      api.humanMove(mv);
    } else {
      api.engineTurn();
    }
    drain();
    n++;
  }
  console.log('走完 ' + S().moves.length + ' 手，over=' + S().over);
  console.log('棋谱（中文）：' + S().moves.map(m => m.cn).join(' ').slice(0, 140) + '…');
  console.log('体检行数：' + (els.audit.innerHTML.match(/class="row/g) || []).length);

  // 中文记谱：不得出现棋子代号 K/Q/R/B/N，也不得出现易位记号 O-O
  // 注意：兵没有字母代号，兵的着法在中英文里长得一样（e4 / e×d5 / e8升后），这是正常的
  const EN = /[KQRBN]|O-O/;
  const latin = S().moves.filter(m => EN.test(m.cn)).map(m => m.san + '→' + m.cn);
  if (latin.length) bad('棋谱里还有棋子代号：' + latin.slice(0,5).join(' / '));
  else ok('全盘 ' + S().moves.length + ' 手棋谱无棋子代号（兵着法为坐标，属正常）');
}

console.log('\n===== K. 中文记谱：逐个规则核对 =====');
{
  const cases = [
    ['r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', 'Nc3',  '马c3'],
    ['rnbqkbnr/pppp1ppp/8/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 2 3',   'Bxf7+', '象×f7将军'],
    ['rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4','O-O',   '短易位'],
    ['r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',                             'O-O-O', '长易位'],
    ['6k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1',                              'Kf1',   '王f1'],
    ['4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1',                                'exd5',  'e×d5']
  ];
  for (const [fen, san, want] of cases){
    const st = api.parseFen(fen);
    const m = api.moveFromSan(st, san);
    const got = m ? api.cnSan(st, m) : '(走不了)';
    if (got === want) ok(san + ' → ' + got);
    else bad(san + ' 应为 ' + want + '，实际 ' + got);
  }
  // 升变
  {
    const st = api.parseFen('r3k3/1P6/8/8/8/8/6p1/4K3 w - - 0 1');
    const m = api.moveFromSan(st, 'bxa8=Q+') || api.moveFromSan(st, 'bxa8=R+');
    if (m) ok('升变 bxa8=Q+ → ' + api.cnSan(st, m));
    else bad('升变样例走不出来');
  }
  // 同种子需要补出来处
  {
    const st = api.parseFen('4k3/8/8/8/8/2N1N3/8/4K3 w - - 0 1');
    const m = api.moveFromSan(st, 'Ncd5');
    if (m) ok('同种子消歧 Ncd5 → ' + api.cnSan(st, m));
    else bad('同种子消歧样例走不出来');
  }
}

console.log('\n===== L. 战术训练：逐题走标准答案 =====');
{
  api.setMode('tactic');
  drain();
  if (api.MODE() !== 'tactic') bad('setMode("tactic") 没生效');
  console.log('  题量 ' + api.TACTICS.length + '，当前面板：' + clean(els.panelMeta.innerHTML));
  const leak = clean(els.audit.innerHTML);
  console.log('  [简报复述] ' + leak);
  for (let q = 0; q < api.TACTICS.length; q++){
    api.loadPuzzle(q);
    drain();
    const it = api.PZ().it;
    let guard = 0;
    while (!api.PZ().done && guard++ < 12){
      const expect = it.sol[api.PZ().step];
      const mv = api.moveFromSan(S().st, expect);
      if (!mv) { bad('第 ' + (q+1) + ' 题：「' + it.t + '」答案 ' + expect + ' 走不出来'); break; }
      api.puzzleMove(mv);
      drain();
    }
    if (api.PZ().done) ok('第 ' + (q+1) + ' 题「' + it.t + '」走通，' + it.sol.length + ' 手');
    else bad('第 ' + (q+1) + ' 题「' + it.t + '」没能走通');
  }
  // 走错要能回退，棋盘不动
  api.loadPuzzle(0);
  drain();
  const st = S().st;
  const fenBefore = st.board.map(p => p || '-').join('');
  const wrong = it_wrong();
  function it_wrong(){
    const it = api.PZ().it;
    for (const m of api.legalMoves(S().st, S().st.turn)){
      if (api.toSan(S().st, m) !== it.sol[0]) return m;
    }
    return null;
  }
  if (wrong){
    feed.length = 0;
    api.puzzleMove(wrong);
    drain();
    const fenAfter = S().st.board.map(p => p || '-').join('');
    if (fenBefore === fenAfter && S().st.turn === st.turn) ok('走错一步后棋盘原样不动，只给点评');
    else bad('走错之后棋盘被改动了');
    const msg = clean(feed.join(' '));
    if (/[KQRBN]|O-O/.test(msg)) bad('走错的点评里出现了棋子代号：' + msg.slice(0, 80));
    else ok('走错的点评是中文记谱');
    console.log('  [走错的点评] ' + msg.slice(0, 200));
  }
  // 看答案
  feed.length = 0;
  api.loadPuzzle(0); drain();
  els.btnAnsQ.onclick();
  drain();
  console.log('  [看答案] ' + sfx(feed.length - 1).slice(0, 160));
}

console.log('\n===== M. 将死训练：逐题走标准答案 =====');
{
  api.setMode('mate');
  drain();
  console.log('  题量 ' + api.MATES.length + '，当前面板：' + clean(els.panelMeta.innerHTML));
  for (let q = 0; q < api.MATES.length; q++){
    api.loadPuzzle(q);
    drain();
    const it = api.PZ().it;
    if (it.drill){
      // 演练题：随便走一步合法的，应该给点评而不是判错
      const mv = api.legalMoves(S().st, S().st.turn)[0];
      feed.length = 0;
      api.puzzleMove(mv);
      drain();
      const t = clean(feed.join(' '));
      if (t) ok('第 ' + (q+1) + ' 题「' + it.t + '」演练模式给点评：' + t.slice(0, 80) + '…');
      else bad('第 ' + (q+1) + ' 题演练模式没有任何点评');
      continue;
    }
    let guard = 0;
    while (!api.PZ().done && guard++ < 12){
      const expect = it.sol[api.PZ().step];
      const mv = api.moveFromSan(S().st, expect);
      if (!mv) { bad('第 ' + (q+1) + ' 题：「' + it.t + '」答案 ' + expect + ' 走不出来'); break; }
      api.puzzleMove(mv);
      drain();
    }
    if (api.PZ().done) ok('第 ' + (q+1) + ' 题「' + it.t + '」' + it.sol.length + ' 手将死');
    else bad('第 ' + (q+1) + ' 题「' + it.t + '」没能走通');
  }
}

console.log('\n===== N. 开局课堂：逐节逐步走完 =====');
{
  api.setMode('lesson');
  drain();
  console.log('  节数 ' + api.LESSONS.length + '，当前面板：' + clean(els.panelMeta.innerHTML));
  for (let s = 0; s < api.LESSONS.length; s++){
    api.loadLesson(s);
    drain();
    const L = api.LS().it;
    let guard = 0;
    while (api.LS().step < L.line.length && guard++ < 40){
      const k = api.LS().step;
      const mv = api.moveFromSan(S().st, L.line[k][0]);
      if (!mv) { bad('第 ' + (s+1) + ' 节「' + L.t + '」第 ' + (k+1) + ' 步 ' + L.line[k][0] + ' 走不出来'); break; }
      api.lessonGoto(k + 1);
      drain();
    }
    if (api.LS().step === L.line.length){
      const latin = S().moves.filter(m => /[KQRBN]|O-O/.test(m.cn));
      if (latin.length) bad('第 ' + (s+1) + ' 节棋谱有棋子代号：' + latin[0].cn);
      else ok('第 ' + (s+1) + ' 节「' + L.t + '」' + L.line.length + ' 步走完，解说 ' + L.line.length + ' 条');
      // 要点必须常驻在顶部简报栏里（不能随解说滚走）
      const panel = els.audit.innerHTML;
      const missing = L.points.filter(p => panel.indexOf(p.slice(0, 8)) < 0);
      if (panel.indexOf('class="points') < 0 || missing.length)
        bad('第 ' + (s+1) + ' 节的要点没常驻在简报栏：缺 ' + missing.length + ' 条');
      else ok('第 ' + (s+1) + ' 节 ' + L.points.length + ' 条要点常驻在顶部简报栏');
    } else bad('第 ' + (s+1) + ' 节「' + L.t + '」没走完');
  }
  // 回上一节 / 上一节边界
  api.loadLesson(0); drain();
  api.loadLesson(-1); drain();
  ok('上一节越界回到第 ' + (api.LS().idx + 1) + ' 节');
}

console.log('\n===== O. 训练模式不许泄题 =====');
{
  const leaks = [];
  for (const mode of ['tactic','mate']){
    api.setMode(mode); drain();
    const list = mode === 'tactic' ? api.TACTICS : api.MATES;
    for (let q = 0; q < list.length; q++){
      api.loadPuzzle(q); drain();
      const it = api.PZ().it;
      if (it.drill) continue;
      const panel = clean(els.audit.innerHTML) + ' ' + clean(els.modeCnt.innerHTML);
      for (const san of it.sol){
        // 面板里不该出现答案本身（中英文都不该出现）
        const st0 = api.parseFen(it.fen);
        const mv = api.moveFromSan(st0, san);
        const cn = mv ? api.cnSan(st0, mv) : san;
        if (panel.indexOf(san) >= 0 || (cn.length > 2 && panel.indexOf(cn) >= 0))
          leaks.push(mode + ' 第' + (q+1) + ' 题泄露了 ' + san + '/' + cn);
      }
    }
  }
  if (leaks.length) leaks.forEach(bad);
  else ok('战术/将死训练的简报里都没有出现答案');
}

console.log('\n===== P. 规则手册：逐则摆局面 + 示范 =====');
{
  api.setMode('rules');
  drain();
  if (api.MODE() !== 'rules') bad('setMode("rules") 没生效');
  console.log('  则数 ' + api.RULES.length + '，当前面板：' + clean(els.panelMeta.innerHTML));
  for (let i = 0; i < api.RULES.length; i++){
    api.loadRule(i);
    drain();
    const R = api.RI().it;
    const panel = els.audit.innerHTML;
    const missing = R.points.filter(p => panel.indexOf(p.slice(0, 8)) < 0);
    if (missing.length) bad('第 ' + (i+1) + ' 则「' + R.t + '」要点没进简报栏：缺 ' + missing.length);
    const demos = R.demos || [];
    console.log('  ok  第 ' + (i+1) + ' 则「' + R.t + '」' + R.points.length + ' 条要点' +
      (demos.length ? '，' + demos.length + ' 个示范' : '，看局面（无示范）'));
    // 棋盘条上不该出现「你 / 电脑」
    const who = (els.topWho.textContent || '') + '/' + (els.botWho.textContent || '');
    if (/你|电脑/.test(who)) bad('第 ' + (i+1) + ' 则玩家条还在用「你/电脑」：' + who);
  }
  // 王车易位：切到某一侧示范 → 先只给提示（棋盘不动）→ 点「走给你看」才真的搬王车
  api.loadRule(0); drain();
  const want = [{n:'短易位', k:62, r:61}, {n:'长易位', k:58, r:59}];
  want.forEach(function(w, k){
    const btn = els['btnDemo' + k];
    if (!btn || !btn.onclick){ bad('王车易位缺少示范按钮 btnDemo' + k); return; }
    btn.onclick();
    drain();
    const b0 = S().st.board;
    // 切示范只应该换提示，棋盘必须停在「走之前」
    if (b0[60] === 'K' && b0[63] === 'R')
      ok('切到「' + w.n + '」时棋盘停在走之前（王还在 e1）');
    else bad('切到「' + w.n + '」时棋盘就已经动了（e1=' + b0[60] + ' h1=' + b0[63] + '）');
    if (api.RI().hint) ok('  给出走法提示：' + api.RI().hint.label);
    else bad('  切到「' + w.n + '」没有给出走法提示');
    api.rulePlay();
    drain();
    const b = S().st.board;
    if (b[w.k] === 'K' && b[w.r] === 'R')
      ok('  点「走给你看」后王在 ' + api.sqName(w.k) + '、车在 ' + api.sqName(w.r));
    else bad('  点「走给你看」后王车位置不对（王' + b[w.k] + ' 车' + b[w.r] + '）');
  });
  // 逼和那则：轮到黑方且零合法着法
  const bi = api.RULES.map(r => r.t).indexOf('逼和');
  api.loadRule(bi); drain();
  if (S().st.turn === 'b' && api.legalMoves(S().st, 'b').length === 0 && !api.inCheck(S().st.board, 'b'))
    ok('逼和那则：轮到黑方、零合法着法、未被将军');
  else bad('逼和那则局面不对');
  // 越界一圈
  api.loadRule(-1); drain();
  ok('上一则越界回到第 ' + (api.RI().idx + 1) + ' 则「' + api.RI().it.t + '」');
  // 规则手册里棋盘点了也不该走子
  const before = S().st.board.map(p => p || '-').join('');
  api.loadRule(0); drain();
  const after0 = S().st.board.map(p => p || '-').join('');
  if (before !== after0) ok('换则之后棋盘确实重摆了');
  if (S().busy) ok('规则手册里棋盘是锁住的（S.busy=true），不会误触落子');
  else bad('规则手册没有锁住棋盘');
}

console.log('\n================ 结论 ================');
console.log(problems ? ('✗ 共 ' + problems + ' 处问题') : '✓ 全部通过');
process.exit(problems ? 1 : 0);
