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
const eq = (got, want, m) => {
  if (got === want) ok(m);
  else bad(m + ' —— 期望 ' + JSON.stringify(want) + '，实际 ' + JSON.stringify(got));
};

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
  if (counts.size < 2) bad('「' + cfg.label + '」40 次全部走同一步 —— 随机策略没生效');
  else ok('「' + cfg.label + '」能走出 ' + counts.size + ' 种不同的应法');
  if (lv === 3 && counts.size < 2) bad('默认以外最常用的一档没有多样性');
}

console.log('\n===== B. 换手是否真的受 slack 约束 =====');
/* 基准必须用 engineChoose **自己**搜出来的首选（r.ordered[0]）。
   这里原来是在外面重新 analyze 一遍当基准 —— 那是两次互相独立的搜索，
   timeMs 限时的迭代加深深度会漂，基准自己也跟着漂，于是「有没有换手」时高时低：
   同一份代码、同一个局面，较强档 30 次里数出过 0 次也数出过 16 次。
   实测（4 个局面 × 24 次）：真实换手率 入门 26% / 进阶 22% / 较强 4%，
   而旧口径把较强记成 63/96 —— 多出来的全是「基准漂了」，不是换手。 */
const SWAP_POS = [
  START,
  MID,
  'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 4 5',
  '8/5pk1/6p1/8/3P4/5P2/6KP/8 w - - 0 40'
];
const SWAP_N = 12;
let anySwap = 0;
for (const lv of [1, 2, 3]){
  const cfg = A.LEVELS[lv];
  let swaps = 0, total = 0, worst = 0, mismatch = 0;
  for (const fen of SWAP_POS){
    const st = A.parseFen(fen);
    for (let k = 0; k < SWAP_N; k++){
      const r = A.engineChoose(st, lv);
      total++;
      const base = r.ordered[0].move;
      const swapped = A.encM(r.move) !== A.encM(base);
      // r.picked 是解说里「这步是换过手的」的依据，必须和实际情况一致
      if (swapped !== !!r.picked) mismatch++;
      if (!swapped) continue;
      swaps++;
      // 用和 engineChoose 内部挑候选时同样的深度去量，否则是两把不同的尺子
      const d = Math.min(5, Math.max(2, r.depth));
      const vb = A.scoreMove(st, base, d, 400), v = A.scoreMove(st, r.move, d, 400);
      if (vb !== null && v !== null) worst = Math.max(worst, vb - v);
    }
  }
  anySwap += swaps;
  console.log('  [' + cfg.label + '] gamble ' + Math.round(cfg.gamble*100) + '% · slack ' + cfg.slack +
              ' → ' + total + ' 次里换手 ' + swaps + ' 次（' + Math.round(swaps/total*100) +
              '%），换手最大分差 ' + worst + ' 分');
  if (worst > cfg.slack + 15) bad(cfg.label + ' 换手分差 ' + worst + ' 超出 slack ' + cfg.slack);
  else ok(cfg.label + ' 换手都在「几乎等价」范围内');
  if (mismatch) bad(cfg.label + ' 有 ' + mismatch + ' 次 r.picked 与实际换手不一致');
  else ok(cfg.label + ' r.picked 与实际换手一致');
}
// 抽查「一次都没换手」只在汇总口径上判：单个局面可能本来就只有一步在 slack 内，
// 那是合理的，不该算失败。入门档 gamble 50%，漏判概率低到可以忽略。
if (anySwap === 0) bad('三档四个局面全都没换过手 —— gamble 形同虚设');
else ok('随机换手机制确实在工作（合计 ' + anySwap + ' 次）');

