// Node 用の小さなレイアウト構築ヘルパ（テスト・サンプル生成で共用）
import { Layout, placements, worldPorts, V0, veq, vfloat } from '../docs/js/core.js';

export function builder() {
  const L = new Layout();
  const attachOf = new Map();
  // open: 次に接続する開放端。pick(cands) で候補を選ぶ
  const api = {
    L,
    first(type, pick = (c) => c[0], props) {
      const c = pick(placements(type, { pos: V0(), h: 4, g: null }));
      const part = L.add(c, props);
      attachOf.set(part.id, c.attach);
      return part;
    },
    // part の port に type をつなぐ。pick で配置候補を選ぶ
    attach(part, port, type, pick = (c) => c[0], props) {
      const wp = worldPorts(part)[port];
      const cands = placements(type, wp);
      const c = pick(cands);
      if (!c) throw new Error(`no placement for ${type}`);
      const part2 = L.add(c, props);
      attachOf.set(part2.id, c.attach);
      return part2;
    },
    // 直前パーツの「接続に使っていない最初の端点」
    freePort(part) {
      const topo = L.topology();
      return worldPorts(part).findIndex((wp) => wp.port !== attachOf.get(part.id) && !topo.conn.has(`${part.id}:${wp.port}`));
    },
    chain(part, port, types) {
      let cur = part, p = port;
      for (const spec of types) {
        const [type, pick] = Array.isArray(spec) ? spec : [spec, undefined];
        cur = api.attach(cur, p, type, pick);
        p = api.freePort(cur);
      }
      return { part: cur, port: p };
    },
  };
  return api;
}
// 曲線の曲がる向きを選ぶ: 'L' or 'R'（開放端の方位に対して）
export const bend = (dir) => (cands) => {
  const c = cands.filter((x) => x.attach === 0 || true);
  // 曲線の他端の方位 = 開放端から見て左なら +1
  return c.find((x) => {
    const ports = worldPorts({ ...x, id: -1 });
    const a = ports[x.attach], o = ports[1 - x.attach];
    const turn = ((o.h - ((a.h + 4) % 8)) + 8) % 8;
    return dir === 'L' ? turn === 1 : turn === 7;
  });
};

// ---- 分岐グラフ形式（tools/data/*.json）からレイアウトを組み立てる ----
// switches: { 名前: { x, y [mm], h: 幹(A)から直進方向の方位, side: 'L'|'R' 曲線側, b0: 'S'|'C' 端点"0"が直進/曲線 } }
// edges[i]: [[名前, 'A'|'0'|'1'], [名前, 端点]]、routes[i]: 1 つ目の端点から出るレール列 (CL/CR/S108/S54)
// deadends: [名前, 端点, レール列]（行き止まり）
// fixed: 論理 0 に固定するポイント（R-11 固定）の名前
// ターンアウトの凸凹は辺ごとの偶奇が合うように割り当て、合わない辺は S108 を「1/4直線(凸凹)+1/4直線(同性)」に置き換えて性別を反転する。
export function fromSwitchGraph(G, { fixed = [] } = {}) {
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
    sw[n] = L.add({ type: fixed.includes(n) ? 'R-11F' : 'R-11', m: s.side === 'R', g: find(n)[1], r: s.h, t: [grid(s.x), 0, grid(s.y), 0] },
      { state: s.b0 === 'C' ? 1 : 0, role: 'aux', label: n, inv: s.b0 === 'C', ...(fixed.includes(n) ? { fixed: s.b0 === 'C' ? 1 : 0 } : {}) }); // 初期状態・固定ポイントは論理 0
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
