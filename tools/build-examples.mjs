// サンプルレイアウト生成: node tools/build-examples.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { Layout, worldPorts, placements, veq, vfloat } from '../docs/js/core.js';
import { findRoutes } from '../docs/js/route.js';
import { truthTable } from '../docs/js/sim.js';
import { builder, bend } from './lib.mjs';

const out = {};
const check = (name, L) => {
  const t = L.topology();
  if (t.conflicts.length || t.overlaps.length) throw new Error(`${name}: conflicts=${t.conflicts.length} overlaps=${t.overlaps.length}`);
  return t;
};
const close = (L, a, b, opts) => {
  const r = findRoutes(L, a, b, opts);
  if (!r.length) throw new Error('route not found');
  for (const c of r[0]) L.add(c);
};
const portOf = (part, i) => worldPorts(part)[i];
const openEnd = (L, partId, port) => L.topology().open.find((o) => o.partId === partId && o.port === port);

// ---- 分岐グラフ形式（tools/data/*.json）からレイアウトを組み立てる ----
// switches: { 名前: { x, y [mm], h: 幹(A)から直進方向の方位, side: 'L'|'R' 曲線側, b0: 'S'|'C' 端点"0"が直進/曲線 } }
// edges[i]: [[名前, 'A'|'0'|'1'], [名前, 端点]]、routes[i]: 1 つ目の端点から出るレール列 (CL/CR/S108/S54)
// deadends: [名前, 端点, レール列]（行き止まり）
// ターンアウトの凸凹は辺ごとの偶奇が合うように割り当て、合わない辺は S108 を「1/4直線(凸凹)+1/4直線(同性)」に置き換えて性別を反転する。
function fromSwitchGraph(G) {
  const names = Object.keys(G.switches);
  const side = (p) => (p === 'A' ? 0 : 1);
  const hasHalf = (i) => G.routes[i].pieces.includes('S108');
  // パリティ付き union-find。S108 を含まない辺（反転できない辺）を先に木へ入れる
  const par = Object.fromEntries(names.map((n) => [n, n])), px = Object.fromEntries(names.map((n) => [n, 0]));
  const find = (u) => { if (par[u] === u) return [u, 0]; const [r, x] = find(par[u]); par[u] = r; px[u] ^= x; return [r, px[u]]; };
  const flip = new Set();
  const order = G.edges.map((_, i) => i).sort((i, j) => hasHalf(i) - hasHalf(j));
  for (const i of order) {
    const [[a, pa], [b, pb]] = G.edges[i];
    const rel = 1 ^ side(pa) ^ side(pb);
    const [ra, xa] = find(a), [rb, xb] = find(b);
    if (ra !== rb) { par[ra] = rb; px[ra] = xa ^ xb ^ rel; } else if ((xa ^ xb) !== rel) {
      if (!hasHalf(i)) throw new Error(`edge ${i}: gender cannot be fixed`);
      flip.add(i);
    }
  }
  const L = new Layout();
  const sw = {};
  const grid = (v) => { const r = Math.round(v / 54); if (Math.abs(r * 54 - v) > 1e-6) throw new Error(`off grid: ${v}`); return r; };
  for (const n of names) {
    const s = G.switches[n];
    sw[n] = L.add({ type: 'R-11', m: s.side === 'R', g: find(n)[1], r: s.h, t: [grid(s.x), 0, grid(s.y), 0] },
      { state: s.b0 === 'C' ? 1 : 0, role: 'aux', label: n, inv: s.b0 === 'C' }); // 初期状態は論理 0
  }
  const portOfSw = (n, p) => worldPorts(sw[n])[p === 'A' ? 0 : (p === '0') === (G.switches[n].b0 === 'S') ? 1 : 2];
  const lay = (open, pieces, doFlip) => {
    const seq = pieces.map((p) => [p, false]);
    if (doFlip) seq.splice(pieces.indexOf('S108'), 1, ['S54', false], ['S54', true]);
    for (const [p, same] of seq) {
      let c;
      if (p === 'CL' || p === 'CR') c = bend(p[1])(placements('R-03', open));
      else if (p === 'S108') c = placements('R-02', open)[0];
      else if (p === 'S54') c = placements('R-20', open).find((x) => (x.g !== 0) === same);
      else throw new Error(`unknown piece ${p}`);
      const part = L.add(c);
      open = worldPorts(part).find((wp) => !veq(wp.pos, open.pos));
    }
    return open;
  };
  G.edges.forEach(([[a, pa], [b, pb]], i) => {
    const st = portOfSw(a, pa);
    const f = vfloat(st.pos), P = G.routes[i].P;
    if (Math.hypot(f.x - P[0], f.y - P[1]) > 1e-6 || st.h !== P[2]) throw new Error(`edge ${i}: start pose mismatch`);
    const end = lay(st, G.routes[i].pieces, flip.has(i));
    const tgt = portOfSw(b, pb);
    if (!veq(end.pos, tgt.pos) || (end.h + 4) % 8 !== tgt.h) throw new Error(`edge ${i}: route does not close`);
  });
  const stubs = G.deadends.map(([n, p, pieces]) => lay(portOfSw(n, p), pieces, false));
  return { L, sw, stubs };
}

