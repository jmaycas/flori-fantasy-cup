// Pablete ESPN ☕ — "The Race": one line per team on a real time axis, one point per Pablete.
// Metrics: gap to leader, total points, average (follows the outs toggle), rank (bump chart).
// D3 is pinned and loaded as an ES module from jsDelivr; no build step.

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import { fmtNum, fmtDate } from "./pablete-data.js";

export const METRICS = {
  gap: { label: "Gap to leader", short: "Gap" },
  points: { label: "Total points", short: "Points" },
  avg: { label: "Average", short: "Average" },
  rank: { label: "Rank", short: "Rank" },
};

const pad2 = n => String(n).padStart(2, "0");
const dayMonth = ms => { const d = new Date(ms); return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}`; };

function axisCaption(metric, mode) {
  if (metric === "gap") return "Points behind the leader (0 = leader)";
  if (metric === "points") return "Total points";
  if (metric === "avg") return mode === "clean" ? "Points per space, without outs" : "Points per space (spaces include outs)";
  return "Rank by total points (1 = top)";
}

// One series per team: [{ ms, e, v, prev, dv, dSp }] where v is the metric value,
// dv its change since the team's previous Pablete and dSp the spaces used since then.
function buildSeries(cfg, data, metric, mode) {
  const leader = new Map(data.dates.map(ms => [ms, d3.max(data.byDate.get(ms), e => e.points)]));
  const value = e => {
    if (metric === "gap") return e.points - leader.get(e.ms);
    if (metric === "points") return e.points;
    if (metric === "avg") return mode === "clean" ? e.avgClean : e.avg;
    return e.rank;
  };
  const byTeam = new Map(cfg.teams.map(t => [t.id, []]));
  for (const ms of data.dates) for (const e of data.byDate.get(ms)) byTeam.get(e.teamId)?.push({ ms, e, v: value(e) });
  for (const pts of byTeam.values()) {
    pts.forEach((p, i) => {
      const q = pts[i - 1] ?? null;
      p.prev = q;
      p.dv = q && p.v != null && q.v != null ? p.v - q.v : null;
      p.dSp = q ? (mode === "clean" ? p.e.clean - q.e.clean : p.e.spaces - q.e.spaces) : null;
    });
  }
  return cfg.teams.map(t => ({ team: t, points: byTeam.get(t.id) })).filter(s => s.points.length);
}

function fmtValue(metric, v) {
  if (v == null) return "—";
  if (metric === "gap") return v === 0 ? "Leader" : fmtNum(v, 0);
  if (metric === "avg") return fmtNum(v, 2);
  if (metric === "rank") return `#${v}`;
  return fmtNum(v, 0);
}

function fmtChange(metric, dv) {
  if (dv == null) return "—";
  if (metric === "rank") return dv < 0 ? `▲${-dv}` : dv > 0 ? `▼${dv}` : "=";
  return fmtNum(dv, metric === "avg" ? 2 : 0, { sign: true });
}

