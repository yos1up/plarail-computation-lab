// 走行シミュレーション（DOM 非依存）
import { PARTS, isSwitch } from './core.js';

// パーツ part にポート port から進入したときの経路
// 返り値 {pathIdx, dir, set?: bit, derail?: string}
export function routeThrough(layout, part, port, states) {
  const def = PARTS[part.type];
  if (!def.switch) {
    const p = def.paths[0];
    return { pathIdx: 0, dir: port === p.a ? 1 : -1 };
  }
  if (port === 0) {
    // 対向進入: 状態を読んで B_state へ
    const bit = def.fixed ? part.props.fixed : states[part.id];
    return { pathIdx: bit, dir: 1 };
  }
  // 背向進入: B_j から A へ。ポイントは j に更新される
  const j = port - 1;
  if (def.fixed) {
    if (j !== part.props.fixed && layout.settings.fixedTrail === 'derail')
      return { pathIdx: j, dir: -1, derail: '固定ポイントに開通していない側から進入' };
    return { pathIdx: j, dir: -1 };
  }
  return { pathIdx: j, dir: -1, set: j };
}

export function initialStates(layout, overrides = null) {
  const st = {};
  for (const p of layout.switches()) st[p.id] = PARTS[p.type].fixed ? p.props.fixed : p.props.state;
  if (overrides) Object.assign(st, overrides);
  return st;
}

const exitPortOf = (part, pathIdx, dir) => {
  const p = PARTS[part.type].paths[pathIdx];
  return dir > 0 ? p.b : p.a;
};

// 連続時間シミュレータ（アニメーション用）
export class Sim {
  constructor(layout) {
    this.layout = layout;
    this.reset();
  }
  reset(overrides = null) {
    const L = this.layout;
    this.states = initialStates(L, overrides);
    this.entries = 0;
    this.visited = new Map();
    this.outHist = [];
    this.trail = [];
    this.message = '';
    if (!L.train || !L.get(L.train.partId)) {
      this.pos = null;
      this.status = 'notrain';
      return;
    }
    const part = L.get(L.train.partId);
    const len = PARTS[part.type].paths[L.train.pathIdx].geo.len;
    this.pos = { partId: part.id, pathIdx: L.train.pathIdx, dir: L.train.dir, s: len / 2 };
    this.status = 'ready';
  }
  get halted() { return this.status === 'stopped' || this.status === 'derailed' || this.status === 'notrain'; }
  // 進行距離 ds [mm] だけ進める。maxEntries: 進入回数がこれだけ増えたら止める（ステップ実行用）
  advance(ds, maxEntries = Infinity) {
    if (this.halted) return;
    const L = this.layout;
    const startEntries = this.entries;
    let guard = 0;
    while (ds > 0 && guard++ < 10000) {
      const part = L.get(this.pos.partId);
      const def = PARTS[part.type];
      const len = def.paths[this.pos.pathIdx].geo.len;
      const s0 = this.pos.s;
      const s1 = s0 + ds;
      if (def.stop && part.props.stop && s0 < len / 2 && s1 >= len / 2) {
        this.pos.s = len / 2;
        this.status = 'stopped';
        this.message = 'ストップレールで停止';
        return;
      }
      if (s1 < len) { this.pos.s = s1; return; }
      ds = s1 - len;
      this.pos.s = len;
      if (this.entries - startEntries >= maxEntries) return;
      const exitPort = exitPortOf(part, this.pos.pathIdx, this.pos.dir);
      const nb = L.neighbor(part.id, exitPort);
      if (!nb) {
        if (haltOnCycle(L)) {
          this.status = 'stopped';
          this.message = '終端に到達して計算終了';
        } else {
          this.status = 'derailed';
          this.message = '線路の端から脱線';
        }
        return;
      }
      const np = L.get(nb.partId);
      const r = routeThrough(L, np, nb.port, this.states);
      this.trail.push({ partId: part.id, pathIdx: this.pos.pathIdx, dir: this.pos.dir });
      if (this.trail.length > 8) this.trail.shift();
      this.entries++;
      if (r.set !== undefined) this.states[np.id] = r.set;
      this.pos = { partId: np.id, pathIdx: r.pathIdx, dir: r.dir, s: 0 };
      if (r.derail) {
        this.status = 'derailed';
        this.message = r.derail;
        return;
      }
      if (haltOnCycle(L)) {
        const key = `${np.id}:${nb.port}:${Object.values(this.states).join('')}`;
        const outKey = L.switches().filter((p) => p.props.role === 'out').map((p) => this.states[p.id]).join('');
        if (this.visited.has(key)) {
          if (this.outHist.slice(this.visited.get(key)).every((k) => k === outKey)) {
            this.status = 'stopped';
            this.message = '周回軌道に入ったので計算終了';
          } else {
            this.status = 'derailed';
            this.message = '周回中に出力が変化する（計算失敗）';
          }
          return;
        }
        this.visited.set(key, this.outHist.length);
        this.outHist.push(outKey);
      }
      if (this.entries - startEntries >= maxEntries) return;
    }
  }
}

