// Pablete ESPN ☕ — "The Race", editorial version with a time scrubber.
// One line per team on a real time axis. The chart opens on the latest Pablete; "↺ Replay the
// season" plays it from the first one. Dragging the chart (or the date rail under it) and the
// arrow keys move through the season. Desktop also gets a slim hover tooltip.
// Highlighted teams in their colour with logo + name at the line end; the rest in light grey
// with a small logo. Headline, subtitle and up to two notes come from js/pablete-story.js.
// D3 is pinned and loaded as an ES module from jsDelivr; no build step.

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import { fmtNum, fmtDate } from "./pablete-data.js";
import { story } from "./pablete-story.js";

export const METRICS = {
  gap: { label: "Gap to leader", short: "Gap" },
  points: { label: "Total points", short: "Points" },
  avg: { label: "Average", short: "Average" },
  rank: { label: "Rank", short: "Rank" },
};

const GREY = "#CFCFCF";
const STEP_MS = 600; // per Pablete while playing
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad2 = n => String(n).padStart(2, "0");
const dayMonth = ms => { const d = new Date(ms); return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}`; };

let active = null; // the chart currently on the page (its timers stop when it is redrawn)

function axisCaption(metric, mode) {
  if (metric === "gap") return "Points behind the leader";
  if (metric === "points") return "Total points";
  if (metric === "avg") return mode === "clean" ? "Points per clean space (without outs)" : "Points per space (spaces include outs)";
  return "Rank by total points";
}

function fmtValue(metric, v) {
  if (v == null) return "";
  if (metric === "gap") return Math.round(v) === 0 ? "Leader" : fmtNum(Math.round(v), 0);
  if (metric === "avg") return fmtNum(v, 2);
  if (metric === "rank") return `#${Math.round(v)}`;
  return fmtNum(Math.round(v), 0);
}

// teamId -> value per date index (null where the team has no row)
function valuesFor(cfg, data, metric, mode) {
  const out = new Map(cfg.teams.map(t => [t.id, data.dates.map(() => null)]));
  data.dates.forEach((ms, i) => {
    const entries = data.byDate.get(ms);
    const lead = Math.max(...entries.map(e => e.points));
    for (const e of entries) {
      const arr = out.get(e.teamId);
      if (!arr) continue;
      arr[i] = metric === "gap" ? e.points - lead
        : metric === "points" ? e.points
        : metric === "avg" ? (mode === "clean" ? e.avgClean : e.avg)
        : e.rank;
    }
  });
  return out;
}

// Push labels apart (sorted by y) so they never overlap; sets .ly on each item.
function dodge(items, top, bottom, gap) {
  items.sort((a, b) => a.y - b.y);
  items.forEach((d, i) => { d.ly = Math.max(d.y, i ? items[i - 1].ly + gap : top); });
  for (let i = items.length - 1; i >= 0; i--) {
    const max = i === items.length - 1 ? bottom : items[i + 1].ly - gap;
    if (items[i].ly > max) items[i].ly = max;
  }
  return items;
}

