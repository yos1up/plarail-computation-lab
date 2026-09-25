// プラレール計算機シミュレータ — 幾何・パーツ・レイアウトのコア（DOM 非依存）
//
// 座標は厳密な整数表現を使う。位置ベクトルは 45° 刻みの単位ベクトル
//   e0=(1,0), e1=(√½,√½), e2=(0,1), e3=(-√½,√½)   (e_{k+4} = -e_k)
// の整数係数 [c0,c1,c2,c3] で表す。長さの単位は 1/4 直線 (= 54mm)。
// e0..e3 は有理数上一次独立なので「係数が完全一致 ⇔ 幾何的に厳密に一致」。
// 曲線レールの半径は直線レール 1 本分 (R = L = 216mm) という理想化グリッドを仮定する。

export const Q_MM = 54;           // 1/4 直線の長さ [mm]
export const L_MM = 4 * Q_MM;     // 直線レール (216mm)
export const R_Q = 4;             // 曲線半径 [1/4 単位]
export const R_MM = R_Q * Q_MM;   // 曲線半径 [mm]
const SQ = Math.SQRT1_2;

// ---------- 厳密ベクトル ----------
export const V0 = () => [0, 0, 0, 0];
export const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
export const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
export const vscale = (a, k) => [a[0] * k, a[1] * k, a[2] * k, a[3] * k];
export const veq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
export const vkey = (a) => a.join(',');
export const hmod = (h) => ((h % 8) + 8) % 8;
export function unit(k) {
  k = hmod(k);
  const v = [0, 0, 0, 0];
  if (k < 4) v[k] = 1; else v[k - 4] = -1;
  return v;
}
export function vrot(v, r) {
  r = hmod(r);
  for (let i = 0; i < r; i++) v = [-v[3], v[0], v[1], v[2]];
  return v;
}
// x 軸に関する鏡映 (e_i -> e_{-i})
export const vmirror = (v) => [v[0], -v[3], -v[2], -v[1]];
export function vfloat(v) {
  return { x: (v[0] + (v[1] - v[3]) * SQ) * Q_MM, y: (v[2] + (v[1] + v[3]) * SQ) * Q_MM };
}
// 進行方向 k で左/右に 45° 曲がる曲線レールの変位
export const curveL = (k) => vscale(vadd(unit(k + 2), unit(k - 1)), R_Q);
export const curveR = (k) => vscale(vadd(unit(k - 2), unit(k + 1)), R_Q);

// ---------- パーツ定義 ----------
// ローカル座標: ポート0 が原点、外向き方位 4 (=-x)。パーツは +x 側へ伸びる。
// ports[i] = { p: 厳密位置, h: 外向き方位 }。genders[g][i] は 'M'(凸) / 'F'(凹)。
// paths = { a, b, geo }  geo: line(len) | arc(dir: +1 左 / -1 右)
const ARC_LEN = (R_MM * Math.PI) / 4;
const straightDef = (q, name, extra = {}) => ({
  name,
  ports: [{ p: V0(), h: 4 }, { p: [q, 0, 0, 0], h: 0 }],
  paths: [{ a: 0, b: 1, geo: { kind: 'line', len: q * Q_MM } }],
  genders: [['F', 'M']],
  mirror: false,
  ...extra,
});
const turnoutPorts = [
  { p: V0(), h: 4 },
  { p: [R_Q, 0, 0, 0], h: 0 },
  { p: curveL(0), h: 1 },
];
export const PARTS = {
  'R-01': straightDef(4, '直線レール'),
  'R-02': straightDef(2, '1/2直線レール'),
  'R-03': {
    name: '曲線レール',
    ports: [{ p: V0(), h: 4 }, { p: curveL(0), h: 1 }],
    paths: [{ a: 0, b: 1, geo: { kind: 'arc', dir: 1, len: ARC_LEN } }],
    genders: [['F', 'M']],
    mirror: true,
  },
  'R-08': straightDef(4, 'ストップレール', { stop: true }),
  'R-11': {
    name: 'ターンアウトレール',
    ports: turnoutPorts,
    paths: [
      { a: 0, b: 1, geo: { kind: 'line', len: L_MM } },
      { a: 0, b: 2, geo: { kind: 'arc', dir: 1, len: ARC_LEN } },
    ],
    genders: [['M', 'F', 'F'], ['F', 'M', 'M']],
    mirror: true,
    switch: true,
    branchNames: ['直進', '分岐'],
  },
  'R-12': {
    name: '8の字ポイントレール',
    ports: [
      { p: V0(), h: 4 },
      { p: curveL(0), h: 1 },
      { p: curveR(0), h: 7 },
    ],
    paths: [
      { a: 0, b: 1, geo: { kind: 'arc', dir: 1, len: ARC_LEN } },
      { a: 0, b: 2, geo: { kind: 'arc', dir: -1, len: ARC_LEN } },
    ],
    genders: [['M', 'F', 'F'], ['F', 'M', 'M']],
    mirror: false,
    switch: true,
    branchNames: ['左', '右'],
  },
  'R-20': {
    ...straightDef(1, '1/4直線レール'),
    genders: [['F', 'M'], ['M', 'M'], ['F', 'F']],
  },
};
// R-11 のポイントを固定したもの（同じ形状、状態が変わらない）
PARTS['R-11F'] = { ...PARTS['R-11'], name: 'ターンアウト(固定)', fixed: true };