// 終了条件: settings.halt
//   'stop'  … ストップレールでの停止のみ成功（終端=脱線、周回=停止しない は失敗）
//   'cycle' … ストップレールに加え、終端に到達するか周回軌道に入った時点でも計算終了とする
export const haltOnCycle = (layout) => layout.settings.halt === 'cycle';
// 結果が計算成功（出力を読んでよい）か
export const isSuccess = (result) => result === 'stopped' || result === 'end' || result === 'cycle';

// 離散シミュレーション: 停止/脱線/無限ループを判定する
// halt='cycle' のとき、終端到達は 'end'、周回軌道への突入は 'cycle'（周回中に出力が変化する場合は 'loop'）
export function runDiscrete(layout, overrides = null, maxSteps = 200000) {
  const L = layout;
  const states = initialStates(L, overrides);
  if (!L.train || !L.get(L.train.partId)) return { result: 'notrain', states, steps: 0 };
  const cyc = haltOnCycle(L);
  let part = L.get(L.train.partId);
  let pathIdx = L.train.pathIdx, dir = L.train.dir;
  const swIds = L.switches().filter((p) => !PARTS[p.type].fixed).map((p) => p.id);
  const outIds = L.switches().filter((p) => p.props.role === 'out').map((p) => p.id);
  const seen = new Map();
  const outHist = [];
  for (let steps = 0; steps < maxSteps; steps++) {
    const exitPort = exitPortOf(part, pathIdx, dir);
    const nb = L.neighbor(part.id, exitPort);
    if (!nb) {
      if (cyc) return { result: 'end', states, steps, message: '終端に到達' };
      return { result: 'derailed', states, steps, message: '線路の端から脱線' };
    }
    const np = L.get(nb.partId);
    const r = routeThrough(L, np, nb.port, states);
    if (r.set !== undefined) states[np.id] = r.set;
    if (r.derail) return { result: 'derailed', states, steps: steps + 1, message: r.derail };
    part = np; pathIdx = r.pathIdx; dir = r.dir;
    if (PARTS[part.type].stop && part.props.stop) return { result: 'stopped', states, steps: steps + 1, stopAt: part.id };
    const key = `${part.id}:${nb.port}:${swIds.map((id) => states[id]).join('')}`;
    const outKey = outIds.map((id) => states[id]).join('');
    if (seen.has(key)) {
      if (!cyc) return { result: 'loop', states, steps: steps + 1 };
      const stable = outHist.slice(seen.get(key)).every((k) => k === outKey);
      if (!stable) return { result: 'loop', states, steps: steps + 1, message: '周回中に出力が変化する' };
      return { result: 'cycle', states, steps: steps + 1, cycleLength: steps - seen.get(key), message: '周回軌道に入った' };
    }
    seen.set(key, steps);
    outHist.push(outKey);
  }
  return { result: 'limit', states, steps: maxSteps };
}

// ビット表示: inv=true のときは状態を反転して解釈
export const bitOf = (part, state) => (part.props.inv ? 1 - state : state);

export function ioSwitches(layout) {
  const byLabel = (a, b) => (a.props.label || '').localeCompare(b.props.label || '', 'ja', { numeric: true }) || a.id - b.id;
  const sw = layout.switches();
  return {
    inputs: sw.filter((p) => p.props.role === 'in' && !PARTS[p.type].fixed).sort(byLabel),
    outputs: sw.filter((p) => p.props.role === 'out').sort(byLabel),
  };
}

export function truthTable(layout, maxInputs = 12) {
  const { inputs, outputs } = ioSwitches(layout);
  if (inputs.length > maxInputs) throw new Error(`入力が多すぎます (${inputs.length} > ${maxInputs})`);
  const rows = [];
  for (let x = 0; x < 1 << inputs.length; x++) {
    const ov = {};
    const inBits = inputs.map((p, i) => {
      const b = (x >> (inputs.length - 1 - i)) & 1;
      ov[p.id] = p.props.inv ? 1 - b : b;
      return b;
    });
    const res = runDiscrete(layout, ov);
    const outBits = outputs.map((p) => bitOf(p, res.states[p.id]));
    rows.push({ inBits, outBits, result: res.result, steps: res.steps, message: res.message });
  }
  return { inputs, outputs, rows };
}

export { isSwitch };
