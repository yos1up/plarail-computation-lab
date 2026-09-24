// 2 つの開放端を厳密に結ぶレール列の自動探索（両側からの幅優先探索＋突き合わせ）
import { placements, worldPorts, worldPaths, findOverlaps, vadd, vkey, hmod, opp, V0 } from './core.js';

// 探索に使う手: パーツ種類と配置候補インデックス（開放端の方位・性別ごとに前計算）
const MOVE_TYPES = ['R-01', 'R-02', 'R-03', 'R-20'];
const moveCache = new Map();
function movesFor(h, g) {
  const key = `${h}/${g}`;
  if (moveCache.has(key)) return moveCache.get(key);
  const open = { pos: V0(), h, g };
  const moves = [];
  for (const type of MOVE_TYPES) {
    for (const cand of placements(type, open)) {
      const ports = worldPorts({ ...cand, id: -1 });
      const other = ports.find((p, i) => i !== cand.attach);
      moves.push({ cand, dv: other.pos, h: other.h, g: other.g, curve: type === 'R-03', adapter: type === 'R-20' && cand.g !== 0 });
    }
  }
  moveCache.set(key, moves);
  return moves;
}

const skey = (pos, h, g) => `${vkey(pos)}/${h}/${g}`;

function expand(start, depth) {
  // 各状態に最初に到達した手順を 1 つだけ保持
  const map = new Map();
  map.set(skey(start.pos, start.h, start.g), { pos: start.pos, h: start.h, g: start.g, d: 0, prev: null, move: null });
  let frontier = [...map.values()];
  for (let d = 1; d <= depth; d++) {
    const next = [];
    for (const st of frontier) {
      for (const mv of movesFor(st.h, st.g)) {
        const pos = vadd(st.pos, mv.dv);
        const k = skey(pos, mv.h, mv.g);
        if (map.has(k)) continue;
        const ns = { pos, h: mv.h, g: mv.g, d, prev: st, move: mv, base: st.pos };
        map.set(k, ns);
        next.push(ns);
      }
    }
    frontier = next;
  }
  return map;
}

function chain(st) {
  const seq = [];
  while (st && st.move) {
    seq.push({ ...st.move.cand, t: vadd(st.move.cand.t, st.base), curve: st.move.curve, adapter: st.move.adapter });
    st = st.prev;
  }
  return seq.reverse();
}

// a, b: 開放端 {pos, h, g}。返り値: 候補の配列（各候補はパーツ配置候補の配列）
export function findRoutes(layout, a, b, { depth = 6, maxCandidates = 30 } = {}) {
  const A = expand(a, depth);
  const B = expand(b, depth);
  const matches = [];
  for (const sa of A.values()) {
    const sb = B.get(skey(sa.pos, hmod(sa.h + 4), opp(sa.g)));
    if (!sb) continue;
    if (sa.d + sb.d === 0) continue;
    matches.push([sa, sb]);
  }
  const score = (seq) => seq.length * 100 + seq.filter((c) => c.adapter).length * 10 + seq.filter((c) => c.curve).length;
  const cands = matches.map(([sa, sb]) => [...chain(sa), ...chain(sb)]);
  cands.sort((x, y) => score(x) - score(y));
  const topo = layout.topology();
  const out = [];
  const seen = new Set();
  for (const seq of cands) {
    const key = seq.map((c) => `${c.type}${vkey(c.t)}${c.r}${c.m}${c.g}`).sort().join(';');
    if (seen.has(key)) continue;
    seen.add(key);
    const extra = seq.map((c, i) => {
      const p = { ...c, id: -(i + 1) };
      return { id: p.id, ports: worldPorts(p), paths: worldPaths(p) };
    });
    const ov = findOverlaps(layout.parts, topo.geo, topo.conn, extra);
    if (ov.some(([i, j]) => i < 0 || j < 0)) continue;
    out.push(seq);
    if (out.length >= maxCandidates) break;
  }
  return out;
}
