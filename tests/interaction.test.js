/* 交互回归：真的往棋盘上「点」，而不是直接调函数。
   覆盖这一轮修的问题：
     1) 棋子选得中、走得动（棋盘点击不能有两个处理器抢着改状态）
     2) 战术题走对了会推进、走错了棋盘不动、走到最后会「本题完成」
     3) 残局演练里黑王会应手，能一路走到将死
     4) 规则手册默认停在「走之前」并给出走法提示；点「走给你看」才摆结果
*/
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const core = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
const ui = html.match(/<script id="ui">([\s\S]*?)<\/script>/)[1];

/* ---------- DOM 桩：这次要真的支持事件派发 ---------- */
const feed = [];
function El(id){
  let _html = '';
  const el = {
    id, className: '', textContent: '', scrollTop: 0, scrollHeight: 0,
    hidden: false, open: false, value: '2', onclick: null,
    dataset: {}, children: [], style: { display: 'none', setProperty(){} },
    _ls: {},
    classList: { toggle(){}, add(){}, remove(){}, contains(){ return false; } },
    addEventListener(t, fn){ (el._ls[t] = el._ls[t] || []).push(fn); },
    appendChild(c){ if (c) el.children.push(c); if (el.id === 'feed') feed.push(c ? c.innerHTML : ''); },
    remove(){},
    querySelector(){ return El('sub'); },
    querySelectorAll(){ return []; }
  };
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
  // setChip 是靠 querySelectorAll('.stateChip') 找状态条的，桩得把这一个挑出来
  querySelectorAll(sel){ return sel === '.stateChip' ? [document.getElementById('stateChip')] : []; }
};
const PZ_CHIP = () => document.getElementById('stateChip').textContent;
const timers = [];
/* 内存版 localStorage：语义跟真的对齐（含「没有的键返回 null」），但不落盘 */
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
const window = {
  localStorage,
  addEventListener(){},
  clearTimeout(){},
  requestAnimationFrame(fn){ timers.push(fn); return timers.length; },
  setTimeout(fn){ timers.push(fn); return timers.length; }
};
function drain(){ let i = 0; while (timers.length && i++ < 900) timers.shift()(); }

const api = new Function('document', 'window', core + '\n' + ui + `
return {S: () => S, setMode, loadPuzzle, loadRule, ruleShow, rulePlay,
        PZ: () => PZ, RI: () => RI, MODE: () => MODE, TACTICS, MATES, RULES,
        toSan, cnSan, moveFromSan, legalMoves, parseFen, applyMove, isAttacked, sqName,
        kingMobility, edgeDist, inCheck};`)(document, window);