function changeClass(metric, dv) {
  if (dv == null || dv === 0) return "flat";
  const better = metric === "rank" ? dv < 0 : dv > 0;
  return better ? "up" : "down";
}

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// Readout for one date: every selected team's value, sorted, with logo, change and spaces.
function readout(ctx, series, ms, { phone }) {
  const { state, data } = ctx;
  const metric = state.metric;
  const box = h("div", "race-readout-inner");
  const i = data.dates.indexOf(ms);
  const head = h("p", "rr-head");
  head.append(h("strong", null, fmtDate(ms)), h("span", "muted", i > 0 ? ` · since ${dayMonth(data.dates[i - 1])}` : " · first Pablete"));
  box.append(head);

  const rows = series
    .filter(s => state.selected.has(s.team.id))
    .map(s => ({ s, p: s.points.find(p => p.ms === ms) }))
    .filter(r => r.p && r.p.v != null)
    .sort((a, b) => (metric === "rank" ? a.p.v - b.p.v : b.p.v - a.p.v));

  if (!rows.length) {
    box.append(h("p", "rr-empty", state.selected.size ? "No selected team has a row on this date." : "No teams selected — tap a logo to compare."));
    return box;
  }
  const list = h("ol", "rr-list");
  for (const { s, p } of rows) {
    const li = h("li");
    const key = h("span", "rr-key"); key.style.background = s.team.color;
    const img = h("img"); img.src = s.team.logo; img.alt = ""; img.width = 18; img.height = 18;
    const name = h("span", "rr-name", phone ? s.team.initials : s.team.name);
    name.title = s.team.name;
    const val = h("strong", "rr-val", fmtValue(metric, p.v));
    const chg = h("span", `rr-chg ${changeClass(metric, p.dv)}`, fmtChange(metric, p.dv));
    const sp = h("span", "rr-sp", p.dSp == null ? "—" : `+${p.dSp} ${state.mode === "clean" ? "clean " : ""}sp`);
    sp.title = state.mode === "clean" ? "Clean spaces used since the previous Pablete" : "Spaces used since the previous Pablete";
    li.append(key, img, name, val, chg, sp);
    list.append(li);
  }
  box.append(list);
  box.append(h("p", "rr-foot", `Change since the previous Pablete · ${state.mode === "clean" ? "clean spaces" : "spaces"} (sp) used since then`));
  return box;
}

// Push end labels apart so logos never overlap; returns label y per item (mutates .ly).
function dodge(items, top, bottom, gap) {
  items.sort((a, b) => a.y - b.y);
  items.forEach((d, i) => { d.ly = Math.max(d.y, i ? items[i - 1].ly + gap : top); });
  for (let i = items.length - 1; i >= 0; i--) {
    const max = i === items.length - 1 ? bottom : items[i + 1].ly - gap;
    if (items[i].ly > max) items[i].ly = max;
  }
  return items;
}

/**
 * Render The Race into `host`.
 * ctx: { cfg, data, state: { mode, metric, selected:Set, raceMs }, onPickTeam(id), onDate(ms) }
 */