console.log('\n===== C. 候选池装得下第二步，且骰子能换手 =====');
{
  /* 这一节测的是 engineChoose，也就是中局阶段的换手机制 —— 它不看开局库
     （开局库只在 enginePick 里查），所以直接用一个安静的中局局面。
     以前这里用「1.c4 之后」的局面并称其为库外局面，而现在 1.c4 已经是库内线路，
     那个前提不成立了，换成真正的中局局面。 */
  const st2 = A.parseFen(MID);

  console.log('  安静中局。各档自己算自己的首选（档位不同深度不同，首选本来就可能不一样，不能混用）');
  console.log('    较强档首轮搜索得到 ' + A.toSan(st2, A.analyze(st2, {maxDepth: A.LEVELS[3].maxDepth, timeMs: A.LEVELS[3].timeMs}).move));

  // (1) 池子必须装得下第二手 —— 这是「随机策略真的能生效」的前提。
  //
  //     怎么测：注入一个**必定掷中**的随机源（返回 0，小于任何 gamble），
  //     且它的第二次调用返回 0 → 抽中池首位 → 结果等于首选、picked 保持 false，
  //     但 poolSize 被确定性地填上了。这样量到的是真正的池子大小，不是在量骰子的运气
  //     （用真实 Math.random 采样的话，较强档 15% 的掷中率会让大半样本读到 poolSize = 0，
  //     看起来像「池子是 0 手」）。
  //
  //     另两个必须知道的点：
  //     ① 池子大小是**局面相关**的。有些局面前几名分差本来就大于 slack，池子合法地只有 1 手
  //        （实测：西西里中局在进阶/较强档就是 1 手）。所以不能拿单个局面下断言 ——
  //        那等于在断言「这个局面恰好有多种等价走法」，是在断言局面而不是在断言配置。
  //        正确做法：在一组局面上看，只要某一档**在任何局面上**都装不下第二手，才是配错了。
  //     ② 池子里的分数是 scoreMove 现算的（深度 ≤5、220ms），所以还留了一点计时敏感，
  //        取多次采样的最大值即可。
  const POOL_POS = [
    ['起始局面',         START],
    ['安静中局',         MID],
    ['1.e4 之后（黑走）', 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'],
    ['1.d4 d5 之后',     'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq d6 0 2'],
    ['意大利核心',       'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 4 5'],
    ['西西里中局',       'r1bqkb1r/1p2pppp/p1np1n2/8/3NP3/2N1B3/PPP2PPP/R2QKB1R w KQkq - 0 8']
  ];
  const alwaysRolls = () => 0;      // 掷中 + 抽首位
  const matrix = {};
  for (const lv of [1, 2, 3]){
    matrix[lv] = POOL_POS.map(([, fen]) => {
      const st = A.parseFen(fen);
      let maxPool = 0;
      for (let k = 0; k < 3; k++){
        const r = A.engineChoose(st, lv, alwaysRolls);
        maxPool = Math.max(maxPool, r ? (r.poolSize || 0) : 0);
      }
      return maxPool;
    });
  }
  console.log('  各局面的候选池大小（注入「必定掷中」的随机源，直接读池子）：');
  console.log('    ' + '局面'.padEnd(22) + [1,2,3].map(l => A.LEVELS[l].label.padStart(6)).join(''));
  POOL_POS.forEach(([name], i) => {
    console.log('    ' + name.padEnd(22) + [1,2,3].map(l => String(matrix[l][i]).padStart(6)).join(''));
  });
  for (const lv of [1, 2, 3]){
    const cfg = A.LEVELS[lv];
    const vals = matrix[lv];
    const best = Math.max(...vals);
    const multi = vals.filter(v => v >= 2).length;
    if (best < 2) bad('「' + cfg.label + '」在 ' + vals.length + ' 个局面上候选池全是 1 手 —— 骰子掷中也换不动');
    else if (multi * 2 < vals.length) bad('「' + cfg.label + '」只有 ' + multi + ' / ' + vals.length +
      ' 个局面装得下第二手，太少 —— top / slack 偏紧');
    else ok('「' + cfg.label + '」最多 ' + best + ' 手可选；' + multi + ' / ' + vals.length + ' 个局面有多候选');
  }

  // (2) 确定性验证换手路径：注入固定随机序列，不再依赖概率。
  //     engineChoose 内部共调用两次随机源 —— 第一次决定「掷不掷中」，第二次决定「池子里挑哪个」。
  const neverRolls  = () => 0.999;                       // 掷不中
  const rollTakeLast = (() => { const s = [0, 0.999];     // 掷中，且挑池子末位（必不是首选）
                                return () => s.shift(); })();
  const rollTakeFirst = (() => { const s = [0, 0];        // 掷中，但挑池子首位（就是首选）
                                 return () => s.shift(); })();

  for (const lv of [1, 3]){
    const cfg = A.LEVELS[lv];
    const a = A.engineChoose(st2, lv, neverRolls);
    const b = A.engineChoose(st2, lv, rollTakeLast);
    const c = A.engineChoose(st2, lv, rollTakeFirst);

    // 基准必须是「本次调用自己返回的 ordered[0]」，不能另跑一次 analyze 去取——
    // 迭代加深受时间限制影响，两次调用未必停在同一深度，基准会漂。
    eq(A.encM(a.move), A.encM(a.ordered[0].move), '「' + cfg.label + '」掷不中 → 就走本次搜索的首选');
    eq(a.picked, false, '「' + cfg.label + '」掷不中 → 不标记换手');
    console.log('    ' + cfg.label + ' 掷不中  → ' + A.toSan(st2, a.move));

    if (b.poolSize > 1){
      eq(b.picked, true, '「' + cfg.label + '」池中有备选时，掷中挑末位 → 确实换手并标记');
      if (!b.ordered.some(x => A.encM(x.move) === A.encM(b.move))) bad('换到了一个搜索引擎没算过的着法');
      console.log('    ' + cfg.label + ' 掷中挑末位 → ' + A.toSan(st2, b.move) +
                  '（候选池 ' + b.poolSize + ' 手）');
    } else {
      console.log('    ' + cfg.label + ' 掷中挑末位 → 该局面池中只有 1 手，无备选可换（符合预期）');
    }

    eq(c.picked, false, '「' + cfg.label + '」掷中但抽中池首位 → 不标记换手');
    if (!c.ordered.some(x => A.encM(x.move) === A.encM(c.move))) bad('走了一个搜索引擎根本没考虑的着法');
    console.log('    ' + cfg.label + ' 掷中抽首位 → ' + A.toSan(st2, c.move));
  }

  // (3) 入门档换手率最高，多样性断言放这里最稳（gamble 50%）
  const many = new Set();
  for (let k = 0; k < 20; k++) many.add(A.toSan(st2, A.engineChoose(st2, 1).move));
  if (many.size < 2) bad('入门档 20 次全部走同一步 —— 随机策略没生效');
  else ok('入门档 20 次走出 ' + many.size + ' 种应法');
}

console.log('\n' + (problems ? ('✗ 共 ' + problems + ' 处问题') : '✓ 随机策略全部通过'));
