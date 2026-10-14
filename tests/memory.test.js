/* 本地记忆回归：验证「刷新后接着玩」这一层。
   关键手法：同一个 store 对象喂给两个独立创建的应用实例 ——
   第二个实例就等于一次真实刷新（脚本重新求值、内存里的变量全没了）。
   覆盖：
     1) 空存储 / 坏数据 / 存储不可用 —— 都要能正常启动，不许抛
     2) 模式、对手强度、执子方、两种训练题各自的位置都存得住
     3) 已完成的题目跨刷新还在
     4) 「重置进度」两次点击才真的清空
*/
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const core = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
const ui = html.match(/<script id="ui">([\s\S]*?)<\/script>/)[1];

const KEY = 'chess-coach:progress:v1';

/* ---------- DOM 桩（够用就行：不派发事件，只要能挂住状态） ---------- */
function makeEl(id){
  let _html = '';
  const el = {
    id, className: '', textContent: '', scrollTop: 0, scrollHeight: 0,
    hidden: false, open: false, value: '2', onclick: null,
    dataset: {}, children: [], style: { display: 'none', setProperty(){} },
    classList: { toggle(){}, add(){}, remove(){}, contains(){ return false; } },
    addEventListener(){}, appendChild(c){ if (c) el.children.push(c); }, remove(){},
    querySelector(){ return makeEl('sub'); }, querySelectorAll(){ return []; }
  };
  Object.defineProperty(el, 'innerHTML', {
    get(){ return _html; },
    set(v){ _html = String(v); el.children.length = 0; }
  });
  return el;
}

/* 内存版 localStorage。backing 是真正存键值的地方，两个实例共用它 = 一次刷新。 */
function memStore(backing){
  return {
    getItem: k => (k in backing ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); },
    removeItem: k => { delete backing[k]; }
  };
}

/* 启动一个「新页面」。backing 是共用的，第二个实例就等于一次刷新。
   传 hostile 可以模拟「存储整个不可用」（无痕模式 / 配额满）。 */
function boot(backing, hostile){
  const els = {};
  const document = {
    getElementById(id){ return els[id] || (els[id] = makeEl(id)); },
    createElement(tag){ return makeEl(tag); },
    querySelectorAll(sel){ return sel === '.stateChip' ? [this.getElementById('stateChip')] : []; }
  };
  const timers = [];
  const window = {
    localStorage: hostile || memStore(backing),
    addEventListener(){},
    clearTimeout(){},
    requestAnimationFrame(fn){ timers.push(fn); return timers.length; },
    setTimeout(fn){ timers.push(fn); return timers.length; }
  };
  const drain = () => { let i = 0; while (timers.length && i++ < 900) timers.shift()(); };
  const api = new Function('document', 'window', core + '\n' + ui + `
return {MODE: () => MODE, PZ: () => PZ, LS: () => LS, RI: () => RI, S: () => S, MEM: () => MEM,
        MODE_NAMES, setMode, newGame, loadPuzzle, loadLesson, lessonGoto, loadRule,
        armForget, remember, forgetProgress, TACTICS, MATES, LESSONS, RULES};`)(document, window);
  drain();
  return {api, els, drain, backing};
}

let problems = 0;
const bad = m => { problems++; console.log('  ✗ ' + m); };
const ok  = m => console.log('  ok ' + m);
function eq(got, want, label){
  if (got === want) ok(label + ' → ' + JSON.stringify(got));
  else bad(label + '：期望 ' + JSON.stringify(want) + '，实际 ' + JSON.stringify(got));
}
function truthy(v, label){ if (v) ok(label); else bad(label + '（不成立）'); }

/* ================================================================ */
console.log('===== A. 空存储首启：该走的默认都得走到 =====');
{
  const store = {};
  const a = boot(store);
  eq(a.api.MODE(), 'play', '首次打开进对弈');
  eq(a.els.level.value, '2', '对手强度默认进阶');
  eq(a.api.S().human, 'w', '默认执白先手');
  eq(a.api.PZ().idx, 0, '题库停在第 1 题');
  eq(Object.keys(a.api.PZ().solved).length, 0, '没有任何已完成记录');
}

console.log('\n===== B. 改动后要存下来（模式 / 强度 / 执子方 / 两种题各自的位置）=====');
const store = {};
let app = boot(store);
{
  // 先在对弈里换成执黑 —— 「你要执哪一方」只在对弈模式下有定义
  app.api.setMode('play');
  app.api.newGame('b');
  // 战术训练停在第 4 题
  app.api.setMode('tactic');
  app.api.loadPuzzle(3);
  // 将死训练停在第 3 题
  app.api.setMode('mate');
  app.api.loadPuzzle(2);
  // 强度调成「较强」
  app.els.level.value = '3';
  app.api.remember();
  app.drain();

  const saved = JSON.parse(store[KEY] || 'null');
  truthy(saved, '确实写进本地存储了');
  eq(saved && saved.mode, 'mate', '记住的是最后所在的模式');
  eq(saved && saved.level, 3, '记住对手强度');
  eq(saved && saved.human, 'b', '记住执子方（不是被题目的先手覆盖）');
  eq(saved && saved.pz && saved.pz.tactic, 3, '战术训练记到第 4 题');
  eq(saved && saved.pz && saved.pz.mate, 2, '将死训练记到第 3 题');
  truthy(saved && saved.pz && saved.pz.tactic !== saved.pz.mate,
    '两种训练各自记各的位置，没有互相覆盖');
}