let measureCtx = null;
function textWidth(text, font) {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

function wrapWords(text, maxChars) {
  const lines = [];
  let cur = "";
  for (const w of text.split(" ")) {
    if (cur && (cur + " " + w).length > maxChars) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Do two segments [x1,y1,x2,y2] cross? (proper intersection only)
function crosses(p, q) {
  const o = (ax, ay, bx, by, cx, cy) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  return o(p[0], p[1], p[2], p[3], q[0], q[1]) * o(p[0], p[1], p[2], p[3], q[2], q[3]) < 0
    && o(q[0], q[1], q[2], q[3], p[0], p[1]) * o(q[0], q[1], q[2], q[3], p[2], p[3]) < 0;
}
function segHitsBox(s, b) {
  const edges = [[b.x, b.y, b.x + b.w, b.y], [b.x + b.w, b.y, b.x + b.w, b.y + b.h], [b.x, b.y + b.h, b.x + b.w, b.y + b.h], [b.x, b.y, b.x, b.y + b.h]];
  return edges.some(e => crosses(s, e));
}
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/**
 * Render The Race into `host`.
 * ctx: { cfg, data, state: { mode, metric, selected:Set, focus, racePos, racePlaying }, onPickTeam(id) }
 */
export function renderRace(host, ctx) {
  active?.stop();
  const { cfg, data, state } = ctx;
  const { metric, mode } = state;
  const dates = data.dates;
  const last = dates.length - 1;
  const W = Math.max(280, Math.floor(host.clientWidth));
  const phone = W < 640;
  const plotH = phone ? 300 : 360;
  const railTop = plotH + 14;
  const H = plotH + 52;
  const m = { top: 14, right: phone ? 80 : 196, left: phone ? 34 : 50 };
  const plotBottom = plotH - 6;
  const vals = valuesFor(cfg, data, metric, mode);
  const teams = cfg.teams.filter(t => vals.get(t.id).some(v => v != null));
  const font = { label: `600 ${phone ? 12 : 13}px Barlow, system-ui, sans-serif`, note: "500 12px Barlow, system-ui, sans-serif" };

  let pos = clamp(Number.isFinite(state.racePos) ? state.racePos : last, 0, last);

  // ----- scales (fixed for the whole season, so lines grow into a stable frame) -----
  const d0 = dates[0], dN = dates[last];
  const padMs = d0 === dN ? 86400000 : 0;
  const x = d3.scaleUtc().domain([d0 - padMs, dN + padMs]).range([m.left + 12, W - m.right]);
  let y, yTicks;
  if (metric === "rank") {
    const n = Math.max(teams.length, d3.max([...vals.values()].flat().filter(v => v != null)) || 1);
    y = d3.scaleLinear().domain([1, n]).range([m.top + 10, plotBottom - 10]);
    yTicks = d3.range(1, n + 1);
  } else {
    const all = [...vals.values()].flat().filter(v => v != null);
    let [lo, hi] = d3.extent(all);
    if (metric === "gap") hi = 0;
    if (lo === hi) { lo -= 1; hi += 1; }
    y = d3.scaleLinear().domain([lo, hi]).nice(4).range([plotBottom, m.top]);
    yTicks = y.ticks(4);
  }
  const step = yTicks.length > 1 ? Math.abs(yTicks[1] - yTicks[0]) : 1;
  const fmtY = v => (metric === "rank" ? String(v) : fmtNum(v, step < 1 ? 1 : 0));

  const timeAt = p => {
    const i = Math.floor(p + 1e-9);
    if (i >= last) return dates[last];
    return dates[i] + (p - i) * (dates[i + 1] - dates[i]);
  };
  const posFromX = px => {
    const t = clamp(+x.invert(px), d0, dN);
    for (let i = 0; i < last; i++) if (t <= dates[i + 1]) return i + (t - dates[i]) / (dates[i + 1] - dates[i]);
    return last;
  };
  const nearestIndex = px => d3.minIndex(dates, d => Math.abs(x(d) - px));

  // Points revealed up to position p, plus the interpolated head between two Pabletes.
  function pathPoints(arr, p) {
    const i0 = Math.floor(p + 1e-9), f = p - i0;
    const pts = [];
    for (let i = 0; i <= Math.min(i0, last); i++) if (arr[i] != null) pts.push({ x: x(dates[i]), y: y(arr[i]), v: arr[i], real: true });
    if (f > 1e-6 && i0 < last && arr[i0] != null && arr[i0 + 1] != null) {
      const v = arr[i0] + (arr[i0 + 1] - arr[i0]) * f;
      pts.push({ x: x(timeAt(p)), y: y(v), v, real: false });
    }
    return pts;
  }

  // ----- DOM -----
  const headline = h("h3", "race-headline");
  const dek = h("p", "race-dek");
  const caption = h("p", "race-caption", axisCaption(metric, mode));
  const live = h("p", "visually-hidden");
  live.setAttribute("aria-live", "polite");

  const svg = d3.create("svg")
    .attr("class", "race-svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("width", W).attr("height", H)
    .attr("role", "group")
    .attr("aria-label", `The Race: ${METRICS[metric].label.toLowerCase()} by Pablete date, ${fmtDate(d0)} to ${fmtDate(dN)}. Drag horizontally or use the date slider to move through the season.`);

  svg.append("g").attr("class", "race-grid")
    .selectAll("line").data(yTicks).join("line")
    .attr("x1", m.left).attr("x2", W - m.right + (phone ? 0 : 8)).attr("y1", d => y(d)).attr("y2", d => y(d));
  svg.append("g").attr("class", "race-axis")
    .selectAll("text").data(yTicks).join("text")
    .attr("x", m.left - 8).attr("y", d => y(d)).attr("dy", "0.32em").attr("text-anchor", "end")
    .text(fmtY);

  const gGrey = svg.append("g").attr("class", "race-greys");
  const gHl = svg.append("g").attr("class", "race-hls");
  const gHeads = svg.append("g").attr("class", "race-heads");
  const gNotes = svg.append("g").attr("class", "race-notes").attr("aria-hidden", "true");
  const gLabels = svg.append("g").attr("class", "race-labels");

  // ----- date rail: thin track, a tick per Pablete, handle -----
  const gRail = svg.append("g").attr("class", "race-rail")
    .attr("tabindex", dates.length > 1 ? 0 : -1)
    .attr("role", "slider")
    .attr("aria-label", "Pablete date")
    .attr("aria-valuemin", 1).attr("aria-valuemax", dates.length);
  gRail.append("rect").attr("class", "race-rail-hit").attr("x", x(d0) - 14).attr("y", railTop - 14)
    .attr("width", x(dN) - x(d0) + 28).attr("height", 44).attr("fill", "transparent");
  gRail.append("line").attr("class", "race-track").attr("x1", x(d0)).attr("x2", x(dN)).attr("y1", railTop).attr("y2", railTop);
  const progress = gRail.append("line").attr("class", "race-progress").attr("x1", x(d0)).attr("y1", railTop).attr("y2", railTop);
  gRail.selectAll(".race-tick").data(dates).join("line").attr("class", "race-tick")
    .attr("x1", d => x(d)).attr("x2", d => x(d)).attr("y1", railTop - 5).attr("y2", railTop + 5);
  const labelled = []; // date labels, dropping any that would collide; the latest is always kept
  for (const d of [...dates].reverse()) if (!labelled.length || x(labelled.at(-1)) - x(d) >= 40) labelled.push(d);
  const railText = gRail.selectAll(".race-date").data(labelled).join("text").attr("class", "race-date")
    .attr("x", d => x(d)).attr("y", railTop + 24)
    .attr("text-anchor", d => (labelled.length > 1 && d === d0 && x(d) - m.left < 22 ? "start" : "middle"))
    .text(dayMonth);
  const handle = gRail.append("circle").attr("class", "race-handle").attr("cy", railTop).attr("r", 8);

  const wrap = h("div", "race-wrap");
  const tip = h("div", "race-tip");
  tip.hidden = true;
  wrap.append(svg.node(), tip);
  const cross = svg.insert("line", ".race-greys").attr("class", "race-cross").attr("y1", m.top).attr("y2", plotBottom).style("display", "none");

  const playBtn = h("button", "race-play");
  playBtn.type = "button";
  const status = h("span", "race-status");
  const hint = h("span", "race-hint", phone ? "Drag the chart to move through the season" : "Drag the chart, or use the slider and arrow keys · hover for values");
  const controls = h("div", "race-controls-row");
  controls.append(playBtn, status, hint);
  if (dates.length < 2) playBtn.disabled = true;

  host.replaceChildren(headline, dek, caption, wrap, controls, live);

  // Reserve the height of the longest headline and subtitle, so the chart never jumps while
  // the words change during playback.
  let maxH = 0, maxD = 0;
  for (let k = 0; k <= last; k++) {
    const s = story(cfg, data, k, metric, mode);
    headline.textContent = s.headline; dek.textContent = s.dek;
    maxH = Math.max(maxH, headline.offsetHeight); maxD = Math.max(maxD, dek.offsetHeight);
  }
  headline.style.minHeight = `${maxH}px`;
  dek.style.minHeight = `${maxD}px`;

  // ----- drawing -----
  let shownK = -1, st = null, hlSet = new Set(), hitBoxes = [];

  function highlighted() {
    if (state.selected.size) return new Set(state.selected);
    const s = new Set(st.spotlight);
    if (state.focus) s.add(state.focus);
    return s;
  }

  function updateWords(k) {
    st = story(cfg, data, k, metric, mode);
    hlSet = highlighted();
    headline.textContent = st.headline;
    dek.textContent = st.dek;
    status.textContent = `Pablete ${k + 1} of ${dates.length} · ${fmtDate(dates[k])}`;
    gRail.attr("aria-valuenow", k + 1).attr("aria-valuetext", `Pablete ${k + 1} of ${dates.length}, ${fmtDate(dates[k])}`);
    railText.classed("on", d => d === dates[k]);
  }

  const line = d3.line().x(p => p.x).y(p => p.y);

  function draw() {
    const k = Math.round(pos);
    if (k !== shownK) { shownK = k; updateWords(k); }
    const items = teams.map(t => {
      const pts = pathPoints(vals.get(t.id), pos);
      return { t, pts, head: pts.at(-1), on: hlSet.has(t.id) };
    }).filter(d => d.head);
    const greys = items.filter(d => !d.on), hls = items.filter(d => d.on);
    const lineD = d => (d.pts.length > 1 ? line(d.pts) : `M${d.head.x},${d.head.y}h0`);

    gGrey.selectAll("path").data(greys, d => d.t.id).join("path")
      .attr("class", "race-line").attr("stroke", GREY).attr("stroke-width", 1.5).attr("d", lineD);
    const hlG = gHl.selectAll("g").data(hls, d => d.t.id).join(enter => {
      const g = enter.append("g");
      g.append("path").attr("class", "race-line").attr("stroke-width", 2.25);
      return g;
    });
    hlG.select("path").attr("stroke", d => d.t.color).attr("d", lineD);
    hlG.selectAll("circle").data(d => d.pts.filter(p => p.real && p !== d.head).map(p => ({ p, c: d.t.color })))
      .join("circle").attr("r", 3).attr("cx", o => o.p.x).attr("cy", o => o.p.y).attr("fill", o => o.c);

    hitBoxes = [];
    // grey heads: small logo, no name
    const r = phone ? 7 : 8;
    gHeads.selectAll("g.race-ghead").data(greys, d => d.t.id).join(enter => {
      const g = enter.append("g").attr("class", "race-ghead");
      g.append("circle").attr("r", r).attr("fill", "#fff").attr("stroke", GREY).attr("stroke-width", 1);
      g.append("image").attr("class", "race-glogo").attr("x", -r + 2).attr("y", -r + 2).attr("width", 2 * r - 4).attr("height", 2 * r - 4)
        .attr("preserveAspectRatio", "xMidYMid meet");
      g.append("title");
      return g;
    })
      .attr("transform", d => `translate(${d.head.x},${d.head.y})`)
      .call(g => g.select("image").attr("href", d => d.t.logo))
      .call(g => g.select("title").text(d => `${d.t.name} — tap to highlight`));
    for (const d of greys) hitBoxes.push({ id: d.t.id, x: d.head.x - r - 3, y: d.head.y - r - 3, w: 2 * r + 6, h: 2 * r + 6 });
    // highlighted heads: a dot on the line
    gHeads.selectAll("circle.race-hhead").data(hls, d => d.t.id).join("circle").attr("class", "race-hhead")
      .attr("r", 4.5).attr("cx", d => d.head.x).attr("cy", d => d.head.y).attr("fill", d => d.t.color);

    // highlighted labels: logo in a team-colour ring + name (initials on phones), dodged apart
    const labels = hls.map(d => ({ d, y: d.head.y }));
    dodge(labels, m.top + 11, plotBottom - 11, phone ? 25 : 31);
    const lg = gLabels.selectAll("g.race-label").data(labels, l => l.d.t.id).join(enter => {
      const g = enter.append("g").attr("class", "race-label");
      g.append("path").attr("class", "race-leader");
      g.append("circle").attr("r", 11).attr("fill", "#fff").attr("stroke-width", 2);
      g.append("image").attr("width", 16).attr("height", 16).attr("preserveAspectRatio", "xMidYMid meet");
      g.append("text").attr("class", "race-name");
      g.append("text").attr("class", "race-val");
      g.append("title");
      return g;
    });
    lg.each(function (l) {
      const g = d3.select(this), t = l.d.t, hx = l.d.head.x, hy = l.d.head.y;
      const lx = hx + 22;
      g.select("path").attr("d", Math.abs(l.ly - hy) < 1 ? `M${hx + 6},${hy}H${lx - 11}` : `M${hx + 6},${hy}L${lx - 11},${l.ly}`);
      g.select("circle").attr("cx", lx).attr("cy", l.ly).attr("stroke", t.color);
      g.select("image").attr("href", t.logo).attr("x", lx - 8).attr("y", l.ly - 8);
      const name = phone ? t.initials : t.name;
      g.select(".race-name").attr("x", lx + 15).attr("y", l.ly).attr("dy", phone ? "0.34em" : "-0.12em").text(name);
      g.select(".race-val").attr("x", lx + 15).attr("y", l.ly).attr("dy", "1.05em")
        .text(phone ? "" : fmtValue(metric, l.d.head.v));
      g.select("title").text(t.name);
      const w = 26 + textWidth(name, font.label) + 4;
      hitBoxes.push({ id: t.id, x: lx - 13, y: l.ly - 13, w: w + 2, h: 26, label: true });
    });

    const hx = x(timeAt(pos));
    progress.attr("x2", hx);
    handle.attr("cx", hx);
  }

  // ----- notes: thin leader line + short text, placed where they collide with nothing -----
  function drawNotes() {
    gNotes.selectAll("*").remove();
    if (!st) return;
    const k = Math.round(pos);
    const placed = [];
    const blockers = hitBoxes.map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
    const segs = [];
    const anchored = st.notes.slice(0, 2)
      .map(note => ({ note, v: vals.get(note.teamId)?.[k] }))
      .filter(o => o.v != null)
      .map(o => ({ ...o, ax: x(dates[k]), ay: y(o.v) }))
      .sort((a, b) => a.ay - b.ay); // the higher anchor places first and prefers going up
    anchored.forEach(({ note, ax, ay }, idx) => {
      const lower = anchored.length > 1 && idx === anchored.length - 1;
      const lines = wrapWords(note.text, phone ? 20 : 28);
      const w = Math.max(...lines.map(s => textWidth(s, font.note))) + 4;
      const lh = 14, bh = lines.length * lh;
      const up = [[ax - w - 16, ay - bh - 18], [ax - w / 2, ay - bh - 30], [ax - w - 16, ay - bh - 48]];
      const down = [[ax - w - 16, ay + 18], [ax - w / 2, ay + 30], [ax - w - 16, ay + 48]];
      const cands = [...(lower ? down : up), [ax - w - 20, ay - bh / 2], ...(lower ? up : down), [ax + 14, ay + 30], [ax + 14, ay - bh - 30]];
      // fallback: scan up and down the left of the point, nearest first
      for (let dy = 60; dy <= plotH; dy += 14) cands.push([ax - w - 16, ay - bh - dy], [ax - w - 16, ay + dy]);
      for (const [cx, cy] of cands) {
        const b = { x: clamp(cx, m.left + 2, W - 4 - w), y: cy, w, h: bh };
        if (b.y < m.top || b.y + b.h > plotBottom) continue;
        if ([...blockers, ...placed].some(o => overlaps(b, o))) continue;
        const ex = clamp(ax, b.x, b.x + b.w), ey = clamp(ay, b.y, b.y + b.h);
        const seg = [ax, ay, ex, ey];
        if (segs.some(o => crosses(seg, o)) || placed.some(o => segHitsBox(seg, o))) continue;
        placed.push(b); segs.push(seg);
        const len = Math.hypot(ex - ax, ey - ay) || 1;
        const g = gNotes.append("g").attr("class", "race-note").attr("data-team", note.teamId);
        g.append("line").attr("x1", ax + (ex - ax) * (6 / len)).attr("y1", ay + (ey - ay) * (6 / len)).attr("x2", ex).attr("y2", ey);
        const text = g.append("text").attr("y", b.y);
        lines.forEach((s, j) => text.append("tspan").attr("x", b.x + 2).attr("dy", j ? lh : "0.85em").text(s));
        return;
      }
    });
    gNotes.classed("show", false);
    requestAnimationFrame(() => gNotes.classed("show", true));
  }

  // ----- movement: scrubbing, snapping, playing -----
  let timer = null, waitT = 0, playing = false;
  const stopAnim = () => { timer?.stop(); timer = null; clearTimeout(waitT); };

  function setPos(p) {
    pos = clamp(p, 0, last);
    state.racePos = pos;
    draw();
  }
  function settle() {
    updateBtn();
    if (!playing) {
      drawNotes();
      live.textContent = `${fmtDate(dates[Math.round(pos)])}: ${st?.headline ?? ""}`;
    }
  }
  function moving() { gNotes.selectAll("*").remove(); }

  function animateTo(target, dur, done) {
    stopAnim();
    moving();
    target = clamp(target, 0, last);
    if (REDUCED.matches || dur <= 0 || Math.abs(target - pos) < 1e-6) { setPos(target); settle(); done?.(); return; }
    const from = pos;
    const ease = d3.easeCubicInOut;
    timer = d3.timer(elapsed => {
      const t = Math.min(1, elapsed / dur);
      setPos(from + (target - from) * ease(t));
      if (t >= 1) { stopAnim(); settle(); done?.(); }
    });
  }

  function updateBtn() {
    const atEnd = pos >= last - 1e-6;
    const label = playing ? "❚❚ Pause" : atEnd ? "↺ Replay the season" : "▶ Play";
    if (playBtn.textContent !== label) playBtn.textContent = label;
    playBtn.setAttribute("aria-pressed", String(playing));
  }
  function setPlaying(on) {
    playing = on;
    state.racePlaying = on;
    updateBtn();
  }
  function stepPlay() {
    if (!playing) return;
    if (pos >= last - 1e-6) { setPlaying(false); settle(); return; }
    const target = Math.floor(pos + 1e-6) + 1;
    if (REDUCED.matches) {
      waitT = setTimeout(() => { setPos(target); stepPlay(); }, 900);
    } else {
      animateTo(target, STEP_MS * (target - pos), stepPlay);
    }
  }
  function play() {
    if (last < 1) return;
    stopAnim();
    setPlaying(true);
    moving();
    if (pos >= last - 1e-6) {
      setPos(0);
      waitT = setTimeout(stepPlay, REDUCED.matches ? 600 : 350);
    } else stepPlay();
  }
  function pause() {
    stopAnim();
    setPlaying(false);
    animateTo(Math.round(pos), 180);
  }
  playBtn.addEventListener("click", () => (playing ? pause() : play()));

  function goTo(k, dur = 450) {
    if (playing) { stopAnim(); setPlaying(false); }
    animateTo(k, dur * Math.max(1, Math.abs(k - pos)) ** 0.5);
  }

  gRail.on("keydown", ev => {
    const k = Math.round(pos);
    let to = null;
    if (ev.key === "ArrowRight" || ev.key === "ArrowUp") to = k + 1;
    else if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") to = k - 1;
    else if (ev.key === "Home") to = 0;
    else if (ev.key === "End") to = last;
    if (to == null) return;
    ev.preventDefault();
    goTo(clamp(to, 0, last));
  });

  // Drag horizontally anywhere on the chart; a short tap picks a team or jumps to a date.
  let drag = null;
  const svgNode = svg.node();
  svg.on("pointerdown", ev => {
    if (ev.button > 0) return;
    hideTip();
    const [px, py] = d3.pointer(ev, svgNode);
    drag = { id: ev.pointerId, x0: px, y0: py, moved: false, onRail: py > plotH };
    try { svgNode.setPointerCapture(ev.pointerId); } catch { /* not capturable */ }
  });
  svg.on("pointermove", ev => {
    if (!drag && ev.pointerType === "mouse" && !phone && !playing && !timer) { const [px, py] = d3.pointer(ev, svgNode); if (py <= plotH) showTip(px); else hideTip(); return; }
    if (!drag || ev.pointerId !== drag.id) return;
    const [px, py] = d3.pointer(ev, svgNode);
    if (!drag.moved) {
      const dx = Math.abs(px - drag.x0), dy = Math.abs(py - drag.y0);
      if (dx < 6 || dx < dy) return;
      drag.moved = true;
      hideTip();
      if (playing) setPlaying(false);
      stopAnim();
      moving();
      wrap.classList.add("scrubbing");
    }
    setPos(posFromX(px));
  });
  const endDrag = (ev, cancelled) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    wrap.classList.remove("scrubbing");
    if (d.moved) { animateTo(Math.round(pos), 200); return; }
    if (cancelled) return;
    const [px, py] = d3.pointer(ev, svgNode);
    if (!d.onRail) {
      const hit = [...hitBoxes].reverse().find(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
      if (hit) { ctx.onPickTeam(hit.id); return; }
      const id = nearestLine(px, py);
      if (id) { ctx.onPickTeam(id); return; }
    }
    goTo(nearestIndex(px));
  };
  svg.on("pointerup", ev => endDrag(ev, false));
  svg.on("pointerleave", hideTip);
  svg.on("pointercancel", ev => endDrag(ev, true));

  // ----- slim desktop tooltip: revealed Pablete nearest the mouse, highlighted teams only -----
  function hideTip() { tip.hidden = true; cross.style("display", "none"); gNotes.attr("visibility", null); }
  function showTip(px) {
    const upto = Math.round(pos);
    const k = d3.minIndex(dates.slice(0, upto + 1), d => Math.abs(x(d) - px));
    if (k < 0) return hideTip();
    const rows = teams.filter(t => hlSet.has(t.id) && vals.get(t.id)[k] != null)
      .map(t => ({ t, v: vals.get(t.id)[k], prev: k > 0 ? vals.get(t.id)[k - 1] : null }))
      .sort((a, b) => (metric === "rank" ? a.v - b.v : b.v - a.v));
    if (!rows.length) return hideTip();
    cross.style("display", null).attr("x1", x(dates[k])).attr("x2", x(dates[k]));
    const head = h("p", "rt-head");
    head.append(h("strong", null, fmtDate(dates[k])), h("span", "muted", k > 0 ? ` · vs ${dayMonth(dates[k - 1])}` : " · first Pablete"));
    const list = h("ul", "rt-list");
    for (const r of rows) {
      const li = h("li");
      const img = h("img"); img.src = r.t.logo; img.alt = ""; img.width = 16; img.height = 16;
      const d = r.prev == null ? null : r.v - r.prev;
      const better = d == null || d === 0 ? "flat" : (metric === "rank" ? d < 0 : d > 0) ? "up" : "down";
      const chg = d == null ? "—" : Math.abs(d) < 1e-9 ? "=" : metric === "rank" ? (d < 0 ? `▲${-d}` : d > 0 ? `▼${d}` : "=") : fmtNum(d, metric === "avg" ? 2 : 0, { sign: true });
      li.append(img, h("span", "rt-name", r.t.name), h("strong", "rt-val", fmtValue(metric, r.v)), h("span", `rt-chg ${better}`, chg));
      list.append(li);
    }
    gNotes.attr("visibility", "hidden");
    tip.replaceChildren(head, list);
    tip.hidden = false;
    const tw = tip.offsetWidth;
    let left = x(dates[k]) + 14;
    if (left + tw > W - 4) left = x(dates[k]) - 14 - tw;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${m.top}px`;
  }

  function nearestLine(px, py) {
    let best = null, bestD = 12;
    for (const t of teams) {
      const pts = pathPoints(vals.get(t.id), pos);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[i + 1] ?? a;
        const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
        const u = L ? clamp(((px - a.x) * dx + (py - a.y) * dy) / L, 0, 1) : 0;
        const dist = Math.hypot(px - (a.x + u * dx), py - (a.y + u * dy));
        if (dist < bestD) { bestD = dist; best = t.id; }
      }
    }
    return best;
  }

  // ----- start -----
  const wasPlaying = state.racePlaying;
  setPlaying(false);
  draw();
  if (wasPlaying && last > 0 && pos < last - 1e-6) play();
  else if (Math.abs(pos - Math.round(pos)) > 1e-6) animateTo(Math.round(pos), 150);
  else settle();

  active = { stop: () => { stopAnim(); playing = false; } };
  return active;
}