// 1. 基本オーバル
{
  const b = builder();
  const s = b.first('R-08');
  b.chain(s, 1, ['R-01', ...Array(4).fill(['R-03', bend('L')]), 'R-01', 'R-01', ...Array(4).fill(['R-03', bend('L')])]);
  b.L.train = { partId: s.id, pathIdx: 0, dir: 1 };
  const t = check('oval', b.L);
  if (t.open.length) throw new Error('oval not closed');
  out.oval = { title: '基本オーバル（ストップレールで1周して停止）', layout: b.L.toJSON() };
}

// 2. トグル: リバースループ付きターンアウト。通るたびに y が反転する
{
  const b = builder();
  const s = b.first('R-08');
  const r = b.chain(s, 1, ['R-01']);
  const T = b.attach(r.part, r.port, 'R-11', (c) => c.find((x) => x.attach === 0 && !x.m));
  T.props.role = 'out';
  T.props.label = 'y';
  close(b.L, portOf(T, 1), portOf(T, 2), { depth: 7 });
  b.L.train = { partId: s.id, pathIdx: 0, dir: 1 };
  check('toggle', b.L);
  out.toggle = { title: 'トグル（リバースループ：往復するたびに y が反転）', layout: b.L.toJSON() };
}

// 3. NOT: 8の字ポイント2個の「目玉」＋戻りループ
{
  const b = builder();
  const L = b.L;
  const s = b.first('R-08');
  const X = b.attach(s, 1, 'R-12', (c) => c.find((x) => x.attach === 0));
  X.props.role = 'in';
  X.props.label = 'x';
  const top = b.chain(X, 1, [['R-03', bend('R')], 'R-01', ['R-03', bend('R')]]);
  const bot = b.chain(X, 2, [['R-03', bend('L')], 'R-01', ['R-03', bend('L')]]);
  const topEnd = portOf(top.part, top.port), botEnd = portOf(bot.part, bot.port);
  const Y = L.add(placements('R-12', topEnd).find((c) => c.attach !== 0 && worldPorts({ ...c, id: -1 }).some((p) => veq(p.pos, botEnd.pos))));
  Y.props.role = 'out';
  Y.props.label = 'y';
  // 戻りループ: 左180° → 上側のこぶ（目玉の √2 成分を打ち消す）→ 左180°
  const ret = b.chain(Y, 0, [
    ...Array(4).fill(['R-03', bend('L')]),
    'R-01', ['R-03', bend('R')], ['R-03', bend('L')], 'R-01', ['R-03', bend('L')], ['R-03', bend('R')], 'R-01',
    ...Array(4).fill(['R-03', bend('L')]),
  ]);
  if (ret.port >= 0) close(L, portOf(ret.part, ret.port), portOf(s, 0));
  L.train = { partId: s.id, pathIdx: 0, dir: 1 };
  const t = check('not', L);
  if (t.open.length) throw new Error('not: open ends remain');
  const tt = truthTable(L);
  console.log('NOT truth table', tt.rows.map((r) => `${r.inBits}->${r.outBits} ${r.result}`));
  out.not = { title: 'NOT（8の字ポイント2個の目玉型：y = ¬x）', layout: L.toJSON() };
}

// 4. 全加算器（分岐グラフ形式 tools/data/fulladder.json から厳密配置を再構成）
{
  const G = JSON.parse(readFileSync(new URL('./data/fulladder.json', import.meta.url), 'utf8'));
  const { L, sw, stubs } = fromSwitchGraph(G);
  for (const n of ['A', 'B', 'C']) sw[n].props.role = 'in';
  for (const n of ['S', 'Co']) sw[n].props.role = 'out';
  // 補助ポイントの初期状態: S=1、他は 0（Z,K,W,N,J は任意）
  sw.S.props.state = sw.S.props.inv ? 0 : 1;
  // 列車: A の分岐直前（A の幹側に隣接するレール上で A へ向かう）
  const nb = L.neighbor(sw.A.id, 0);
  L.train = { partId: nb.partId, pathIdx: 0, dir: nb.port === 1 ? 1 : -1 };
  const t = check('fulladder', L);
  if (t.open.length !== G.deadends.length) throw new Error('fulladder: unexpected open ends');
  // 終了条件は「終端到達 または 周回軌道に入る」。周回中は S, Co が変化しないことも確認する
  const tt = truthTable(L);
  for (const r of tt.rows) {
    const sum = r.inBits.reduce((a, b) => a + b, 0);
    if (r.outBits[0] !== (sum >> 1) || r.outBits[1] !== (sum & 1)) throw new Error(`fulladder: wrong output for ${r.inBits.join('')}`);
  }
  console.log('full adder truth table', tt.rows.map((r) => `${r.inBits.join('')}->${r.outBits.join('')} ${r.result}`));
  out.fulladder = { title: '全加算器（A,B,C → Co,S／周回軌道に入った時点で計算終了）', layout: L.toJSON() };
}

writeFileSync(new URL('../docs/examples/examples.json', import.meta.url), JSON.stringify(out));
console.log('wrote', Object.keys(out));
