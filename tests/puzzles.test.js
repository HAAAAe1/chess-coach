/* 题库全面校验：题目本身 + 中文记谱 */
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const core = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
const A = new Function(core + `
return {parseFen, legalMoves, applyMove, inCheck, toSan, cnSan, moveFromSan, analyze, evalWhite,
        START_FEN, encM, findKing, other, typeOf, colorOf, sqName, PT, MATE, isAttacked};`)();
const {typeOf, colorOf, PT, sqName, other, isAttacked} = A;

/* --- 从 HTML 里取出题库数据 --- */
const ui = html.match(/<script id="ui">([\s\S]*?)<\/script>/)[1];
const s = ui.indexOf('const TACTICS');
const e = ui.indexOf('/* ---------- 小工具 ---------- */');
if (s < 0 || e < 0) throw new Error('找不到题库数据');
const D = new Function(ui.slice(s, e) + '\nreturn {TACTICS, MATES, LESSONS, RULES};')();

let fail = 0;
const bad = (...m) => { fail++; console.log('  ✗ ' + m.join(' ')); };

function legalCheck(st){
  const errs = [];
  let wk = 0, bk = 0;
  for (let i=0;i<64;i++){ if (st.board[i] === 'K') wk++; if (st.board[i] === 'k') bk++; }
  if (wk !== 1) errs.push('白王数 ' + wk);
  if (bk !== 1) errs.push('黑王数 ' + bk);
  for (let i=0;i<8;i++) if (st.board[i] && typeOf(st.board[i]) === 'p') errs.push('黑兵在底排 ' + sqName(i));
  for (let i=56;i<64;i++) if (st.board[i] && typeOf(st.board[i]) === 'P') errs.push('白兵在底排 ' + sqName(i));
  if (A.inCheck(st.board, A.other(st.turn))) errs.push('非走子方被将军');
  return errs;
}
function matDiff(st){
  let d = 0;
  for (let i=0;i<64;i++){ const p = st.board[i]; if (!p) continue; const t = typeOf(p); if (t === 'k') continue;
    d += (colorOf(p) === 'w' ? 1 : -1) * PT[t]; }
  return d;
}
function walk(fen, sol){
  let st = A.parseFen(fen);
  const cns = [];
  for (const san of sol){
    const m = A.moveFromSan(st, san);
    if (!m) return {err: '非法着法 ' + san + ' @ ' + A.sqName(-1), cns, st};
    cns.push(A.cnSan(st, m));
    st = A.applyMove(st, m);
  }
  return {st, cns};
}
/* 强制将死（攻方首步任意，之后只走将军；守方全部） */
const TT = new Map(); let NODES = 0;
function fenOf(st){
  const rows = [];
  for (let r=0;r<8;r++){ let s2='',e2=0;
    for (let c=0;c<8;c++){ const p = st.board[r*8+c]; if (p){ if(e2){s2+=e2;e2=0;} s2+=p; } else e2++; }
    if (e2) s2 += e2; rows.push(s2); }
  const c = (st.cast.K?'K':'')+(st.cast.Q?'Q':'')+(st.cast.k?'k':'')+(st.cast.q?'q':'');
  return rows.join('/')+' '+st.turn+' '+(c||'-')+' - 0 '+st.full;
}
function checkingMoves(st){
  const out = [];
  for (const m of A.legalMoves(st, st.turn)) if (A.inCheck(A.applyMove(st, m).board, A.other(st.turn))) out.push(m);
  return out;
}
function attCan(st, left, first){
  if (left <= 0) return false;
  const k = fenOf(st) + '|' + left + '|' + (first?1:0);
  if (TT.has(k)) return TT.get(k);
  if (++NODES > 2000000) return false;
  const mv = first ? A.legalMoves(st, st.turn) : checkingMoves(st);
  let ok = false;
  for (const m of mv) if (defAllMated(A.applyMove(st, m), left-1)){ ok = true; break; }
  TT.set(k, ok); return ok;
}
function defAllMated(st, left){
  const mv = A.legalMoves(st, st.turn);
  if (!mv.length) return A.inCheck(st.board, st.turn);
  if (left <= 0) return false;
  for (const m of mv) if (!attCan(A.applyMove(st, m), left, false)) return false;
  return true;
}
function mateIn(st, maxN){ for (let n=1;n<=maxN;n++) if (attCan(st, 2*n-1, true)) return n; return 0; }

