// プラレール計算機シミュレータ — UI
import {
  Layout, PARTS, PART_ORDER, GENDER_JA, placements, worldPorts, worldPaths as worldPathsOf, pointAt, vfloat, vrot, hmod, L_MM,
} from './core.js';
import { Sim, truthTable, ioSwitches, bitOf, initialStates } from './sim.js';
import { findRoutes } from './route.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#canvas');
const ctx = canvas.getContext('2d');
const panel = $('#panel');
const STORAGE_KEY = 'plarail-sim-layout-v1';

// ---------- アプリ状態 ----------
let layout = new Layout();
let sim = new Sim(layout);
let simActive = false;     // 走行を開始済み（シミュレーション上の状態を表示）
let running = false;
let sel = null;            // {kind:'port', port} | {kind:'part', id}
let pending = null;        // 直前に置いたパーツの向き切替 {partId, open, cands, idx}
let routeMode = null;      // {stage:'pick'|'preview', a, cands, idx}
let view = { cx: 0, cy: 0, scale: 0.6 }; // px / mm
let undoStack = [];
let examples = {};
let dirty = true;

// ---------- 永続化 ----------
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout.toJSON())); } catch (e) { /* ignore */ }
}
function pushUndo() {
  undoStack.push(JSON.stringify(layout.toJSON()));
  if (undoStack.length > 200) undoStack.shift();
}
function undo() {
  if (!undoStack.length) return toast('これ以上戻せません');
  layout = Layout.fromJSON(JSON.parse(undoStack.pop()));
  pending = null; sel = null; routeMode = null;
  afterChange();
}
function afterChange() {
  layout.touch();
  resetSim();
  save();
  refresh();
}
function setLayout(L, fit = true) {
  layout = L;
  pending = null; sel = null; routeMode = null;
  resetSim();
  save();
  if (fit) fitView();
  refresh();
}
function resetSim() {
  sim = new Sim(layout);
  simActive = false;
  running = false;
}