export function renderRace(host, ctx) {
  const { cfg, data, state } = ctx;
  const metric = state.metric;
  const W = Math.max(280, Math.floor(host.clientWidth));
  const phone = W < 640;
  const H = phone ? 320 : 380;
  const m = { top: 16, right: phone ? 40 : 200, bottom: 30, left: phone ? 40 : 52 };
  const series = buildSeries(cfg, data, metric, state.mode);
  const isSel = id => state.selected.has(id);

  // ----- scales -----
  const [d0, d1] = d3.extent(data.dates);
  const padMs = d0 === d1 ? 86400000 : 0;
  const x = d3.scaleUtc().domain([d0 - padMs, d1 + padMs]).range([m.left + 10, W - m.right - 10]);
  let y, yTicks;
  if (metric === "rank") {
    const n = Math.max(cfg.teams.length, d3.max(series, s => d3.max(s.points, p => p.v)) || 1);
    y = d3.scaleLinear().domain([1, n]).range([m.top + 6, H - m.bottom - 6]);
    yTicks = d3.range(1, n + 1);
  } else {
    const vals = series.flatMap(s => s.points.map(p => p.v)).filter(v => v != null);
    let [lo, hi] = d3.extent(vals);
    if (metric === "gap") hi = 0;
    if (lo === hi) { lo -= 1; hi += 1; }
    y = d3.scaleLinear().domain([lo, hi]).nice(phone ? 4 : 6).range([H - m.bottom, m.top]);
    yTicks = y.ticks(phone ? 4 : 6);
  }
  const step = yTicks.length > 1 ? Math.abs(yTicks[1] - yTicks[0]) : 1;
  const fmtY = v => fmtNum(v, step < 1 ? 1 : 0);
  const plotW = W - m.left - m.right;
  // Label the Pablete dates themselves; drop any that would collide, always keep the latest.
  const minGapPx = 40;
  const xTicks = [];
  for (const d of [...data.dates].reverse()) {
    if (!xTicks.length || x(xTicks.at(-1)) - x(d) >= minGapPx) xTicks.push(d);
  }
  xTicks.reverse();
  void plotW;

  // ----- svg -----
  const svg = d3.create("svg")
    .attr("class", "race-svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("width", W).attr("height", H)
    .attr("tabindex", 0)
    .attr("role", "img")
    .attr("aria-label", `The Race, ${METRICS[metric].label.toLowerCase()} by Pablete date, ${fmtDate(d0)} to ${fmtDate(d1)}. Use the left and right arrow keys to read each date.`);

  svg.append("g").attr("class", "race-grid")
    .selectAll("line").data(yTicks).join("line")
    .attr("x1", m.left).attr("x2", W - m.right).attr("y1", d => y(d)).attr("y2", d => y(d));

  svg.append("g").attr("class", "race-axis")
    .selectAll("text").data(yTicks).join("text")
    .attr("x", m.left - 8).attr("y", d => y(d)).attr("dy", "0.32em").attr("text-anchor", "end")
    .text(d => (metric === "rank" ? d : fmtY(d)));

  svg.append("g").attr("class", "race-axis")
    .selectAll("text").data(xTicks).join("text")
    .attr("x", d => x(d)).attr("y", H - m.bottom + 19)
    .attr("text-anchor", (d, i) => (xTicks.length > 1 && i === 0 && x(d) - m.left < 18 ? "start" : xTicks.length > 1 && i === xTicks.length - 1 && W - m.right - x(d) < 18 ? "end" : "middle"))
    .text(d => dayMonth(d));

  // crosshair (under the lines)
  const cross = svg.append("line").attr("class", "race-cross").attr("y1", m.top).attr("y2", H - m.bottom).style("display", "none");

  // ----- lines: faded teams first, selected on top -----
  const line = d3.line().defined(p => p.v != null).x(p => x(p.ms)).y(p => y(p.v))
    .curve(metric === "rank" ? d3.curveBumpX : d3.curveLinear);
  const gLines = svg.append("g");
  const ordered = [...series].sort((a, b) => isSel(a.team.id) - isSel(b.team.id));
  for (const s of ordered) {
    const sel = isSel(s.team.id);
    const g = gLines.append("g").attr("class", "race-team").attr("opacity", sel ? 1 : 0.15).attr("data-team", s.team.id);
    g.append("path").attr("d", line(s.points)).attr("fill", "none").attr("stroke", s.team.color)
      .attr("stroke-width", 2).attr("stroke-linejoin", "round").attr("stroke-linecap", "round");
    g.selectAll("circle").data(s.points.filter(p => p.v != null)).join("circle")
      .attr("cx", p => x(p.ms)).attr("cy", p => y(p.v)).attr("r", 4)
      .attr("fill", s.team.color).attr("stroke", "#fff").attr("stroke-width", 2);
    g.append("path").attr("class", "race-hit").attr("d", line(s.points.length > 1 ? s.points : [s.points[0], s.points[0]]))
      .attr("fill", "none").attr("stroke", "transparent").attr("stroke-width", 16)
      .append("title").text(`${s.team.name} — tap to select`);
    g.select(".race-hit").on("click", ev => { ev.stopPropagation(); ctx.onPickTeam(s.team.id); });
  }

  // ----- end labels: logo (+ name on desktop), dodged, with leader lines -----
  const ends = series.map(s => {
    const last = [...s.points].reverse().find(p => p.v != null);
    return last ? { s, x: x(last.ms), y: y(last.v) } : null;
  }).filter(Boolean);
  dodge(ends, m.top + 11, H - m.bottom - 11, 25);
  const lx = W - m.right + 14;
  const gLabels = svg.append("g").attr("class", "race-labels");
  for (const d of [...ends].sort((a, b) => isSel(a.s.team.id) - isSel(b.s.team.id))) {
    const t = d.s.team;
    const g = gLabels.append("g").attr("class", "race-label").attr("opacity", isSel(t.id) ? 1 : 0.15)
      .attr("role", "button").attr("aria-label", `${t.name}: select`)
      .on("click", ev => { ev.stopPropagation(); ctx.onPickTeam(t.id); });
    g.append("path").attr("class", "race-leader").attr("d", `M${d.x + 6},${d.y} L${lx - 15},${d.ly}`);
    g.append("circle").attr("cx", lx).attr("cy", d.ly).attr("r", 12.5).attr("fill", "#fff").attr("stroke", t.color).attr("stroke-width", 2);
    g.append("image").attr("href", t.logo).attr("x", lx - 9).attr("y", d.ly - 9).attr("width", 18).attr("height", 18)
      .attr("preserveAspectRatio", "xMidYMid meet");
    if (!phone) g.append("text").attr("class", "race-name").attr("x", lx + 19).attr("y", d.ly).attr("dy", "0.32em").text(t.name);
    g.append("title").text(t.name);
  }

  // highlighted points at the active date (above everything)
  const gHl = svg.append("g").attr("class", "race-hl").style("pointer-events", "none");

  // ----- tooltip / readout -----
  const wrap = h("div", "race-wrap");
  const tip = h("div", "race-tip");
  tip.hidden = true;
  const panel = h("div", "race-readout");
  wrap.append(svg.node(), tip);

  const nearest = px => d3.least(data.dates, d => Math.abs(x(d) - px));
  function mark(ms) {
    cross.style("display", null).attr("x1", x(ms)).attr("x2", x(ms));
    gHl.selectAll("circle")
      .data(series.filter(s => isSel(s.team.id)).map(s => ({ s, p: s.points.find(p => p.ms === ms) })).filter(r => r.p && r.p.v != null))
      .join("circle").attr("cx", r => x(ms)).attr("cy", r => y(r.p.v)).attr("r", 6)
      .attr("fill", r => r.s.team.color).attr("stroke", "#fff").attr("stroke-width", 2);
  }
  function showFloating(ms) {
    mark(ms);
    tip.replaceChildren(readout(ctx, series, ms, { phone: false }));
    tip.hidden = false;
    const tw = tip.offsetWidth;
    let left = x(ms) + 16;
    if (left + tw > W - 4) left = Math.max(4, x(ms) - 16 - tw);
    tip.style.left = `${left}px`;
    tip.style.top = `${m.top}px`;
  }
  function showPanel(ms) {
    mark(ms);
    panel.replaceChildren(readout(ctx, series, ms, { phone }));
  }
  const show = ms => (phone ? showPanel(ms) : showFloating(ms));

  svg.on("pointermove", ev => {
    if (ev.pointerType !== "mouse" || phone) return;
    show(nearest(d3.pointer(ev)[0]));
  });
  svg.on("pointerleave", ev => {
    if (ev.pointerType !== "mouse" || phone) return;
    tip.hidden = true; cross.style("display", "none"); gHl.selectAll("*").remove();
  });
  svg.on("pointerdown", ev => {
    const ms = nearest(d3.pointer(ev)[0]);
    ctx.onDate(ms);
    show(ms);
  });
  svg.on("keydown", ev => {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    ev.preventDefault();
    const cur = state.raceMs ?? d1;
    const i = Math.max(0, Math.min(data.dates.length - 1, data.dates.indexOf(cur) + (ev.key === "ArrowRight" ? 1 : -1)));
    ctx.onDate(data.dates[i]);
    show(data.dates[i]);
  });
  svg.on("blur", () => { if (!phone) { tip.hidden = true; cross.style("display", "none"); gHl.selectAll("*").remove(); } });

  const parts = [wrap];
  if (phone) {
    parts.push(panel);
    showPanel(data.dates.includes(state.raceMs) ? state.raceMs : d1);
  }
  host.replaceChildren(
    h("p", "race-caption", axisCaption(metric, state.mode)),
    ...parts);
}