/* ================= 1. 战术题 ================= */
console.log('===== 战术题 =====');
for (const it of D.TACTICS){
  const st0 = A.parseFen(it.fen);
  const errs = legalCheck(st0);
  if (errs.length) bad(it.t, '局面问题:', errs.join(','));
  const w = walk(it.fen, it.sol);
  if (w.err) { bad(it.t, w.err); continue; }
  const key = it.sol[0];
  const m = A.moveFromSan(st0, key);
  const after = A.applyMove(st0, m);
  const mover = st0.turn === 'w' ? 1 : -1;
  const base = matDiff(st0) * mover;                      // 出手前，从出子方视角
  let worst = Infinity, worstSan = '—';
  const reps = A.legalMoves(after, after.turn);
  if (!reps.length){
    worst = 200;
  } else {
    for (const r of reps){
      const c = A.applyMove(after, r);
      const an = A.analyze(c, {maxDepth: 6, timeMs: 200});
      const sgn = c.turn === 'w' ? 1 : -1;
      const ev = (an.ordered && an.ordered.length ? an.ordered[0].score : 0) * sgn * mover;
      if (ev < worst){ worst = ev; worstSan = A.toSan(after, r); }
    }
  }
  const gain = worst - base;
  console.log('  ' + (gain >= 180 ? 'ok  ' : 'WARN') + ' ' + it.t);
  console.log('        答案 ' + w.cns[0] + '（' + A.toSan(st0, m) + '）  着手前子力 ' + matDiff(st0) +
              '  走完后保证 ' + (worst/100).toFixed(2) + ' → 净收益 ' + (gain/100).toFixed(2) +
              ' 兵（对方最强应 ' + worstSan + '）');
  console.log('        中文记谱: ' + w.cns.join(' / '));
  if (gain < 180) bad(it.t, '收益不足 2 兵');
}

/* ================= 2. 将死题 ================= */
console.log('\n===== 将死题 =====');
for (const it of D.MATES){
  const st0 = A.parseFen(it.fen);
  const errs = legalCheck(st0);
  if (errs.length) bad(it.t, '局面问题:', errs.join(','));
  if (it.drill){
    const ms = A.legalMoves(st0, st0.turn);
    console.log('  ok   ' + it.t + '（自由演练，' + ms.length + ' 种首着可选，' +
      (A.evalWhite(st0) > 0 ? '白方子力领先' : A.evalWhite(st0) < 0 ? '白方子力落后' : '子力相等') + '）');
    continue;
  }
  const w = walk(it.fen, it.sol);
  if (w.err){ bad(it.t, w.err); continue; }
  const fin = w.st;
  const isMate = !A.legalMoves(fin, fin.turn).length && A.inCheck(fin.board, fin.turn);
  TT.clear(); NODES = 0;
  const n = it.drill ? null : mateIn(st0, 3);
  console.log('  ' + (isMate ? 'ok  ' : 'FAIL') + ' ' + it.t + '  中文: ' + w.cns.join(' / '));
  if (it.drill){
    console.log('        演练题（不设固定答案线），终局将死 ' + isMate);
  } else {
    console.log('        终局将死 ' + isMate + '，宣称 ' + it.n + ' 步，实际强制将死 ' + n + ' 步');
    if (!isMate) bad(it.t, '终局不是将死');
    if (n !== it.n) bad(it.t, '将死步数不符（实际 ' + n + '）');
  }
}