console.log('\n===== C. 模拟一次刷新：第二个实例必须原地接着玩 =====');
{
  const again = boot(store);          // 同一个 store = 一次刷新
  eq(again.api.MODE(), 'mate', '刷新后回到将死训练');
  eq(again.els.level.value, '3', '刷新后强度仍是较强');
  eq(again.api.PZ().idx, 2, '刷新后还在第 3 题');

  // 换到战术训练，应该回到它自己的第 4 题，而不是第 1 题
  again.api.setMode('tactic');
  eq(again.api.PZ().idx, 3, '切回战术训练时回到上次那一题');
  // 回对弈，还是上次执的那一方
  again.api.setMode('play');
  eq(again.api.MODE(), 'play', '对弈模式不受题库位置影响');
  eq(again.api.S().human, 'b', '回对弈仍是执黑（题目的先手没有污染它）');
}

console.log('\n===== D. 已完成的题目跨刷新还在 =====');
{
  const s2 = {};
  const one = boot(s2);
  const fens = one.api.TACTICS.map(t => t.fen);
  one.api.PZ().solved['q' + fens[0]] = true;
  one.api.PZ().solved['q' + fens[1]] = true;
  one.api.PZ().solved['q' + one.api.MATES[0].fen] = true;
  one.api.remember();
  one.drain();
  eq(Object.keys(one.api.PZ().solved).length, 3, '三题标记为已完成');

  const two = boot(s2);
  eq(Object.keys(two.api.PZ().solved).length, 3, '刷新后完成记录还在');
  truthy(two.api.PZ().solved['q' + fens[0]], '具体是哪几题也还在');
  // 体检栏显示的「已完成 N」应该跟着走
  two.api.setMode('tactic');
  const sys = two.els.modeCnt.textContent;
  truthy(sys.indexOf('已完成 2') >= 0, '模式条按当前这套题数进度：「' + sys + '」');
}

console.log('\n===== E. 「重置进度」必须点两次才生效 =====');
{
  const s3 = {};
  const a = boot(s3);
  a.api.setMode('tactic');
  a.api.PZ().solved['q' + a.api.TACTICS[0].fen] = true;
  a.api.remember();
  a.drain();
  truthy(s3[KEY], '先有记录');

  a.api.armForget();
  eq(a.els.btnForget.textContent, '确定清空？', '第一次点只变成待确认');
  truthy(s3[KEY], '第一次点没有真的清');
  a.api.armForget();
  eq(s3[KEY], undefined, '第二次点才清空');
  eq(a.els.btnForget.textContent, '重置进度', '按钮文字复位');
  eq(Object.keys(a.api.PZ().solved).length, 0, '内存里的完成记录也清掉');
  truthy(a.api.MODE() === 'tactic', '只清记录，不动当前正在看的页面');
}

console.log('\n===== F. 坏数据 / 存储不可用：都不许把页面搞崩 =====');
{
  const broken = { [KEY]: '{这不是 JSON' };
  try {
    const a = boot(broken);
    eq(a.api.MODE(), 'play', '坏数据时退回默认对弈');
    eq(a.api.S().human, 'w', '坏数据时执子方也用默认');
    ok('坏数据没有抛异常');
  } catch (e){ bad('坏数据把启动搞崩了：' + e.message); }

  const hostile = {
    getItem(){ throw new Error('无痕模式禁用存储'); },
    setItem(){ throw new Error('配额满了'); },
    removeItem(){ throw new Error('不让删'); }
  };
  try {
    const a = boot({}, hostile);
    eq(a.api.MODE(), 'play', '存储不可用时正常启动');
    a.api.setMode('rules');
    a.api.loadRule(2);
    eq(a.api.RI().idx, 2, '存储不可用时功能照常');
    ok('存储全程抛异常也没有崩');
  } catch (e){ bad('存储不可用把启动搞崩了：' + e.message); }
}

console.log('\n===== G. 课程 / 规则手册的位置也记 =====');
{
  const s4 = {};
  const a = boot(s4);
  a.api.setMode('lesson');
  a.api.loadLesson(4);
  a.api.lessonGoto(6);
  a.drain();

  // 刷新时正停在课程里 → 连讲到第几步都接上，不用从头再听一遍
  const b = boot(s4);
  eq(b.api.MODE(), 'lesson', '刷新后回到开局课堂');
  eq(b.api.LS().idx, 4, '课程停在第 5 节');
  eq(b.api.LS().step, 6, '课程还停在第 6 步');

  // 规则手册同理
  b.api.setMode('rules');
  b.api.loadRule(3);
  b.drain();
  const c = boot(s4);
  eq(c.api.MODE(), 'rules', '刷新后回到规则手册');
  eq(c.api.RI().idx, 3, '规则手册停在第 4 则');

  // 自己点进课程（不是刷新进去的）则从头讲一遍，这是有意的
  c.api.setMode('lesson');
  eq(c.api.LS().idx, 4, '点进课程仍是上次那一节');
  eq(c.api.LS().step, 0, '但这一步从头讲起');
}

console.log('\n' + (problems ? '✗ 共 ' + problems + ' 项不通过' : '✓ 全部通过'));
process.exit(problems ? 1 : 0);
