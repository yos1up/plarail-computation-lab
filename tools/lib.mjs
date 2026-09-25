// Node 用の小さなレイアウト構築ヘルパ（テスト・サンプル生成で共用）
import { Layout, placements, worldPorts, V0 } from '../docs/js/core.js';

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