export const PART_ORDER = ['R-01', 'R-02', 'R-20', 'R-03', 'R-08', 'R-11', 'R-11F', 'R-12'];
export const isSwitch = (type) => !!PARTS[type].switch;
export const opp = (g) => (g === 'M' ? 'F' : 'M');
export const GENDER_JA = { M: '凸', F: '凹' };

// ---------- ローカル形状のサンプリング ----------
function localPoint(geo, u) {
  if (geo.kind === 'line') return { x: geo.len * u, y: 0, a: 0 };
  const t = (Math.PI / 4) * u;
  return { x: R_MM * Math.sin(t), y: geo.dir * R_MM * (1 - Math.cos(t)), a: geo.dir * t };
}

// ---------- パーツインスタンス ----------
// part = { id, type, m(鏡映), g(性別バリエーション), r(回転), t(厳密並進), props }
function xformVec(part, v) {
  return vadd(vrot(part.m ? vmirror(v) : v, part.r), part.t);
}
function xformHeading(part, h) {
  return hmod((part.m ? -h : h) + part.r);
}
export function worldPorts(part) {
  const def = PARTS[part.type];
  return def.ports.map((pt, i) => ({
    partId: part.id,
    port: i,
    pos: xformVec(part, pt.p),
    h: xformHeading(part, pt.h),
    g: def.genders[part.g][i],
  }));
}
export function xformPointF(part, x, y) {
  if (part.m) y = -y;
  const ang = (part.r * Math.PI) / 4;
  const c = Math.cos(ang), s = Math.sin(ang);
  const o = vfloat(part.t);
  return { x: o.x + c * x - s * y, y: o.y + s * x + c * y };
}
// 各パスを折れ線化 (world mm)。pts[i] = {x,y}, cum[i] = 累積長
export function worldPaths(part) {
  const def = PARTS[part.type];
  return def.paths.map((p) => {
    const n = p.geo.kind === 'line' ? Math.max(2, Math.ceil(p.geo.len / 12)) : 24;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const lp = localPoint(p.geo, i / n);
      pts.push(xformPointF(part, lp.x, lp.y));
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    return { a: p.a, b: p.b, pts, cum, len: p.geo.len };
  });
}
export function pointAt(wp, s) {
  s = Math.max(0, Math.min(wp.len, s));
  const target = (s / wp.len) * wp.cum[wp.cum.length - 1];
  let i = 1;
  while (i < wp.cum.length - 1 && wp.cum[i] < target) i++;
  const c0 = wp.cum[i - 1], c1 = wp.cum[i];
  const f = c1 > c0 ? (target - c0) / (c1 - c0) : 0;
  const A = wp.pts[i - 1], B = wp.pts[i];
  return { x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f, ang: Math.atan2(B.y - A.y, B.x - A.x) };
}