// ---------- 表示補助 ----------
let toastTimer = null;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const curStates = () => (simActive ? sim.states : initialStates(layout));
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// ---------- 座標変換 ----------
let W = 0, H = 0, DPR = 1, ready = false;
function resize() {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (r.width === W && r.height === H && dpr === DPR) return;
  DPR = dpr;
  W = r.width; H = r.height;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  dirty = true;
  // canvas.width の再設定で内容が消えるため、ちらつかないよう即座に描き直す
  if (ready) render();
}
// ポインタ位置を canvas 基準の CSS px で得る（offsetX はブラウザ差があるため使わない）
function localXY(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
const toScreen = (p) => ({ x: (p.x - view.cx) * view.scale + W / 2, y: -(p.y - view.cy) * view.scale + H / 2 });
const toWorld = (x, y) => ({ x: (x - W / 2) / view.scale + view.cx, y: -(y - H / 2) / view.scale + view.cy });
function fitView() {
  const pts = [];
  const topo = layout.topology();
  for (const g of topo.geo.values()) for (const wp of g.paths) pts.push(...wp.pts);
  if (!pts.length) { view = { cx: 0, cy: 0, scale: 0.6 }; dirty = true; return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const pad = 120;
  view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2;
  view.scale = Math.min(W / (x1 - x0 + pad * 2), H / (y1 - y0 + pad * 2), 2.5);
  dirty = true;
}
function zoomAt(sx, sy, f) {
  const before = toWorld(sx, sy);
  view.scale = Math.min(6, Math.max(0.05, view.scale * f));
  const after = toWorld(sx, sy);
  view.cx += before.x - after.x; view.cy += before.y - after.y;
  dirty = true;
}

// ---------- 描画 ----------
function strokePath(pts, width, color, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, width * view.scale);
  ctx.beginPath();
  pts.forEach((p, i) => { const s = toScreen(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
  ctx.stroke();
  ctx.globalAlpha = 1;
}
function drawRail(pts, { alpha = 1, color = '#3f8ed8', groove = '#2a64a8' } = {}) {
  ctx.lineCap = 'butt';
  strokePath(pts, 42, color, alpha);
  strokePath(pts, 28, groove, alpha);
  strokePath(pts, 12, color, alpha);
}
function activePathIdx(part, states) {
  const def = PARTS[part.type];
  if (!def.switch) return 0;
  return def.fixed ? part.props.fixed : states[part.id];
}
function drawPart(part, g, states, opts = {}) {
  const def = PARTS[part.type];
  const color = opts.color || (opts.overlap ? '#d9534f' : '#3f8ed8');
  const groove = opts.groove || (opts.overlap ? '#a33430' : '#2a64a8');
  const act = activePathIdx(part, states);
  if (opts.glow) for (const wp of g.paths) strokePath(wp.pts, 64, opts.glow, 0.55);
  g.paths.forEach((wp, i) => { if (i !== act) drawRail(wp.pts, { alpha: (opts.alpha ?? 1) * 0.45, color, groove }); });
  drawRail(g.paths[act].pts, { alpha: opts.alpha ?? 1, color, groove });
  if (def.stop) {
    const wp = g.paths[0];
    const m = pointAt(wp, wp.len / 2);
    const s = toScreen(m);
    ctx.save();
    ctx.translate(s.x, s.y); ctx.rotate(-m.ang);
    ctx.fillStyle = part.props.stop ? '#e53935' : '#9aa5b1';
    const w = 10 * view.scale, h = 52 * view.scale;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
  if (def.switch) {
    // 開通方向を示す黄色い矢印
    const wp = g.paths[act];
    const m = pointAt(wp, 70);
    const s = toScreen(m);
    ctx.save();
    ctx.translate(s.x, s.y); ctx.rotate(-m.ang);
    const k = Math.max(5, 16 * view.scale);
    ctx.fillStyle = def.fixed ? '#9aa5b1' : '#ffd21f';
    ctx.strokeStyle = '#6b5200'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(-k * 0.7, -k * 0.8); ctx.lineTo(-k * 0.7, k * 0.8); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
function drawLabel(part, g, states) {
  const def = PARTS[part.type];
  if (!def.switch) return;
  const role = part.props.role;
  const a = g.ports[0].pos, p1 = vfloat(g.ports[1].pos), p2 = vfloat(g.ports[2].pos), p0 = vfloat(a);
  let c = { x: (p0.x + p1.x + p2.x) / 3, y: (p0.y + p1.y + p2.y) / 3 };
  if (part.type !== 'R-12') {
    // ターンアウトは分岐と反対側にずらしてレールを隠さない
    const fx = p1.x - p0.x, fy = p1.y - p0.y, fl = Math.hypot(fx, fy);
    let nx = -fy / fl, ny = fx / fl;
    if (nx * (p2.x - p0.x) + ny * (p2.y - p0.y) > 0) { nx = -nx; ny = -ny; }
    c = { x: p0.x + fx * 0.5 + nx * 62, y: p0.y + fy * 0.5 + ny * 62 };
  }
  const s = toScreen(c);
  const bit = def.fixed ? `固定${part.props.fixed}` : bitOf(part, states[part.id]);
  const name = part.props.label || (role === 'aux' ? '' : '?');
  const text = name ? `${name}=${bit}` : `${bit}`;
  ctx.font = `${Math.max(11, Math.min(18, 34 * view.scale))}px system-ui, sans-serif`;
  const tw = ctx.measureText(text).width;
  const bg = role === 'in' ? cssVar('--in') : role === 'out' ? cssVar('--out') : 'rgba(40,40,40,.72)';
  ctx.fillStyle = bg;
  const h = Math.max(16, Math.min(24, 44 * view.scale));
  ctx.beginPath();
  ctx.roundRect(s.x - tw / 2 - 6, s.y - h / 2, tw + 12, h, 6);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, s.x, s.y + 1);
}
function drawPort(wp, { selected = false, color = '#ffffff' } = {}) {
  const p = toScreen(vfloat(wp.pos));
  const r = Math.max(7, 16 * view.scale);
  const ang = (wp.h * Math.PI) / 4;
  if (selected) {
    ctx.fillStyle = 'rgba(255,140,0,.35)';
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = selected ? '#ff8c00' : '#1e4f8a';
  ctx.lineWidth = 2.5;
  // 外向き方位の短い矢印
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(ang) * r * 1.8, p.y - Math.sin(ang) * r * 1.8); ctx.stroke();
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = wp.g === 'M' ? (selected ? '#ff8c00' : '#1e4f8a') : color;
  ctx.fill(); ctx.stroke();
}
function trainPoints() {
  if (!sim.pos) return [];
  const BODY = 130;
  const topo = layout.topology();
  const segs = [{ ...sim.pos }, ...sim.trail.slice().reverse().map((t) => ({ ...t, s: PARTS[layout.get(t.partId)?.type]?.paths[t.pathIdx].geo.len }))];
  const out = [];
  for (let d = 0; d <= BODY; d += 8) {
    let rem = d;
    let pt = null;
    for (const sg of segs) {
      const g = topo.geo.get(sg.partId);
      if (!g) break;
      const wp = g.paths[sg.pathIdx];
      if (rem <= sg.s || sg === segs[segs.length - 1]) {
        const tp = Math.max(0, sg.s - rem);
        pt = pointAt(wp, sg.dir > 0 ? tp : wp.len - tp);
        break;
      }
      rem -= sg.s;
    }
    if (pt) out.push(pt);
  }
  return out;
}
function drawTrain() {
  const pts = trainPoints();
  if (pts.length < 2) return;
  ctx.lineCap = 'round';
  strokePath(pts, 34, '#8e1b1b');
  strokePath(pts, 28, sim.status === 'derailed' ? '#777' : '#e53935');
  const h = toScreen(pts[0]);
  ctx.fillStyle = '#ffe66d';
  ctx.beginPath(); ctx.arc(h.x, h.y, Math.max(3, 8 * view.scale), 0, Math.PI * 2); ctx.fill();
  ctx.lineCap = 'butt';
}
function drawGrid() {
  const step = L_MM;
  if (step * view.scale < 14) return;
  const a = toWorld(0, H), b = toWorld(W, 0);
  ctx.fillStyle = cssVar('--grid');
  const r = Math.max(1, 2.2 * Math.min(1, view.scale));
  for (let x = Math.floor(a.x / step) * step; x <= b.x; x += step)
    for (let y = Math.floor(a.y / step) * step; y <= b.y; y += step) {
      const s = toScreen({ x, y });
      ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
    }
}
function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = cssVar('--bg');
  ctx.fillRect(0, 0, W, H);
  drawGrid();
  const topo = layout.topology();
  const states = curStates();
  const overlapIds = new Set(topo.overlaps.flat());
  const selId = sel && sel.kind === 'part' ? sel.id : pending ? pending.partId : null;
  for (const part of layout.parts) {
    const g = topo.geo.get(part.id);
    drawPart(part, g, states, { overlap: overlapIds.has(part.id), glow: part.id === selId ? 'rgba(255,140,0,.6)' : null });
  }
  // 接続部の目地
  for (const [k, wp] of topo.conn) {
    const [id, port] = k.split(':').map(Number);
    if (id > wp.partId) continue;
    const p = toScreen(vfloat(wp.pos));
    const ang = (wp.h * Math.PI) / 4 + Math.PI / 2;
    const d = 21 * view.scale;
    ctx.strokeStyle = '#1e4f8a'; ctx.lineWidth = Math.max(1, 3 * view.scale);
    ctx.beginPath(); ctx.moveTo(p.x - Math.cos(ang) * d, p.y + Math.sin(ang) * d); ctx.lineTo(p.x + Math.cos(ang) * d, p.y - Math.sin(ang) * d); ctx.stroke();
  }
  // 経路探索プレビュー
  if (routeMode && routeMode.stage === 'preview') {
    const seq = routeMode.cands[routeMode.idx];
    seq.forEach((c, i) => {
      const part = { ...c, id: -(i + 1), props: {} };
      drawPart(part, { paths: worldPathsOf(part), ports: worldPorts(part) }, {}, { alpha: 0.75, color: '#ff9f1c', groove: '#c46f00' });
    });
  }
  for (const part of layout.parts) drawLabel(part, topo.geo.get(part.id), states);
  // 開放端・衝突
  const selPort = sel && sel.kind === 'port' ? sel.port : null;
  const routeA = routeMode ? routeMode.a : null;
  for (const wp of topo.open) {
    const isSel = (selPort && selPort.partId === wp.partId && selPort.port === wp.port) || (routeA && routeA.partId === wp.partId && routeA.port === wp.port);
    drawPort(wp, { selected: isSel });
  }
  for (const c of topo.conflicts) {
    const p = toScreen(vfloat(c.ports[0].pos));
    const r = Math.max(8, 18 * view.scale);
    ctx.strokeStyle = '#d33a2c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p.x - r * 0.6, p.y - r * 0.6); ctx.lineTo(p.x + r * 0.6, p.y + r * 0.6);
    ctx.moveTo(p.x + r * 0.6, p.y - r * 0.6); ctx.lineTo(p.x - r * 0.6, p.y + r * 0.6); ctx.stroke();
  }
  if (!layout.parts.length) {
    ctx.fillStyle = cssVar('--muted');
    ctx.font = '15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('下のパレットから最初のレールを置いてください', W / 2, H / 2);
  }
  drawTrain();
  dirty = false;
}
// ---------- ステータス ----------
function statusText() {
  if (sim.status === 'notrain') return ['列車未配置（レールを選んで「列車を置く」）', ''];
  if (sim.status === 'stopped') return [`停止: ${sim.message}（通過 ${sim.entries} 本）`, 'stopped'];
  if (sim.status === 'derailed') return [`脱線: ${sim.message}（通過 ${sim.entries} 本）`, 'derailed'];
  if (running) return [`走行中（通過 ${sim.entries} 本）`, ''];
  if (simActive) return [`一時停止（通過 ${sim.entries} 本）`, ''];
  return ['準備完了', ''];
}
function updateStatus() {
  const [t, cls] = statusText();
  const st = $('#status');
  st.textContent = t;
  st.className = cls;
  const { inputs, outputs } = ioSwitches(layout);
  const states = curStates();
  const fmt = (p, c) => `<span class="${c}">${esc(p.props.label || '#' + p.id)}=${bitOf(p, states[p.id])}</span>`;
  $('#bits').innerHTML = [...inputs.map((p) => fmt(p, 'in')), ...outputs.map((p) => fmt(p, 'out'))].join(' ');
  const topo = layout.topology();
  const issues = [];
  if (topo.overlaps.length) issues.push(`重なり ${topo.overlaps.length}`);
  if (topo.conflicts.length) issues.push(`接続不可 ${topo.conflicts.length}`);
  if (issues.length) $('#bits').innerHTML += ` <span class="warn">⚠ ${issues.join(' / ')}</span>`;
  $('#btn-play').textContent = running ? '⏸' : '▶';
  $('#btn-play').setAttribute('aria-label', running ? '一時停止' : '再生');
}

// ---------- パネル ----------
const ICON = {
  'R-01': '<path d="M4 14H40"/>',
  'R-02': '<path d="M13 14H31"/>',
  'R-20': '<path d="M18 14H26"/>',
  'R-03': '<path d="M6 22A30 30 0 0 1 36 8"/>',
  'R-08': '<path d="M4 14H40"/><path d="M22 6V22" stroke="#e53935"/>',
  'R-11': '<path d="M4 18H40"/><path d="M4 18Q24 18 38 6"/>',
  'R-11F': '<path d="M4 18H40"/><path d="M4 18Q24 18 38 6" stroke-dasharray="3 3"/><circle cx="12" cy="18" r="3" fill="#e53935" stroke="none"/>',
  'R-12': '<path d="M4 14Q24 14 38 3"/><path d="M4 14Q24 14 38 25"/>',
};
const paletteHTML = () => `<div class="palette">${PART_ORDER.map((t) => `
  <button data-act="place" data-type="${t}" title="${esc(PARTS[t].name)}">
    <svg viewBox="0 0 44 28" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round">${ICON[t]}</svg>
    <b>${t === 'R-11F' ? 'R-11固定' : t}</b><small>${esc(PARTS[t].name)}</small>
  </button>`).join('')}</div>`;

function partPanel(part) {
  const def = PARTS[part.type];
  let h = `<h3>${part.type === 'R-11F' ? 'R-11(固定)' : part.type} ${esc(def.name)} <small class="hint">#${part.id}</small></h3>`;
  if (def.switch) {
    const names = def.branchNames;
    if (def.fixed) {
      h += `<div class="row"><span class="lbl">固定方向</span>${[0, 1].map((b) => `<button data-act="fixed" data-v="${b}" class="${part.props.fixed === b ? 'on' : ''}">${names[b]}</button>`).join('')}</div>`;
    } else {
      const st = part.props.state;
      h += `<div class="row"><span class="lbl">初期状態</span>${[0, 1].map((b) => `<button data-act="state" data-v="${b}" class="${st === b ? 'on' : ''}">${names[b]}（ビット ${bitOf(part, b)}）</button>`).join('')}</div>`;
    }
    h += `<div class="row"><span class="lbl">役割</span>${[['aux', '補助'], ['in', '入力'], ['out', '出力']].map(([v, n]) => `<button data-act="role" data-v="${v}" class="${part.props.role === v ? 'on' : ''}" ${def.fixed && v === 'in' ? 'disabled' : ''}>${n}</button>`).join('')}</div>`;
    h += `<div class="row"><span class="lbl">名前</span><input type="text" id="lbl-input" value="${esc(part.props.label)}" placeholder="例: x1"><label><input type="checkbox" id="inv-input" ${part.props.inv ? 'checked' : ''}> ビット反転（${names[0]}=1）</label></div>`;
  }
  if (def.stop) {
    h += `<div class="row"><span class="lbl">レバー</span><button data-act="stop" data-v="1" class="${part.props.stop ? 'on' : ''}">停止させる</button><button data-act="stop" data-v="0" class="${!part.props.stop ? 'on' : ''}">通過させる</button></div>`;
  }
  const row = [];
  if (!def.switch) {
    const onIt = layout.train && layout.train.partId === part.id;
    row.push(`<button data-act="train">🚃 ${onIt ? '列車の向きを反転' : '列車をここに置く'}</button>`);
  }
  row.push('<button data-act="delete" class="danger">🗑 削除</button>');
  h += `<div class="row">${row.join('')}</div>`;
  return h;
}
function refreshPanel() {
  let h = '';
  if (routeMode && routeMode.stage === 'pick') {
    h = `<h3>経路探索</h3><p class="hint">接続先の端点（○/●）をタップしてください。直線・1/2・1/4・曲線を最大 12 本まで使って、厳密に閉じる経路を探します。</p><div class="row"><button data-act="route-cancel">キャンセル</button></div>`;
  } else if (routeMode && routeMode.stage === 'preview') {
    const seq = routeMode.cands[routeMode.idx];
    const cnt = {};
    for (const c of seq) { const k = c.type === 'R-20' && c.g ? (c.g === 1 ? 'R-20(凸凸)' : 'R-20(凹凹)') : c.type; cnt[k] = (cnt[k] || 0) + 1; }
    h = `<h3>経路候補 ${routeMode.idx + 1} / ${routeMode.cands.length}（${seq.length} 本）</h3>
      <p class="hint">${Object.entries(cnt).map(([k, v]) => `${k}×${v}`).join('、')}</p>
      <div class="row"><button data-act="route-prev">◀ 前</button><button data-act="route-next">次 ▶</button><button data-act="route-ok" class="primary">採用</button><button data-act="route-cancel">キャンセル</button></div>`;
  } else if (pending || (sel && sel.kind === 'port')) {
    if (pending) {
      const part = layout.get(pending.partId);
      h += `<h3>${part.type === 'R-11F' ? 'R-11(固定)' : part.type} ${esc(PARTS[part.type].name)} を配置</h3>
        <div class="row"><button data-act="cycle">↻ 向き ${pending.idx + 1}/${pending.cands.length}</button><button data-act="unplace">✕ 取り消し</button><button data-act="select-pending">⚙ 設定</button></div>`;
      if (sel) h += '<p class="hint">続けてパレットを押すと、この先の端点につながります。</p>';
    } else {
      h += `<h3>端点（${GENDER_JA[sel.port.g]}）に接続</h3>`;
    }
    if (sel) {
      h += paletteHTML();
      h += '<div class="row"><button data-act="route">🔍 経路探索（別の端点まで自動でつなぐ）</button></div>';
    }
  } else if (sel && sel.kind === 'part' && layout.get(sel.id)) {
    h = partPanel(layout.get(sel.id));
  } else if (!layout.parts.length) {
    h = `<h3>最初のレール</h3>${paletteHTML()}<p class="hint">または ☰ メニューからサンプルを読み込めます。</p>`;
  } else {
    h = '<p class="hint">端点（○=凹 / ●=凸）をタップしてレールをつなぐ・レールをタップして設定・ドラッグで移動・ピンチ/ホイールで拡大縮小。</p>';
  }
  panel.innerHTML = h;
  const li = $('#lbl-input');
  if (li) li.addEventListener('change', () => {
    const part = layout.get(sel.id);
    pushUndo(); part.props.label = li.value.trim(); afterChange();
  });
  const inv = $('#inv-input');
  if (inv) inv.addEventListener('change', () => {
    const part = layout.get(sel.id);
    pushUndo(); part.props.inv = inv.checked; afterChange();
  });
}
function refresh() {
  refreshPanel();
  updateStatus();
  dirty = true;
}

// ---------- 編集操作 ----------
const FIRST_OPEN = { pos: [0, 0, 0, 0], h: 0, g: null, partId: null, port: null };
function nextOpenOf(partId, exclude) {
  const topo = layout.topology();
  return topo.open.find((o) => o.partId === partId && o.port !== exclude) || null;
}
function placeAt(open, type) {
  const cands = placements(type, open);
  if (!cands.length) return toast(`この端点（${GENDER_JA[open.g]}）には ${type} を接続できません`);
  pushUndo();
  const part = layout.add(cands[0]);
  pending = { partId: part.id, open, cands, idx: 0 };
  afterPlace(part, cands[0].attach);
}
function afterPlace(part, attach) {
  afterChange();
  const nx = nextOpenOf(part.id, attach);
  const topo = layout.topology();
  const ov = topo.overlaps.some((p) => p.includes(part.id));
  sel = nx ? { kind: 'port', port: nx } : null;
  if (!nx && !ov && topo.conflicts.length === 0) toast('✓ ぴったり閉じました');
  else if (ov) toast('⚠ 既存のレールと重なっています');
  else if (topo.conflicts.length) toast(`⚠ ${topo.conflicts[0].why}`);
  refresh();
}
function cyclePending() {
  if (!pending) return;
  const part = layout.get(pending.partId);
  pending.idx = (pending.idx + 1) % pending.cands.length;
  const c = pending.cands[pending.idx];
  Object.assign(part, { m: c.m, g: c.g, r: c.r, t: c.t.slice() });
  afterPlace(part, c.attach);
}
function selectPort(wp) {
  pending = null;
  sel = { kind: 'port', port: wp };
  refresh();
}

function onAction(act, el) {
  const part = sel && sel.kind === 'part' ? layout.get(sel.id) : null;
  switch (act) {
    case 'place': {
      const open = sel && sel.kind === 'port' ? sel.port : layout.parts.length ? null : FIRST_OPEN;
      if (!open) return;
      pending = null; // 向き切替中のパーツは確定し、次の端点につなぐ
      placeAt(open, el.dataset.type);
      break;
    }
    case 'cycle': cyclePending(); break;
    case 'unplace': pending = null; undo(); break;
    case 'select-pending': sel = { kind: 'part', id: pending.partId }; pending = null; refresh(); break;
    case 'state': pushUndo(); part.props.state = +el.dataset.v; afterChange(); break;
    case 'fixed': pushUndo(); part.props.fixed = +el.dataset.v; afterChange(); break;
    case 'role': {
      pushUndo();
      part.props.role = el.dataset.v;
      if (part.props.role !== 'aux' && !part.props.label) {
        const pre = part.props.role === 'in' ? 'x' : 'y';
        const used = new Set(layout.switches().map((p) => p.props.label));
        let i = 1; while (used.has(pre + i)) i++;
        part.props.label = pre + i;
      }
      afterChange();
      break;
    }
    case 'stop': pushUndo(); part.props.stop = el.dataset.v === '1'; afterChange(); break;
    case 'train': {
      pushUndo();
      if (layout.train && layout.train.partId === part.id) layout.train.dir *= -1;
      else layout.train = { partId: part.id, pathIdx: 0, dir: 1 };
      afterChange();
      break;
    }
    case 'delete': pushUndo(); layout.remove(part.id); sel = null; afterChange(); break;
    case 'route': routeMode = { stage: 'pick', a: sel.port }; pending = null; refresh(); toast('接続先の端点をタップ'); break;
    case 'route-cancel': routeMode = null; refresh(); break;
    case 'route-next': routeMode.idx = (routeMode.idx + 1) % routeMode.cands.length; refresh(); break;
    case 'route-prev': routeMode.idx = (routeMode.idx - 1 + routeMode.cands.length) % routeMode.cands.length; refresh(); break;
    case 'route-ok': {
      pushUndo();
      for (const c of routeMode.cands[routeMode.idx]) layout.add(c);
      routeMode = null; sel = null;
      afterChange();
      toast('✓ 経路を追加しました');
      break;
    }
  }
}
panel.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (b && !b.disabled) onAction(b.dataset.act, b);
});

function runRouteSearch(b) {
  const a = routeMode.a;
  toast('探索中…', 10000);
  setTimeout(() => {
    let cands = findRoutes(layout, a, b, { depth: 6 });
    if (!cands.length) cands = findRoutes(layout, a, b, { depth: 7 });
    if (!cands.length) {
      toast('経路が見つかりませんでした（最大14本・重なり無しの範囲）', 3500);
      routeMode = null;
    } else {
      toast(`${cands.length} 件の候補`);
      routeMode = { stage: 'preview', a, b, cands, idx: 0 };
    }
    refresh();
  }, 30);
}

// ---------- ヒットテスト ----------
function hitTest(sx, sy) {
  const w = toWorld(sx, sy);
  const tolPort = Math.max(26 / view.scale, 30);
  const topo = layout.topology();
  let best = null, bd = Infinity;
  for (const wp of topo.open) {
    const p = vfloat(wp.pos);
    const d = Math.hypot(p.x - w.x, p.y - w.y);
    if (d < tolPort && d < bd) { bd = d; best = { kind: 'port', port: wp }; }
  }
  if (best) return best;
  const tolPart = Math.max(18 / view.scale, 28);
  for (const part of layout.parts) {
    for (const wp of topo.geo.get(part.id).paths) {
      for (const p of wp.pts) {
        const d = Math.hypot(p.x - w.x, p.y - w.y);
        if (d < tolPart && d < bd) { bd = d; best = { kind: 'part', id: part.id }; }
      }
    }
  }
  return best;
}
function onTap(sx, sy) {
  const hit = hitTest(sx, sy);
  if (routeMode) {
    if (routeMode.stage === 'pick' && hit && hit.kind === 'port') {
      if (hit.port.partId === routeMode.a.partId && hit.port.port === routeMode.a.port) return toast('別の端点を選んでください');
      runRouteSearch(hit.port);
    }
    return;
  }
  if (!hit) { sel = null; pending = null; refresh(); return; }
  if (hit.kind === 'port') return selectPort(hit.port);
  pending = null;
  sel = hit;
  refresh();
}

// ---------- ポインタ操作（パン・ピンチ・タップ）----------
const pointers = new Map();
let gesture = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const pt = localXY(e);
  pointers.set(e.pointerId, pt);
  if (pointers.size === 1) gesture = { kind: 'maybe-tap', x0: pt.x, y0: pt.y, cx: view.cx, cy: view.cy };
  else if (pointers.size === 2) {
    const [p, q] = [...pointers.values()];
    gesture = { kind: 'pinch', d0: Math.hypot(p.x - q.x, p.y - q.y), s0: view.scale, m: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, w: toWorld((p.x + q.x) / 2, (p.y + q.y) / 2) };
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const pt = localXY(e);
  pointers.set(e.pointerId, pt);
  if (!gesture) return;
  if (gesture.kind === 'pinch' && pointers.size >= 2) {
    const [p, q] = [...pointers.values()];
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    view.scale = Math.min(6, Math.max(0.05, gesture.s0 * (d / gesture.d0)));
    const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    view.cx = gesture.w.x - (m.x - W / 2) / view.scale;
    view.cy = gesture.w.y + (m.y - H / 2) / view.scale;
    dirty = true;
    return;
  }
  const dx = pt.x - gesture.x0, dy = pt.y - gesture.y0;
  if (gesture.kind === 'maybe-tap' && Math.hypot(dx, dy) > 6) gesture.kind = 'pan';
  if (gesture.kind === 'pan') {
    view.cx = gesture.cx - dx / view.scale;
    view.cy = gesture.cy + dy / view.scale;
    dirty = true;
  }
});
const endPointer = (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (gesture && gesture.kind === 'maybe-tap' && e.type === 'pointerup') { const pt = localXY(e); onTap(pt.x, pt.y); }
  if (pointers.size === 0) gesture = null;
  else if (pointers.size === 1) {
    const [p] = [...pointers.values()];
    gesture = { kind: 'pan', x0: p.x, y0: p.y, cx: view.cx, cy: view.cy };
  }
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const pt = localXY(e);
  zoomAt(pt.x, pt.y, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });
$('#btn-zoom-in').onclick = () => zoomAt(W / 2, H / 2, 1.3);
$('#btn-zoom-out').onclick = () => zoomAt(W / 2, H / 2, 1 / 1.3);
$('#btn-fit').onclick = () => fitView();

// ---------- 走行 ----------
function play() {
  if (running) { running = false; refresh(); return; }
  if (sim.status === 'notrain') return toast('先に列車を配置してください（レールを選んで「列車を置く」）');
  if (sim.halted) resetSim();
  running = true;
  simActive = true;
  lastT = null;
  refresh();
}
function step() {
  if (sim.status === 'notrain') return toast('先に列車を配置してください');
  if (sim.halted) resetSim();
  running = false;
  simActive = true;
  sim.advance(1e9, 1);
  refresh();
}
$('#btn-play').onclick = play;
$('#btn-step').onclick = step;
$('#btn-reset').onclick = () => { resetSim(); refresh(); };
$('#btn-undo').onclick = undo;

let lastT = null;
function frame(t) {
  if (running) {
    if (lastT != null) {
      const dt = Math.min(0.05, (t - lastT) / 1000);
      const before = sim.entries;
      sim.advance(dt * 350 * +$('#speed').value);
      if (sim.halted) { running = false; refresh(); }
      else if (sim.entries !== before) updateStatus();
    }
    lastT = t;
    dirty = true;
  }
  if (dirty) render();
  requestAnimationFrame(frame);
}

// ---------- モーダル ----------
const modal = $('#modal');
function openModal(title, html) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  if (!modal.open) modal.showModal();
}
$('#modal-close').onclick = () => modal.close();
modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });

function openMenu() {
  const ex = Object.entries(examples).map(([k, v]) => `<button data-m="ex" data-k="${k}">📂 ${esc(v.title)}</button>`).join('');
  openModal('メニュー', `
    <div class="menu">
      <button data-m="tt">📊 真理値表を計算</button>
      <button data-m="new">🆕 新規（全消去）</button>
      <button data-m="export">💾 JSON を保存</button>
      <button data-m="import">📥 JSON を読み込み</button>
      <button data-m="share">🔗 共有 URL をコピー</button>
      <button data-m="rotate">⟳ 全体を45°回転</button>
      <button data-m="help">❓ 使い方・ルール</button>
    </div>
    <h4>設定</h4>
    <div class="row">固定ポイントに開通していない側から進入したとき:
      <select id="fixed-trail">
        <option value="pass" ${layout.settings.fixedTrail === 'pass' ? 'selected' : ''}>そのまま通過（合流）</option>
        <option value="derail" ${layout.settings.fixedTrail === 'derail' ? 'selected' : ''}>脱線（停止）</option>
      </select>
    </div>
    <h4>サンプル</h4>
    <div class="menu">${ex || '<p class="hint">（読み込み失敗）</p>'}</div>`);
  $('#fixed-trail').onchange = (e) => { pushUndo(); layout.settings.fixedTrail = e.target.value; afterChange(); };
}
$('#btn-menu').onclick = openMenu;
$('#modal-body').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-m]');
  if (!b) return;
  const m = b.dataset.m;
  if (m === 'ex') { pushUndo(); setLayout(Layout.fromJSON(examples[b.dataset.k].layout)); modal.close(); toast(examples[b.dataset.k].title); }
  if (m === 'new') { if (!confirm('レイアウトを全て消去しますか？')) return; pushUndo(); setLayout(new Layout()); modal.close(); }
  if (m === 'export') exportJSON();
  if (m === 'import') $('#file-input').click();
  if (m === 'share') shareURL();
  if (m === 'rotate') { pushUndo(); for (const p of layout.parts) { p.t = vrot(p.t, 1); p.r = hmod(p.r + 1); } afterChange(); fitView(); modal.close(); }
  if (m === 'help') showHelp();
  if (m === 'tt') showTruthTable();
});

