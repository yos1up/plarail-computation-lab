// 簡易テスト: node tools/test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { worldPorts, placements, V0, PARTS, Layout } from '../docs/js/core.js';
import { runDiscrete, truthTable, Sim } from '../docs/js/sim.js';
import { findRoutes } from '../docs/js/route.js';
import { builder, bend } from './lib.mjs';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };

test('曲線8本で円が厳密に閉じる', () => {
  const b = builder();
  const c0 = b.first('R-03', bend('L'));
  let cur = c0, p = b.freePort(c0);
  for (let i = 0; i < 7; i++) { cur = b.attach(cur, p, 'R-03', bend('L')); p = b.freePort(cur); }
  const t = b.L.topology();
  assert.equal(t.open.length, 0);
  assert.equal(t.conflicts.length, 0);
  assert.equal(t.overlaps.length, 0);
});

test('曲線7本+直線では閉じない', () => {
  const b = builder();
  const c0 = b.first('R-01');
  b.chain(c0, 1, Array(7).fill(['R-03', bend('L')]));
  assert.equal(b.L.topology().open.length, 2);
});

test('オーバル + ストップレールで停止する', () => {
  const b = builder();
  const s = b.first('R-08');
  const r = b.chain(s, 1, [...Array(4).fill(['R-03', bend('L')]), 'R-01', ...Array(4).fill(['R-03', bend('L')])]);
  const t = b.L.topology();
  assert.equal(t.open.length, 0, 'closed');
  b.L.train = { partId: r.part.id, pathIdx: 0, dir: 1 };
  // 列車は最後の曲線上 → ストップレールへ
  const res = runDiscrete(b.L);
  assert.equal(res.result, 'stopped');
});

test('ストップ無しオーバルは無限ループ', () => {
  const b = builder();
  const s = b.first('R-01');
  b.chain(s, 1, [...Array(4).fill(['R-03', bend('L')]), 'R-01', ...Array(4).fill(['R-03', bend('L')])]);
  b.L.train = { partId: s.id, pathIdx: 0, dir: 1 };
  assert.equal(runDiscrete(b.L).result, 'loop');
});

test('ターンアウト背向通過で状態が書き換わる', () => {
  const b = builder();
  const st = b.first('R-01');
  const T = b.attach(st, 1, 'R-11', (c) => c.find((x) => x.attach === 1)); // B0 側から背向で入る
  const L = b.L;
  T.props.state = 1;
  L.train = { partId: st.id, pathIdx: 0, dir: 1 };
  const sim = new Sim(L);
  sim.advance(1000);
  assert.equal(sim.states[T.id], 0);
  assert.equal(sim.status, 'derailed');
});

test('経路探索でターンアウトのリバースループが厳密に閉じる', () => {
  const b = builder();
  const T = b.first('R-11');
  const ports = worldPorts(T);
  const routes = findRoutes(b.L, ports[1], ports[2]);
  assert.ok(routes.length > 0, 'found');
  for (const c of routes[0]) b.L.add(c);
  const t = b.L.topology();
  assert.equal(t.open.length, 1); // A のみ
  assert.equal(t.conflicts.length, 0);
  assert.equal(t.overlaps.length, 0);
  console.log('   loop pieces:', routes[0].map((c) => c.type).join(' '));
});

test('終了条件 cycle: ストップ無しオーバルは周回で計算終了、終端は終端到達', () => {
  const b = builder();
  const s = b.first('R-01');
  b.chain(s, 1, [...Array(4).fill(['R-03', bend('L')]), 'R-01', ...Array(4).fill(['R-03', bend('L')])]);
  b.L.train = { partId: s.id, pathIdx: 0, dir: 1 };
  b.L.settings.halt = 'cycle';
  assert.equal(runDiscrete(b.L).result, 'cycle');
  const sim = new Sim(b.L);
  sim.advance(1e5);
  assert.equal(sim.status, 'stopped');
  const b2 = builder();
  const s2 = b2.first('R-01');
  b2.L.train = { partId: s2.id, pathIdx: 0, dir: 1 };
  b2.L.settings.halt = 'cycle';
  assert.equal(runDiscrete(b2.L).result, 'end');
});

test('全加算器サンプル: 周回で計算終了し Co,S が正しい。周回中に変化するポイントを出力にすると失敗', () => {
  const ex = JSON.parse(readFileSync(new URL('../docs/examples/examples.json', import.meta.url), 'utf8'));
  const L = Layout.fromJSON(ex.fulladder.layout);
  const tt = truthTable(L);
  for (const r of tt.rows) {
    const sum = r.inBits.reduce((a, c) => a + c, 0);
    assert.equal(r.result, 'cycle');
    assert.deepEqual(r.outBits, [sum >> 1, sum & 1]);
  }
  L.settings.halt = 'stop';
  assert.ok(truthTable(L).rows.every((r) => r.result === 'loop'));
  L.settings.halt = 'cycle';
  L.parts.find((p) => p.props.label === 'Q0').props.role = 'out';
  const row = truthTable(L).rows.find((r) => r.inBits.join('') === '011');
  assert.equal(row.result, 'loop');
});

console.log(`${n} tests passed`);