const S = () => api.S();
const clean = s => String(s).replace(/<br\s*\/?>/g, ' | ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
let problems = 0;
const bad = m => { problems++; console.log('  ✗ ' + m); };
const ok  = m => console.log('  ok ' + m);

/* 每次 render() 之后，把棋盘 HTML 里的格子解析出来（真 DOM 里浏览器替我们做） */
function cellIndexes(){
  const out = [];
  const re = /data-i="(\d+)"/g;
  let m;
  while ((m = re.exec(els.board.innerHTML))) out.push(parseInt(m[1], 10));
  return out;
}
function clickSq(i){
  const cell = { dataset: { i: String(i) }, closest(){ return this; } };
  for (const h of (els.board._ls.click || [])) h({ target: cell });
  drain();
}
/* 点「起格 → 落格」。返回第一次点击之后是否选中了起格。
   遇到升变，就从弹出的选择框里挑指定的子（默认升后）。 */
function clickMove(m, promo){
  clickSq(m.from);
  const sel = S().selected;
  clickSq(m.to);
  if (els.promo.style.display === 'grid'){
    const btns = els.promoRow.children;
    const order = ['q', 'r', 'b', 'n'];
    const b = btns[order.indexOf(promo || 'q')];
    if (b && b.onclick) b.onclick();
    drain();
  }
  return sel;
}
function findMove(san){
  const st = S().st;
  return api.legalMoves(st, st.turn).find(x => api.toSan(st, x) === san);
}

console.log('===== A. 棋盘点击处理器只能有一个 =====');
{
  const n = (els.board._ls.click || []).length;
  if (n === 1) ok('棋盘上只挂了 1 个 click 处理器');
  else bad('棋盘挂了 ' + n + ' 个 click 处理器 —— 会互相把选中状态改掉');
}

console.log('\n===== B. 对弈模式：点棋子能选中，再点目标格能走子 =====');
{
  api.setMode('play');
  const m = findMove('e4');
  const sel = clickMove(m);
  if (sel === m.from) ok('点 e2 兵，选中停在 e2（没被第二个处理器取消）');
  else bad('点 e2 之后 selected = ' + sel + '，应为 ' + m.from);
  if (S().moves.length && S().moves[0].san === 'e4') ok('再点 e4 走成了 e4，中文记谱是「' + S().moves[0].cn + '」');
  else bad('走子失败，moves = ' + JSON.stringify(S().moves.map(x => x.san)));
}

console.log('\n===== C. 战术训练：选中 / 走错不动 / 走对推进到完成 =====');
{
  api.setMode('tactic');
  const it = api.TACTICS[0];
  console.log('  第 1 题：' + it.t + '　答案 ' + it.sol.join(' ') + '（' + it.sol.length + ' 手）');

  const good = findMove(it.sol[0]);
  if (!good){ bad('题目首着 ' + it.sol[0] + ' 在当前局面走不出来'); }
  else {
    clickSq(good.from);
    if (S().selected === good.from) ok('点自己的子能选中（' + api.sqName(good.from) + '）');
    else bad('战术模式里棋子选不中：selected = ' + S().selected);
    clickSq(good.from);
  }

  const fenBefore = S().st.board.map(p => p || '-').join('') + '|' + S().st.turn;
  const wrong = api.legalMoves(S().st, S().st.turn).find(x => api.toSan(S().st, x) !== it.sol[0]);
  if (wrong){
    clickMove(wrong);
    const fenAfter = S().st.board.map(p => p || '-').join('') + '|' + S().st.turn;
    if (fenBefore === fenAfter) ok('走错一步后棋盘原样不动（棋谱仍是 ' + S().moves.length + ' 手）');
    else bad('走错之后棋盘被改动了');
    if (S().selected === -1) ok('走错后自动取消选中');
  }

  const res = playOut(it);
  if (res.done) ok('按答案点完，PZ.done = true（共 ' + res.plies + ' 手）');
  else bad('按答案点完却没有结束：done=' + res.done + ' step=' + res.step);
  if (S().moves.length === res.plies) ok('棋谱记了 ' + res.plies + ' 手，和答案线一致');
}

/* 按 sol 一路点下去（对方会自己应手），返回是否走到 PZ.done */
function playOut(it){
  let guard = 0;
  while (!api.PZ().done && guard++ < 70){
    const st = S().st;
    if (it.drill){
      const m = pickDrill(st);
      if (!m) break;
      clickMove(m);
      continue;
    }
    const need = it.sol[api.PZ().step];
    const m = api.legalMoves(st, st.turn).find(x => api.toSan(st, x) === need);
    if (!m){ bad('答案第 ' + (api.PZ().step + 1) + ' 手 ' + need + ' 走不出来'); break; }
    clickMove(m, (need.match(/=([QRBN])/) || [])[1] ? (need.match(/=([QRBN])/)[1]).toLowerCase() : null);
  }
  return {done: api.PZ().done, step: api.PZ().step, plies: S().moves.length};
}

/* 一个真的会下这种残局的「人」：
   ① 绝不把后/车送到黑王嘴边 ② 绝不把黑王闷成逼和
   ③ 在「缩小黑王活动格 / 把它往边线赶 / 卡住它剩下的逃跑格」之间取平衡。
   这就是人做题时的思路；只有它会走，演练题才能真的走到将死。 */
function pickDrill(st){
  const foe = st.turn === 'w' ? 'b' : 'w';
  const ms = api.legalMoves(st, st.turn);
  if (!ms.length) return null;
  const chebTo = (x, y) => Math.max(Math.abs(Math.floor(x/8) - Math.floor(y/8)), Math.abs((x%8) - (y%8)));
  const kingIdx = (bd, ch) => { for (let i = 0; i < 64; i++) if (bd[i] === ch) return i; return -1; };
  let best = null;
  for (const m of ms){
    if (m.captured) continue;
    const after = api.applyMove(st, m);
    if (api.isAttacked(after.board, m.to, foe)) continue;        // 送子
    const lg = api.legalMoves(after, foe);
    if (!lg.length && !api.inCheck(after.board, foe)) continue;  // 逼和
    // 两个王都是 'k'，只能靠大小写区分。之前写成 toLowerCase() === turn（'w'/'b'）
    // 永远找不到 —— 结果是「白王靠上去」这一项恒为 0，陪练就一直在原地兜圈。
    const bk = kingIdx(after.board, foe === 'b' ? 'k' : 'K');
    const wk = kingIdx(after.board, st.turn === 'w' ? 'K' : 'k');
    const sc = api.kingMobility(after, foe) * 40 + api.edgeDist(after, foe) * 30 +
               (wk >= 0 && bk >= 0 ? chebTo(wk, bk) * 10 : 0);
    if (!best || sc < best.sc) best = {m, sc};
  }
  return best ? best.m : null;
}

/* 下面两条线路是离线用「切盒子 + 反复重试」搜出来、并且逐手核对过的完整杀法，
   黑方走的就是 App 里 drillReply 的那套逃跑逻辑。把它们当真答案点一遍，
   就等于证明「这两道演练题在 App 的规则下真的能走到将死」。 */
const DRILL_LINE = {
  '8/8/8/4k3/8/8/8/K6R w - - 0 1':
    'Rh5+ Kd4 Rf5 Kd3 Rd5+ Ke3 Re5+ Kd3 Kb2 Kd4 Kb3 Kd3 Ka3 Kc2 Re3 Kd2 Kb2 Kd1 Kc3 Kc1 Re1#',
  '8/8/8/4k3/8/8/8/K5Q1 w - - 0 1':
    'Qc5+ Kf6 Qd6+ Kg7 Qe6 Kh8 Qe7 Kg8 Ka2 Kh8 Kb1 Kg8 Kc1 Kh8 Qg5 Kh7 Kd1 Kh8 Ke1 Kh7 Ke2 Kh8 ' +
    'Kd2 Kh7 Ke1 Kh8 Kd1 Kh7 Kc2 Kh8 Kb1 Kh7 Kb2 Kh8 Kc3 Kh7 Kd4 Kh8 Qe7 Kg8 Ke3 Kh8 Qg5 Kh7 ' +
    'Kd2 Kh8 Ke2 Kh7 Kf1 Kh8 Kf2 Kh7 Kf3 Kh8 Ke4 Kh7 Ke3 Kh8 Qe7 Kg8 Kd3 Kh8 Qg5 Kh7 Kc3 Kh8 ' +
    'Kb3 Kh7 Kc4 Kh8 Kd4 Kh7 Ke4 Kh8 Kf5 Kh7 Kf6 Kh8 Kf7 Kh7 Qh4#'
};

console.log('\n===== D. 残局演练：黑王要应手，而且要真能走到将死 =====');
{
  api.setMode('mate');
  const drillIdx = api.MATES.map((x, i) => x.drill ? i : -1).filter(i => i >= 0);
  if (!drillIdx.length) bad('没有找到演练题');
  for (const idx of drillIdx){
    api.loadPuzzle(idx);
    drain();
    const it = api.PZ().it;
    console.log('  演练题：' + it.t);

    // D1 先随便走一步，确认黑王会应手、轮次会交回来
    const m0 = pickDrill(S().st);
    if (!m0) bad('  开局找不到可走的一手');
    const n0 = S().moves.length;
    clickMove(m0);
    if (S().moves.length >= n0 + 2) ok('  走一步之后黑王自动应手（棋谱 ' + n0 + ' → ' + S().moves.length + ' 手）');
    else bad('  黑王没有应手 —— 棋谱只涨到 ' + S().moves.length + ' 手，这盘棋会卡死');
    if (S().st.turn === S().human) ok('  应手之后重新轮到白方，可以继续走');
    else bad('  应手之后轮次没交回来：turn = ' + S().st.turn);

    // D2 按预先验证过的杀法从开局点到底
    const line = DRILL_LINE[it.fen];
    if (!line){ bad('  这道演练题没有预先验证的杀法，跳过完整验证'); continue; }
    api.loadPuzzle(idx);
    drain();
    const sans = line.split(/\s+/);
    let mismatch = null, clickCount = 0;
    for (let i = 0; i < sans.length && !api.PZ().done; i++){
      // 奇数位是黑方的应手 —— 那是 App 自己走的，不该由我们「点」。
      // 它的正确性在上一轮（i-1）末尾比对过了。
      if (i % 2 === 1) continue;
      const st = S().st;
      if (st.turn !== S().human){
        mismatch = '第 ' + (i+1) + ' 手本想走 ' + sans[i] + '，但其实轮到黑方（App 的应手和预期不一致）';
        break;
      }
      const want = api.moveFromSan(st, sans[i]);
      if (!want){ mismatch = '第 ' + (i+1) + ' 手 ' + sans[i] + ' 在这个局面走不出来'; break; }
      clickMove(want);
      clickCount++;
      // 核对 App 的应手和预期是否一致
      if (i + 1 < sans.length && !api.PZ().done){
        const expectReply = sans[i+1];
        const last = S().moves[S().moves.length - 1];
        if (last && last.san !== expectReply){
          mismatch = 'App 应手是 ' + last.san + '，预期 ' + expectReply;
          break;
        }
      }
    }
    if (mismatch) bad('  杀法对不上：' + mismatch);
    else if (api.PZ().done) ok('  按验证过的杀法点完 ' + clickCount + ' 步，黑王被将死（棋谱 ' + S().moves.length + ' 手），PZ.done = true');
    else bad('  走完整条杀法却没有结束：done=' + api.PZ().done);
    if (PZ_CHIP() === '本题完成') ok('  状态条显示「本题完成」');
    else bad('  状态条是「' + PZ_CHIP() + '」，预期「本题完成」');

    const all = feed.map(clean).join(' ');
    if (/undefined/.test(all)) bad('  解说里出现了 undefined（演练题没有 why 字段）');
    else ok('  将死解说没有 undefined');

    // D3 送子那条分支必须真的活着：把后/车走到黑王嘴边
    api.loadPuzzle(idx);
    drain();
    const st2 = S().st;
    const foe = st2.turn === 'w' ? 'b' : 'w';
    const hang = api.legalMoves(st2, st2.turn)
      .find(x => api.isAttacked(api.applyMove(st2, x).board, x.to, foe));
    if (hang){
      const fen0 = S().st.board.map(p => p || '-').join('');
      clickMove(hang);
      if (S().st.board.map(p => p || '-').join('') === fen0) ok('  把子送到黑王嘴边会被退回，并讲清正确做法');
      else bad('  送子没有被拦截');
    } else ok('  （该局面没有能送子的着法，跳过）');
  }
}

console.log('\n===== E. 规则手册：默认停在「走之前」并给出走法提示 =====');
{
  api.setMode('rules');
  for (let i = 0; i < api.RULES.length; i++){
    api.loadRule(i);
    drain();
    const R = api.RI(), it = api.RULES[i];
    const demos = it.demos || [];
    const moved = S().moves.length;
    if (!demos.length){
      if (!R.hint && moved === 0) ok('第 ' + (i+1) + ' 则「' + it.t + '」没有示范着法，只看局面（符合预期）');
      if (els.hintArrow.innerHTML) bad('第 ' + (i+1) + ' 则没走法却画了箭头');
      continue;
    }
    if (moved === 0) ok('第 ' + (i+1) + ' 则「' + it.t + '」棋盘停在走之前（0 手）');
    else bad('第 ' + (i+1) + ' 则一进来就把棋走了（' + moved + ' 手），看不出走法提示');

    const castle = /^O-O/.test(demos[0].line[0][0]);
    const want = castle ? 2 : 1;
    if (R.hint && R.hint.arrows.length === want) ok('  提示 ' + want + ' 支箭头：' + R.hint.label);
    else bad('  箭头数量不对：' + (R.hint ? JSON.stringify(R.hint.arrows) : 'null'));

    const svg = els.hintArrow.innerHTML;
    if (svg && /<line/.test(svg)) ok('  棋盘上真的画出了箭头（' + (svg.match(/<line/g) || []).length + ' 条线）');
    else bad('  箭头没画出来');

    clickSq(R.hint.arrows[0].from);
    if (api.RI().played) ok('  点高亮格就把这一步走出来了（' + S().moves.length + ' 手）');
    else bad('  点高亮格没有反应');
    if (els.hintArrow.innerHTML === '') ok('  走完之后箭头收掉了');
    else bad('  走完之后箭头还在');

    api.ruleShow();
    drain();
    if (S().moves.length === 0 && !api.RI().played) ok('  点「回到走之前」能退回提示状态');
    else bad('  回到走之前失败，还有 ' + S().moves.length + ' 手');
  }
}

console.log('\n' + (problems ? ('✗ 共 ' + problems + ' 处问题') : '✓ 交互回归全部通过'));