function showTruthTable() {
  let tt;
  try { tt = truthTable(layout); } catch (err) { return openModal('真理値表', `<p class="warn">${esc(err.message)}</p>`); }
  if (!layout.train) return openModal('真理値表', '<p class="warn">列車が配置されていません。</p>');
  const RES = { stopped: '停止', derailed: '脱線', loop: '停止しない', limit: '上限到達' };
  const name = (p) => esc(p.props.label || '#' + p.id);
  const head = `<tr>${tt.inputs.map((p) => `<th class="in">${name(p)}</th>`).join('')}${tt.outputs.map((p) => `<th class="out">${name(p)}</th>`).join('')}<th>結果</th><th>通過数</th></tr>`;
  const rows = tt.rows.map((r) => `<tr>${r.inBits.map((b) => `<td>${b}</td>`).join('')}${r.outBits.map((b) => `<td class="${r.result === 'stopped' ? '' : 'bad'}">${r.result === 'stopped' ? b : '—'}</td>`).join('')}<td class="${r.result === 'stopped' ? '' : 'bad'}">${RES[r.result] || r.result}</td><td>${r.steps}</td></tr>`).join('');
  const note = !tt.inputs.length ? '<p class="hint">入力ポイントがありません（ポイントを選んで役割を「入力」に）。</p>' : '';
  const note2 = !tt.outputs.length ? '<p class="hint">出力ポイントがありません（ポイントを選んで役割を「出力」に）。</p>' : '';
  openModal('真理値表', `${note}${note2}<p class="hint">各入力について、補助ポイントを初期状態に戻して列車を走らせ、停止時点の出力ポイントを読みます。</p><table class="tt">${head}${rows}</table>`);
}
function showHelp() {
  openModal('使い方・ルール', `
    <h4>計算モデル</h4>
    <ul>
      <li>分岐レールを A → B<sub>0</sub>, B<sub>1</sub> とし、状態 i のとき A 側から進入した列車は B<sub>i</sub> へ出る（状態は不変）。</li>
      <li>B<sub>j</sub> 側から進入した列車は A へ出て、状態が j に更新される。</li>
      <li>列車は1編成。ストップレール（レバー「停止させる」）に到達した時点で停止し、出力ポイントを読む。線路の端に達すると脱線。</li>
      <li>R-11 は 直進=0 / 分岐=1、R-12 は 左=0 / 右=1（A から見て）。「ビット反転」で読み替え可能。</li>
    </ul>
    <h4>幾何</h4>
    <ul>
      <li>直線 216mm、曲線は半径 216mm・45°（8本で円）の理想化グリッド。座標は 45° 方向単位ベクトルの整数係数で厳密に計算。</li>
      <li>端点同士は位置・向きが厳密に一致し、凸と凹の組のときだけ接続される。わずかでもずれると閉じない。</li>
      <li>接続していないレール同士が近すぎる（中心線間 ${38}mm 未満）と「重なり」として赤く表示。</li>
      <li>ターンアウト（R-11）・8の字ポイント（R-12）は凸凹が逆のバージョンも選べる（向き切替で出てくる）。</li>
    </ul>
    <h4>操作</h4>
    <ul>
      <li>端点（●=凸 / ○=凹）をタップ → パレットでレールを選ぶと接続。「↻ 向き」で曲がる向き・接続する端を切替。続けてパレットを押すと連続でつながる。</li>
      <li>レールをタップ → ポイントの初期状態・役割（入力/出力/補助）・名前、ストップレールのレバー、列車の配置、削除。</li>
      <li>「🔍 経路探索」: 2 つの端点を厳密に結ぶレール列を自動で探す。</li>
      <li>▶ 再生 / ⏭ 次のレールまで / ⟲ 初期状態へ。☰ から真理値表・保存・共有。</li>
      <li>PC: Space=再生, R=向き切替, Delete=削除, Ctrl+Z=元に戻す, Esc=選択解除。</li>
    </ul>`);
}

