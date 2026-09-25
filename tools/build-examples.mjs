// サンプルレイアウト生成: node tools/build-examples.mjs
import { writeFileSync } from 'node:fs';
import { worldPorts, placements, veq } from '../docs/js/core.js';
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

writeFileSync(new URL('../docs/examples/examples.json', import.meta.url), JSON.stringify(out));
console.log('wrote', Object.keys(out));