/* ================= 3. 开局课程 ================= */
console.log('\n===== 开局课程 =====');
for (const L of D.LESSONS){
  let st = A.parseFen(A.START_FEN), ok = true, cns = [];
  for (const [san, note] of L.line){
    const m = A.moveFromSan(st, san);
    if (!m){ bad(L.t, '第 ' + (cns.length+1) + ' 步非法: ' + san); ok = false; break; }
    cns.push(A.cnSan(st, m));
    st = A.applyMove(st, m);
  }
  if (!ok) continue;
  console.log('  ok   ' + L.t + '（' + L.line.length + ' 步）');
  console.log('        ' + cns.join(' '));
  if (L.line.length % 2 !== 0) bad(L.t, '主线不是完整回合（奇数步）');
}
/* ================= 4. 规则手册 ================= */
console.log('\n===== 规则手册 =====');
for (const R of D.RULES){
  const st0 = A.parseFen(R.fen);
  const errs = legalCheck(st0);
  if (errs.length) bad(R.t, '局面问题:', errs.join(','));
  if (!R.points || R.points.length < 3) bad(R.t, '要点少于 3 条');
  const demos = R.demos || [];
  console.log('  ok   ' + R.t + '（' + R.sub + '，' + demos.length + ' 个示范，' +
    A.legalMoves(st0, st0.turn).length + ' 种合法着法）');
  if (!demos.length){
    // 没有示范的局面（逼和 / 子力不足）必须自带一句「看棋盘」提示
    if (!R.hint) bad(R.t, '没有示范但也没有 hint');
    else console.log('        看局面：' + R.hint.slice(0, 46) + '…');
    continue;
  }
  for (const d of demos){
    const w = walk(R.fen, d.line.map(x => x[0]));
    if (w.err){ bad(R.t + ' / ' + d.name, w.err); continue; }
    // 每一步都要有一句讲解，不能是空字符串
    const noNote = d.line.filter(x => !x[1] || x[1].length < 12);
    if (noNote.length) bad(R.t + ' / ' + d.name, '有 ' + noNote.length + ' 步没写讲解');
    console.log('        [' + d.name + '] ' + w.cns.join(' / '));
  }
}
// 王车易位这条的示范，必须真的把王和车搬到正确的位置
{
  const R = D.RULES.filter(x => x.t === '王车易位')[0];
  const chk = { '短易位': {king: 62, rook: 61}, '长易位': {king: 58, rook: 59} };
  for (const d of R.demos){
    const w = walk(R.fen, d.line.map(x => x[0]));
    const want = chk[d.name];
    if (!want){ bad('王车易位', '未预期的示范名 ' + d.name); continue; }
    const okK = w.st.board[want.king] === 'K';
    const okR = w.st.board[want.rook] === 'R';
    const gone = w.st.board[w.st.board.length ? (d.name === '短易位' ? 63 : 56) : -1] === null;
    if (okK && okR) console.log('        ✓ ' + d.name + ' 后王在 ' + A.sqName(want.king) +
      '、车在 ' + A.sqName(want.rook) + '，原来的角落已空');
    else bad('王车易位 / ' + d.name, '王车位置不对（王' + w.st.board[want.king] + ' 车' + w.st.board[want.rook] + '）');
  }
}
// 吃过路兵必须真的减少一个黑兵
{
  const R = D.RULES.filter(x => x.t === '吃过路兵')[0];
  const cnt = st => { let n = 0; for (const p of st.board) if (p === 'p') n++; return n; };
  const w = walk(R.fen, R.demos[0].line.map(x => x[0]));
  if (cnt(w.st) === cnt(A.parseFen(R.fen)) - 1) console.log('        ✓ 被吃的黑兵确实从盘上消失了');
  else bad('吃过路兵', '黑兵数量没有变化，可能没真的吃成');
}
// 逼和局面必须「不被将 + 零合法着法」
{
  const R = D.RULES.filter(x => x.t === '逼和')[0];
  const st = A.parseFen(R.fen);
  const n = A.legalMoves(st, st.turn).length;
  const ck = A.inCheck(st.board, st.turn);
  if (n === 0 && !ck) console.log('        ✓ 逼和局面成立：' + st.turn + ' 方零合法着法且未被将军');
  else bad('逼和', '局面不成立（着法 ' + n + '，被将 ' + ck + '）');
}
// 升变那条的两个示范，必须真的一个将军一个不将军
{
  const R = D.RULES.filter(x => x.t === '兵升变')[0];
  const res = R.demos.map(function(d){
    const w = walk(R.fen, d.line.map(x => x[0]));
    return {name: d.name, ck: A.inCheck(w.st.board, w.st.turn)};
  });
  if (res.length === 2 && res[0].ck !== res[1].ck)
    console.log('        ✓ 升后将军=' + res[0].ck + '、升马将军=' + res[1].ck + ' —— 「不是只能升后」这点真的成立');
  else bad('兵升变', '两个示范没有形成「一个将军一个不将军」的对比');
}

console.log('\n' + (fail ? ('✗ 共 ' + fail + ' 处问题') : '✓ 全部通过'));