// ---------- 保存・共有 ----------
function exportJSON() {
  const blob = new Blob([JSON.stringify(layout.toJSON(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'plarail-layout.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#file-input').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const L = Layout.fromJSON(JSON.parse(await f.text()));
    pushUndo(); setLayout(L); modal.close(); toast('読み込みました');
  } catch (err) { toast('読み込みに失敗しました'); }
  e.target.value = '';
});
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function encodeLayout() {
  const bytes = new TextEncoder().encode(JSON.stringify(layout.toJSON()));
  if (window.CompressionStream) {
    const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return 'z' + b64u(new Uint8Array(await new Response(cs).arrayBuffer()));
  }
  return 'j' + b64u(bytes);
}
async function decodeLayout(s) {
  let bytes = unb64u(s.slice(1));
  if (s[0] === 'z') {
    const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    bytes = new Uint8Array(await new Response(ds).arrayBuffer());
  }
  return Layout.fromJSON(JSON.parse(new TextDecoder().decode(bytes)));
}
async function shareURL() {
  const url = `${location.origin}${location.pathname}#l=${await encodeLayout()}`;
  try { await navigator.clipboard.writeText(url); toast('共有 URL をコピーしました'); }
  catch (e) { prompt('この URL をコピーしてください', url); }
}

// ---------- キーボード ----------
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || modal.open) return;
  if (e.key === ' ') { e.preventDefault(); play(); }
  else if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
  else if (e.key === 'r' || e.key === 'R') cyclePending();
  else if (e.key === 'Escape') { sel = null; pending = null; routeMode = null; refresh(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && sel && sel.kind === 'part') onAction('delete');
});

// ---------- 起動 ----------
// 下部パネルの高さ変化でもステージの大きさが変わるため、ウィンドウではなくステージ自体を監視する
window.addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe($('#stage'));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { dirty = true; });
async function boot() {
  resize();
  try { examples = await (await fetch('examples/examples.json')).json(); } catch (e) { examples = {}; }
  let L = null;
  const m = location.hash.match(/#l=([A-Za-z0-9_-]+)/);
  if (m) {
    try { L = await decodeLayout(m[1]); history.replaceState(null, '', location.pathname); } catch (e) { toast('URL のレイアウトを読めませんでした'); }
  }
  if (!L) {
    try { const s = localStorage.getItem(STORAGE_KEY); if (s) L = Layout.fromJSON(JSON.parse(s)); } catch (e) { /* ignore */ }
  }
  if (!L && examples.not) L = Layout.fromJSON(examples.not.layout);
  setLayout(L || new Layout());
  ready = true;
  requestAnimationFrame(frame);
}
boot();

// テスト・デバッグ用フック
window.__plarail = { get layout() { return layout; }, get sim() { return sim; }, toScreen, vfloat };
