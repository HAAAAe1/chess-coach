const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const core = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
const api = new Function(core + `
return {parseFen, legalMoves, applyMove, inCheck, perft, toSan, analyze, engineChoose, evalWhite, START_FEN, LEVELS};`)();

// ---------- 1. perft 回归 ----------
const cases = [
  ['起始局面', api.START_FEN, [[1,20],[2,400],[3,8902],[4,197281]]],
  ['Kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [[1,48],[2,2039],[3,97862]]],
  ['残局牵制', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [[1,14],[2,191],[3,2812],[4,43238]]],
  ['升变+易位', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [[1,6],[2,264],[3,9467]]],
  ['复杂中局', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [[1,44],[2,1486],[3,62379]]]
];
let bad = 0;
console.log('===== perft 规则回归 =====');
for (const [name, fen, list] of cases){
  for (const [d, want] of list){
    const got = api.perft(api.parseFen(fen), d);
    const ok = got === want;
    if (!ok) bad++;
    console.log((ok ? '  ok  ' : ' FAIL ') + name + ' d' + d + ' = ' + got + (ok ? '' : ' (期望 ' + want + ')'));
  }
}
console.log(bad ? 'perft 有 ' + bad + ' 项不合格' : 'perft 全部通过');

// ---------- 2. 战术能力 ----------
console.log('\n===== 战术搜索 =====');
const tactics = [
  ['一步杀 (Qxf7#)', 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4', ['Qxf7#']],
  ['白吃对方后 (Rxd5)', '4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1', ['Rxd5']],
  ['双马局陷阱：不能 Nxe4', 'r1bqkb1r/pppp1ppp/2n2n2/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R b KQkq - 5 4', null, ['Nxe4']],
  ['王前弃子：找到 Qxh7+', 'r1bq1rk1/pppn1ppp/3b1n2/3p4/3P4/2NB1N2/PPP2PPP/R1BQ1RK1 w - - 0 9', null]
];
for (const [name, fen, wantSan, avoid] of tactics){
  const st = api.parseFen(fen);
  const r = api.analyze(st, {maxDepth: 10, timeMs: 700});
  const san = r.move ? api.toSan(st, r.move) : '-';
  const rate = Math.round(r.nodes / Math.max(1, r.ms));
  console.log('  ' + name + ' → 走 ' + san + '  (深度 ' + r.depth + ', ' + r.ms + 'ms, ' + rate + 'k 节点/秒)');
  if (wantSan && wantSan.indexOf(san) < 0) console.log('    !! 期望 ' + wantSan.join('/'));
  if (avoid && avoid.indexOf(san) >= 0) console.log('    !! 这步是坏棋，不该走');
}

// 残局杀棋：必须能算到「杀」
console.log('\n===== 杀棋检测 =====');
for (const [name, fen] of [['后对光王', '8/8/8/8/8/4k3/8/K5Q1 w - - 0 1'], ['车对光王', '8/8/8/8/8/4k3/8/K6R w - - 0 1']]){
  const st = api.parseFen(fen);
  const r = api.analyze(st, {maxDepth: 12, timeMs: 1500});
  const mate = Math.abs(r.score) > 90000;
  console.log('  ' + name + ' → ' + (r.move ? api.toSan(st, r.move) : '-') + '  评估 ' + r.score +
    (mate ? '（已算到强制杀，' + Math.ceil((100000 - Math.abs(r.score)) / 2) + ' 回合内）' : '（尚未算到杀，深度 ' + r.depth + '）'));
}

// ---------- 3. 速度基准 ----------
console.log('\n===== 速度 / 深度 =====');
const benches = [
  ['开局 (起始局面)', api.START_FEN],
  ['中局', 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5'],
  ['复杂中局', 'r2q1rk1/pp1bbppp/2n1pn2/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2Q1RK1 w - - 0 9'],
  ['残局', '8/5pk1/6p1/8/3n4/4P3/5PPP/3R2K1 w - - 0 30']
];
for (const [name, fen] of benches){
  const st = api.parseFen(fen);
  for (const ms of [140, 340, 1100]){
    const r = api.analyze(st, {maxDepth: 24, timeMs: ms});
    console.log('  ' + name + ' | 预算 ' + ms + 'ms → 深度 ' + r.depth + '，实耗 ' + r.ms + 'ms，' +
      Math.round(r.nodes / Math.max(1, r.ms)) + 'k 节点/秒，最优 ' + (r.move ? api.toSan(st, r.move) : '-'));
  }
}

// ---------- 4. 自对弈稳定性 ----------
console.log('\n===== 自对弈（进阶档） =====');
let st = api.parseFen(api.START_FEN);
let slowest = 0, total = 0, plies = 0;
for (let i=0;i<80;i++){
  if (!api.legalMoves(st, st.turn).length) break;
  const r = api.engineChoose(st, 2);
  if (!r) break;
  slowest = Math.max(slowest, r.ms);
  total += r.ms;
  st = api.applyMove(st, r.move);
  plies++;
}
console.log('  走完 ' + plies + ' 手，平均 ' + Math.round(total/plies) + 'ms，最慢 ' + slowest + 'ms，' +
  (api.inCheck(st.board, st.turn) ? '当前被将军' : '正常'));