// 開放端 open = {pos, h, g}（g=null なら性別不問）にパーツ type を接続する配置候補
export function placements(type, open) {
  const def = PARTS[type];
  const out = [];
  const seen = new Set();
  for (let g = 0; g < def.genders.length; g++) {
    for (const m of def.mirror ? [false, true] : [false]) {
      for (let k = 0; k < def.ports.length; k++) {
        const gk = def.genders[g][k];
        if (open.g && gk !== opp(open.g)) continue;
        const pk = def.ports[k];
        const hk = m ? -pk.h : pk.h;
        const r = hmod(open.h + 4 - hk);
        const pkv = vrot(m ? vmirror(pk.p) : pk.p, r);
        const t = vsub(open.pos, pkv);
        const cand = { type, m, g, r, t, attach: k };
        const sigs = worldPorts({ ...cand, id: -1 }).map((wp) => `${vkey(wp.pos)}/${wp.h}/${wp.g}`);
        const key = def.switch ? sigs.join('|') : sigs.sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(cand);
      }
    }
  }
  // 自然な順序: 性別標準・鏡映なし・ポート0 接続を優先
  const rank = (c) => (c.attach === 0 ? 0 : 10) + (c.m ? 1 : 0) + c.g * 3;
  out.sort((a, b) => rank(a) - rank(b));
  return out;
}

export function defaultProps(type) {
  const def = PARTS[type];
  if (def.switch) return { state: 0, role: 'aux', label: '', inv: false, ...(def.fixed ? { fixed: 0 } : {}) };
  if (def.stop) return { stop: true };
  return {};
}

// ---------- レイアウト ----------
export class Layout {
  constructor() {
    this.parts = [];
    this.nextId = 1;
    this.train = null; // {partId, pathIdx, dir}
    this.settings = { fixedTrail: 'pass' };
    this._topo = null;
  }
  touch() { this._topo = null; }
  get(id) { return this.parts.find((p) => p.id === id); }
  add(cand, props) {
    const part = {
      id: this.nextId++,
      type: cand.type, m: cand.m, g: cand.g, r: cand.r, t: cand.t.slice(),
      props: props ? { ...props } : defaultProps(cand.type),
    };
    this.parts.push(part);
    this.touch();
    return part;
  }
  remove(id) {
    this.parts = this.parts.filter((p) => p.id !== id);
    if (this.train && this.train.partId === id) this.train = null;
    this.touch();
  }
  // 位置・方位・性別が厳密一致したポート同士のみ接続とみなす
  topology() {
    if (this._topo) return this._topo;
    const byPos = new Map();
    const geo = new Map();
    for (const part of this.parts) {
      geo.set(part.id, { ports: worldPorts(part), paths: worldPaths(part) });
      for (const wp of geo.get(part.id).ports) {
        const k = vkey(wp.pos);
        if (!byPos.has(k)) byPos.set(k, []);
        byPos.get(k).push(wp);
      }
    }
    const conn = new Map();
    const open = [];
    const conflicts = [];
    for (const list of byPos.values()) {
      if (list.length === 1) { open.push(list[0]); continue; }
      if (list.length === 2) {
        const [a, b] = list;
        if (hmod(a.h + 4) === b.h && a.g === opp(b.g) && a.partId !== b.partId) {
          conn.set(`${a.partId}:${a.port}`, b);
          conn.set(`${b.partId}:${b.port}`, a);
          continue;
        }
        let why = '方向が合わない';
        if (hmod(a.h + 4) === b.h) why = `性別が合わない (${GENDER_JA[a.g]}${GENDER_JA[b.g]})`;
        conflicts.push({ ports: list, why });
        continue;
      }
      conflicts.push({ ports: list, why: '3つ以上の端点が同じ位置' });
    }
    const overlaps = findOverlaps(this.parts, geo, conn);
    this._topo = { conn, open, conflicts, overlaps, geo };
    return this._topo;
  }
  neighbor(partId, port) {
    return this.topology().conn.get(`${partId}:${port}`) || null;
  }
  switches() { return this.parts.filter((p) => isSwitch(p.type)); }
  toJSON() {
    return {
      v: 1,
      parts: this.parts.map((p) => ({ id: p.id, type: p.type, m: p.m ? 1 : 0, g: p.g, r: p.r, t: p.t, props: p.props })),
      train: this.train,
      settings: this.settings,
    };
  }
  static fromJSON(o) {
    const L = new Layout();
    for (const p of o.parts || []) {
      if (!PARTS[p.type]) continue;
      L.parts.push({ id: p.id, type: p.type, m: !!p.m, g: p.g || 0, r: hmod(p.r || 0), t: p.t.slice(0, 4), props: { ...defaultProps(p.type), ...(p.props || {}) } });
    }
    L.nextId = L.parts.reduce((m, p) => Math.max(m, p.id), 0) + 1;
    L.train = o.train && L.get(o.train.partId) ? { ...o.train } : null;
    L.settings = { ...L.settings, ...(o.settings || {}) };
    return L;
  }
  clone() { return Layout.fromJSON(JSON.parse(JSON.stringify(this.toJSON()))); }
}

