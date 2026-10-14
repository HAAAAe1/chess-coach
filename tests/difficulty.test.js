/* 对手随机性回归：三档强度在「同一个局面」上到底会不会走出不同的棋，
   以及换手时最多亏多少分（slack 是否真的约束住了）。
   只加载 core，不碰 UI，所以跑得很快。 */
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const core = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
const A = new Function(core + `
return {parseFen, legalMoves, toSan, cnSan, analyze, engineChoose, scoreMove, LEVELS, applyMove, encM};`)();

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// 一个安静的中局：多个着法价值接近，最能看出随机性
const MID = 'r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2Q1RK1 w - - 4 10';

let problems = 0;
const bad = m => { problems++; console.log('  ✗ ' + m); };
const ok = m => console.log('  ok ' + m);

console.log('===== A. 三档强度在同一局面上的选步分布 =====');
console.log('（每档跑 40 次，看它会不会总是同一步）');
for (const lv of [1, 2, 3]){
  const cfg = A.LEVELS[lv];
  const st = A.parseFen(START);
  const counts = new Map();
  let total = 0, n = 0;
  for (let k = 0; k < 40; k++){
    const r = A.engineChoose(st, lv);
    const san = A.toSan(st, r.move);
    counts.set(san, (counts.get(san) || 0) + 1);
    total += r.ms; n++;
  }
  const top = A.analyze(st, {maxDepth: cfg.maxDepth, timeMs: cfg.timeMs});
  const bestSan = A.toSan(st, top.move);
  const list = [...counts.entries()].sort((a, b) => b[1] - a[1])
    .map(([s, c]) => s + '×' + c).join('  ');
  console.log('  [' + cfg.label + '] 不同着法 ' + counts.size + ' 种：' + list);
  console.log('        平均耗时 ' + Math.round(total / n) + 'ms，首选是 ' + bestSan);
  const wantVariety = cfg.gamble * 0.4;   // 40 次里至少该换手这么多次才算「感觉得到」
  if (counts.size < 2) bad('「' + cfg.label + '」40 次全部走同一步 —— 随机策略没生效');
  else ok('「' + cfg.label + '」能走出 ' + counts.size + ' 种不同的应法');
  if (lv === 3 && counts.size < 2) bad('默认以外最常用的一档没有多样性');
}

console.log('\n===== B. 换手时最多亏多少分（slack 约束）=====');
for (const lv of [1, 2, 3]){
  const cfg = A.LEVELS[lv];
  const st = A.parseFen(MID);
  const top = A.analyze(st, {maxDepth: cfg.maxDepth, timeMs: cfg.timeMs});
  const bestSan = A.toSan(st, top.move);
  // 必须和 engineChoose 内部挑候选用的深度一致，否则比的是两个不同的尺子
  const d = Math.min(5, Math.max(2, top.depth || 4));
  let worst = 0, picked = 0;
  const vb = A.scoreMove(st, top.move, d, 400);
  for (let k = 0; k < 30; k++){
    const r = A.engineChoose(st, lv);
    if (A.toSan(st, r.move) === bestSan) continue;
    picked++;
    const v = A.scoreMove(st, r.move, d, 400);
    if (v !== null && vb !== null) worst = Math.max(worst, vb - v);
  }
  console.log('  [' + cfg.label + '] 30 次里有 ' + picked + ' 次没走首选，最大分差 ' + worst +
              ' 分（slack 上限 ' + cfg.slack + '，比较深度 ' + d + '）');
  if (picked > 0 && worst > cfg.slack + 15) bad(cfg.label + ' 换手分差 ' + worst + ' 超出 slack ' + cfg.slack);
  else ok(cfg.label + ' 换手都在「几乎等价」范围内');
  if (picked === 0 && cfg.gamble > 0) bad(cfg.label + ' 30 次一次都没换手 —— gamble 形同虚设');
}

console.log('\n===== C. 库外局面第一手：随机但仍在正着范围内 =====');
{
  // 1.c4 —— 开局库里没有这条线（见上一轮的库盘点），全靠搜索 + gamble
  const st = A.parseFen(START);
  const m = A.legalMoves(st, 'w').find(x => A.toSan(st, x) === 'c4');
  const st2 = A.applyMove(st, m);
  const counts = new Map();
  for (let k = 0; k < 16; k++){
    const r = A.engineChoose(st2, 3);
    const san = A.toSan(st2, r.move);
    counts.set(san, (counts.get(san) || 0) + 1);
  }
  console.log('  1.c4 之后（「较强」）16 次：' +
    [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s, c]) => s + '×' + c).join('  '));
  if (counts.size < 2) bad('库外局面仍然完全固定');
  else ok('库外局面也能出现 ' + counts.size + ' 种应法');
}

console.log('\n' + (problems ? ('✗ 共 ' + problems + ' 处问题') : '✓ 随机策略全部通过'));