// ---------- 重なり検出（非接続レール同士が近すぎる → 物理的に置けない）----------
export const OVERLAP_MM = 38;
function samplesOf(paths, step = 14) {
  const out = [];
  for (const wp of paths) {
    const n = Math.max(2, Math.ceil(wp.len / step));
    for (let i = 0; i <= n; i++) out.push(pointAt(wp, (wp.len * i) / n));
  }
  return out;
}
export function findOverlaps(parts, geo, conn, extra = null) {
  // extra: 追加候補パーツ [{part, ports, paths}] を既存と照合する場合
  const cell = 50;
  const grid = new Map();
  const entries = [];
  const put = (id, ports, paths) => {
    for (const s of samplesOf(paths)) {
      const k = `${Math.floor(s.x / cell)},${Math.floor(s.y / cell)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push({ id, x: s.x, y: s.y });
      entries.push({ id, x: s.x, y: s.y });
    }
  };
  for (const part of parts) put(part.id, geo.get(part.id).ports, geo.get(part.id).paths);
  const portsOf = new Map(parts.map((p) => [p.id, geo.get(p.id).ports]));
  if (extra) for (const e of extra) { put(e.id, e.ports, e.paths); portsOf.set(e.id, e.ports); }
  // 接続点（共有される端点）の近傍は除外
  const joints = new Map(); // "a|b" -> [{x,y}]
  const allPorts = [...portsOf.values()].flat();
  const byPos = new Map();
  for (const wp of allPorts) {
    const k = vkey(wp.pos);
    if (!byPos.has(k)) byPos.set(k, []);
    byPos.get(k).push(wp);
  }
  for (const list of byPos.values()) {
    if (list.length < 2) continue;
    const f = vfloat(list[0].pos);
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = Math.min(list[i].partId, list[j].partId), b = Math.max(list[i].partId, list[j].partId);
        const key = `${a}|${b}`;
        if (!joints.has(key)) joints.set(key, []);
        joints.get(key).push(f);
      }
  }
  const pairs = new Set();
  const JOINT_R = 70;
  for (const e of entries) {
    const cx = Math.floor(e.x / cell), cy = Math.floor(e.y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(`${cx + dx},${cy + dy}`);
        if (!list) continue;
        for (const o of list) {
          if (o.id <= e.id) continue;
          if (Math.hypot(o.x - e.x, o.y - e.y) >= OVERLAP_MM) continue;
          const key = `${e.id}|${o.id}`;
          if (pairs.has(key)) continue;
          const js = joints.get(key);
          if (js && js.some((j) => Math.hypot(j.x - e.x, j.y - e.y) < JOINT_R && Math.hypot(j.x - o.x, j.y - o.y) < JOINT_R)) continue;
          pairs.add(key);
        }
      }
  }
  return [...pairs].map((k) => k.split('|').map(Number));
}
