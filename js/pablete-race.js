// Pablete ESPN ☕ — "The Race", editorial line chart with a time scrubber.
// Hierarchy first: two highlighted teams (the headline's protagonists, or the viewer's picks)
// in thick colour lines with a surface halo, everything else thin grey for context.
// Opens on the latest Pablete; "↺ Replay the season" plays from the first one. Drag the chart
// or the date rail, or use the arrow keys. Hover (desktop) or tap (phone) a date for exact
// values. Rank is a bump chart with logo nodes. D3 is pinned, loaded from jsDelivr.

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import { fmtNum, fmtDate } from "./pablete-data.js";
import { story, leagueAvg } from "./pablete-story.js";

export const METRICS = {
  gap: { label: "Gap to leader", short: "Gap" },
  points: { label: "Total points", short: "Points" },
  avgvl: { label: "Avg vs league", short: "League" },
  avg: { label: "Average", short: "Avg" },
  rank: { label: "Rank", short: "Rank" },
};

const GREY = "#D3D1C7";
const SURFACE = "#FFFFFF";
const STEP_MS = 600; // per Pablete while playing
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad2 = n => String(n).padStart(2, "0");
const dayMonth = ms => { const d = new Date(ms); return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}`; };

let active = null; // the chart currently on the page (its timers stop when it is redrawn)

function axisCaption(metric, mode) {
  const sp = mode === "clean" ? "clean space" : "space";
  if (metric === "gap") return "Points behind the leader";
  if (metric === "points") return "Total points";
  if (metric === "avgvl") return `Points per ${sp}, minus the league's`;
  if (metric === "avg") return mode === "clean" ? "Points per clean space (without outs)" : "Points per space (spaces include outs)";
  return "Rank by total points";
}

function fmtValue(metric, v) {
  if (v == null) return "";
  if (metric === "gap") return Math.round(v) === 0 ? "Leader" : fmtNum(Math.round(v), 0);
  if (metric === "avgvl") return Math.abs(v) < 0.005 ? "0.00" : fmtNum(v, 2, { sign: true });
  if (metric === "avg") return fmtNum(v, 2);
  if (metric === "rank") return `#${Math.round(v)}`;
  return fmtNum(Math.round(v), 0);
}

// teamId -> value per date index (null where the team has no row); plus league average per date
function valuesFor(cfg, data, metric, mode) {
  const out = new Map(cfg.teams.map(t => [t.id, data.dates.map(() => null)]));
  const league = data.dates.map(ms => leagueAvg(data.byDate.get(ms), mode));
  data.dates.forEach((ms, i) => {
    const entries = data.byDate.get(ms);
    const lead = Math.max(...entries.map(e => e.points));
    for (const e of entries) {
      const arr = out.get(e.teamId);
      if (!arr) continue;
      const avg = mode === "clean" ? e.avgClean : e.avg;
      arr[i] = metric === "gap" ? e.points - lead
        : metric === "points" ? e.points
        : metric === "avgvl" ? (avg == null || league[i] == null ? null : avg - league[i])
        : metric === "avg" ? avg
        : e.rank;
    }
  });
  return { vals: out, league };
}

// Push labels of different heights apart (centres sorted by y); sets .ly on each item.
function dodge(items, top, bottom) {
  items.sort((a, b) => a.y - b.y);
  items.forEach((d, i) => {
    const min = i ? items[i - 1].ly + (items[i - 1].h + d.h) / 2 + 1 : top + d.h / 2;
    d.ly = Math.max(d.y, min);
  });
  for (let i = items.length - 1; i >= 0; i--) {
    const d = items[i];
    const max = i === items.length - 1 ? bottom - d.h / 2 : items[i + 1].ly - (items[i + 1].h + d.h) / 2 - 1;
    if (d.ly > max) d.ly = max;
  }
  return items;
}

let measureCtx = null;
function textWidth(text, font) {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/**
 * Render The Race into `host`.
 * ctx: { cfg, data, state: { mode, metric, selected:Set, focus, zoom, racePos, racePlaying },
 *        onPickTeam(id), onZoom(on) }
 */
export function renderRace(host, ctx) {
  active?.stop();
  const { cfg, data, state } = ctx;
  const { metric, mode } = state;
  const isRank = metric === "rank";
  const dates = data.dates;
  const last = dates.length - 1;
  const W = Math.max(280, Math.floor(host.clientWidth));
  const phone = W < 640;
  const plotH = phone ? 300 : 360;
  const railTop = plotH + 14;
  const H = plotH + 52;
  const m = { top: 12, right: phone ? 86 : 200, left: phone ? 38 : 50 };
  const plotBottom = plotH - 6;
  const { vals, league } = valuesFor(cfg, data, metric, mode);
  const teams = cfg.teams.filter(t => vals.get(t.id).some(v => v != null));
  const F = {
    name: `600 ${phone ? 12 : 13}px Barlow, system-ui, sans-serif`,
    grey: `500 ${phone ? 10.5 : 11}px Barlow, system-ui, sans-serif`,
    badge: "700 11.5px Barlow, system-ui, sans-serif",
  };
  const W_HL = isRank ? 10 : 5, W_GREY = isRank ? 4 : 2, W_HALO = isRank ? 16 : 10;

  let pos = clamp(Number.isFinite(state.racePos) ? state.racePos : last, 0, last);

  // ----- x: real time; y: tight to the data (8% padding), or zoomed to the highlighted teams -----
  const d0 = dates[0], dN = dates[last];
  const padMs = d0 === dN ? 86400000 : 0;
  const x = d3.scaleUtc().domain([d0 - padMs, dN + padMs]).range([m.left + 12, W - m.right]);
  const y = d3.scaleLinear();
  const nRanks = Math.max(teams.length, 1);
  function domainFor(ids) {
    const vs = ids.flatMap(id => vals.get(id) ?? []).filter(v => v != null);
    if (!vs.length) return [0, 1];
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (metric === "avgvl") { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad];
  }
  const fullDomain = isRank ? [1, nRanks] : domainFor(teams.map(t => t.id));
  let dom = fullDomain;
  const setY = () => (isRank
    ? y.domain([1, nRanks]).range([m.top + 14, plotBottom - 14])
    : y.domain(dom).range([plotBottom, m.top]));
  setY();

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
    for (let i = 0; i <= Math.min(i0, last); i++) if (arr[i] != null) pts.push({ x: x(dates[i]), y: y(arr[i]), v: arr[i], i, real: true });
    if (f > 1e-6 && i0 < last && arr[i0] != null && arr[i0 + 1] != null) {
      const v = arr[i0] + (arr[i0 + 1] - arr[i0]) * f;
      pts.push({ x: x(timeAt(p)), y: y(v), v, i: null, real: false });
    }
    return pts;
  }

  // ----- DOM -----
  const headline = h("h3", "race-headline");
  const dek = h("p", "race-dek");
  const caption = h("p", "race-caption", axisCaption(metric, mode));
  const zoomBtn = h("button", "race-zoom", "Zoom to selection");
  zoomBtn.type = "button";
  zoomBtn.setAttribute("aria-pressed", String(!!state.zoom));
  zoomBtn.title = "Fit the vertical scale to the highlighted teams";
  zoomBtn.hidden = isRank;
  const capRow = h("div", "race-caprow");
  capRow.append(caption, zoomBtn);
  const live = h("p", "visually-hidden");
  live.setAttribute("aria-live", "polite");

  const svg = d3.create("svg")
    .attr("class", `race-svg${isRank ? " is-rank" : ""}`)
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("width", W).attr("height", H)
    .attr("role", "group")
    .attr("aria-label", `The Race: ${METRICS[metric].label.toLowerCase()} by Pablete date, ${fmtDate(d0)} to ${fmtDate(dN)}. Drag horizontally or use the date slider to move through the season.`);

  const gTint = svg.append("g").attr("class", "race-tint");
  const gGrid = svg.append("g").attr("class", "race-grid");
  const gAxis = svg.append("g").attr("class", "race-axis");
  const gZero = svg.append("g").attr("class", "race-zero");
  const cross = svg.append("line").attr("class", "race-cross").attr("y1", m.top).attr("y2", plotBottom).style("display", "none");
  const gGrey = svg.append("g").attr("class", "race-greys");
  const gGreyLabels = svg.append("g").attr("class", "race-glabels");
  const gHl = svg.append("g").attr("class", "race-hls");
  const gZeroLabel = svg.append("g").attr("class", "race-zero");
  const gNodes = svg.append("g").attr("class", "race-nodes");
  const gLabels = svg.append("g").attr("class", "race-labels");
  const gBadges = svg.append("g").attr("class", "race-badges").attr("aria-hidden", "true");

  // ----- date rail: thin track, a tick per Pablete, handle -----
  const gRail = svg.append("g").attr("class", "race-rail")
    .attr("tabindex", dates.length > 1 ? 0 : -1)
    .attr("role", "slider")
    .attr("aria-label", "Pablete date")
    .attr("aria-valuemin", 1).attr("aria-valuemax", dates.length);
  gRail.append("rect").attr("x", x(d0) - 14).attr("y", railTop - 14)
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

  const playBtn = h("button", "race-play");
  playBtn.type = "button";
  const status = h("span", "race-status");
  const hint = h("span", "race-hint", phone
    ? "Drag the chart to move through the season · tap a date for values"
    : "Drag the chart, or use the slider and arrow keys · hover for values");
  const controls = h("div", "race-controls-row");
  controls.append(playBtn, status, hint);
  if (dates.length < 2) playBtn.disabled = true;

  host.replaceChildren(headline, dek, capRow, wrap, controls, live);

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

  // ----- axes (redrawn when the y domain changes) -----
  function drawAxes() {
    setY();
    if (isRank) {
      gGrid.selectAll("*").remove();
      gAxis.selectAll("text").data(d3.range(1, nRanks + 1)).join("text")
        .attr("x", m.left - 10).attr("y", d => y(d)).attr("dy", "0.32em").attr("text-anchor", "end").text(d => d);
      return;
    }
    let ticks = d3.ticks(dom[0], dom[1], metric === "avgvl" ? 4 : 3);
    if (ticks.length > 4) ticks = d3.ticks(dom[0], dom[1], 2);
    if (metric === "avgvl") ticks = ticks.filter(t => Math.abs(t) > 1e-9);
    const stepT = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
    const dec = stepT < 0.1 ? 2 : stepT < 1 ? 1 : 0;
    gGrid.selectAll("line").data(ticks).join("line")
      .attr("x1", m.left).attr("x2", W - m.right + (phone ? 0 : 10)).attr("y1", d => y(d)).attr("y2", d => y(d));
    gAxis.selectAll("text").data(ticks).join("text")
      .attr("x", m.left - 8).attr("y", d => y(d)).attr("dy", "0.32em").attr("text-anchor", "end")
      .text(d => fmtNum(d, dec, { sign: metric === "avgvl" }));
    if (metric === "avgvl") {
      const y0 = y(0), yt = y(dom[1]), yb = y(dom[0]);
      gTint.selectAll("rect").data([["above", yt, y0], ["below", y0, yb]]).join("rect")
        .attr("class", d => `tint-${d[0]}`).attr("x", m.left).attr("width", W - m.right - m.left + (phone ? 0 : 10))
        .attr("y", d => d[1]).attr("height", d => Math.max(0, d[2] - d[1]));
      gTint.selectAll("text").data([["above", "Above the league", yt + 14], ["below", "Below the league", yb - 6]]).join("text")
        .attr("class", d => `tint-label tint-label-${d[0]}`).attr("x", m.left + 6).attr("y", d => d[2]).text(d => d[1]);
      gZero.selectAll("line").data([0]).join("line").attr("x1", m.left).attr("x2", W - m.right + (phone ? 0 : 10)).attr("y1", y0).attr("y2", y0);
      if (shownK >= 0) drawZeroLabel(shownK);
    }
  }
  function drawZeroLabel(k) {
    if (metric !== "avgvl") return;
    const lg = league[k];
    gZeroLabel.selectAll("text").data([0]).join("text").attr("x", m.left + 6).attr("y", y(0) - 5)
      .text(lg == null ? "League average" : `League average (${fmtNum(lg, 1)})`);
  }

  // ----- highlight + scale targets -----
  let shownK = -1, st = null, hlSet = new Set(), hitBoxes = [], inspectK = null;

  function highlighted() {
    if (state.selected.size) return new Set(state.selected);
    const s = new Set(st.spotlight);
    if (state.focus) s.add(state.focus);
    return s;
  }
  const targetDomain = () => (isRank ? fullDomain : state.zoom && hlSet.size && hlSet.size < teams.length ? domainFor([...hlSet]) : fullDomain);

  let domTimer = null;
  function retarget(instant) {
    const to = targetDomain();
    if (Math.abs(to[0] - dom[0]) < 1e-9 && Math.abs(to[1] - dom[1]) < 1e-9) return;
    domTimer?.stop();
    if (instant || REDUCED.matches) { dom = to; drawAxes(); return; }
    const from = dom.slice(), ip = d3.interpolate(from, to);
    domTimer = d3.timer(el => {
      const t = Math.min(1, el / 450);
      dom = ip(d3.easeCubicInOut(t));
      drawAxes(); draw(true);
      if (t >= 1) { domTimer.stop(); domTimer = null; }
    });
  }

  function updateWords(k) {
    st = story(cfg, data, k, metric, mode);
    hlSet = highlighted();
    headline.textContent = st.headline;
    dek.textContent = st.dek;
    status.textContent = `Pablete ${k + 1} of ${dates.length} · ${fmtDate(dates[k])}`;
    gRail.attr("aria-valuenow", k + 1).attr("aria-valuetext", `Pablete ${k + 1} of ${dates.length}, ${fmtDate(dates[k])}`);
    railText.classed("on", d => d === dates[k]);
    drawZeroLabel(k);
  }

  const line = d3.line().x(p => p.x).y(p => p.y).curve(isRank ? d3.curveMonotoneX : d3.curveLinear);

  function draw(fromDomainTween) {
    const k = Math.round(pos);
    if (k !== shownK) {
      shownK = k; updateWords(k);
      if (!fromDomainTween) retarget(false);
    }
    const items = teams.map(t => {
      const pts = pathPoints(vals.get(t.id), pos);
      return { t, pts, head: pts.at(-1), on: hlSet.has(t.id) };
    }).filter(d => d.head);
    const greys = items.filter(d => !d.on), hls = items.filter(d => d.on);
    const lineD = d => (d.pts.length > 1 ? line(d.pts) : `M${d.head.x},${d.head.y}h0`);

    // context: thin grey lines
    gGrey.selectAll("path").data(greys, d => d.t.id).join("path")
      .attr("class", "race-line").attr("stroke", GREY).attr("stroke-width", W_GREY).attr("d", lineD);
    // highlighted: surface halo underneath, then the thick team-colour line (drawn last)
    const hlG = gHl.selectAll("g").data(hls, d => d.t.id).join(enter => {
      const g = enter.append("g");
      g.append("path").attr("class", "race-line race-halo").attr("stroke", SURFACE).attr("stroke-width", W_HALO);
      g.append("path").attr("class", "race-line race-hl").attr("stroke-width", W_HL);
      return g;
    });
    hlG.select(".race-halo").attr("d", lineD);
    hlG.select(".race-hl").attr("stroke", d => d.t.color).attr("d", lineD);

    // nodes: rank → a logo at every Pablete (and the moving head); other metrics → end dot only
    const R = 11.5;
    // logo nodes never overlap along a ribbon: skip a node closer than 24px to the next kept one
    const spaced = d => {
      const ps = d.pts.filter(p => p.real || p === d.head), keep = [];
      for (let j = ps.length - 1; j >= 0; j--) if (!keep.length || keep.at(-1).x - ps[j].x >= 24) keep.push(ps[j]);
      return keep;
    };
    const nodeData = isRank
      ? hls.flatMap(d => spaced(d).map(p => ({ id: `${d.t.id}-${p.i ?? "h"}`, t: d.t, p })))
      : hls.map(d => ({ id: d.t.id, t: d.t, p: d.head }));
    gNodes.selectAll("g.race-node").data(nodeData, n => n.id).join(enter => {
      const g = enter.append("g").attr("class", "race-node");
      if (isRank) {
        g.append("circle").attr("r", R).attr("fill", SURFACE).attr("stroke-width", 2.5);
        g.append("image").attr("x", -9).attr("y", -9).attr("width", 18).attr("height", 18).attr("preserveAspectRatio", "xMidYMid meet");
      } else {
        g.append("circle").attr("r", 4).attr("stroke", SURFACE).attr("stroke-width", 2);
      }
      return g;
    })
      .attr("transform", n => `translate(${n.p.x},${n.p.y})`)
      .call(g => g.select("circle").attr(isRank ? "stroke" : "fill", n => n.t.color))
      .call(g => g.select("image").attr("href", n => n.t.logo));

    // end labels: highlighted = (logo +) name + value; grey = small grey name. Dodged together.
    hitBoxes = [];
    const hlH = phone ? 26 : 30, gH = 13;
    const labels = [
      ...hls.map(d => ({ d, on: true, y: d.head.y, h: hlH })),
      ...greys.map(d => ({ d, on: false, y: d.head.y, h: gH })),
    ];
    dodge(labels, m.top, plotBottom);

    const hlL = gLabels.selectAll("g.race-label").data(labels.filter(l => l.on), l => l.d.t.id).join(enter => {
      const g = enter.append("g").attr("class", "race-label");
      g.append("path").attr("class", "race-leader");
      if (!isRank) {
        g.append("circle").attr("r", 10).attr("fill", SURFACE).attr("stroke-width", 2);
        g.append("image").attr("width", 15).attr("height", 15).attr("preserveAspectRatio", "xMidYMid meet");
      }
      g.append("text").attr("class", "race-name");
      g.append("text").attr("class", "race-val");
      g.append("title");
      return g;
    });
    hlL.each(function (l) {
      const g = d3.select(this), t = l.d.t, hx = l.d.head.x, hy = l.d.head.y;
      const lx = isRank ? hx + R + 6 : hx + 20;        // logo centre (non-rank) or text start (rank)
      const tx = isRank ? lx : lx + 14;
      const startX = isRank ? hx + R : hx + 6;
      const endX = isRank ? lx - 2 : lx - 10;
      g.select("path").attr("d", Math.abs(l.ly - hy) < 1.5 ? `M${startX},${hy}H${endX}` : `M${startX},${hy}L${endX},${l.ly}`)
        .style("display", isRank && Math.abs(l.ly - hy) < 1.5 ? "none" : null);
      if (!isRank) {
        g.select("circle").attr("cx", lx).attr("cy", l.ly).attr("stroke", t.color);
        g.select("image").attr("href", t.logo).attr("x", lx - 7.5).attr("y", l.ly - 7.5);
      }
      const name = phone ? t.initials : t.name;
      g.select(".race-name").attr("x", tx).attr("y", l.ly).attr("dy", "-0.15em").text(name);
      g.select(".race-val").attr("x", tx).attr("y", l.ly).attr("dy", "1.0em").text(fmtValue(metric, l.d.head.v));
      g.select("title").text(t.name);
      const w = Math.max(textWidth(name, F.name), textWidth(fmtValue(metric, l.d.head.v), F.name)) + (tx - lx) + 14;
      hitBoxes.push({ id: t.id, x: lx - 12, y: l.ly - hlH / 2, w, h: hlH });
    });

    const gl = gGreyLabels.selectAll("g").data(labels.filter(l => !l.on), l => l.d.t.id).join(enter => {
      const g = enter.append("g");
      g.append("path").attr("class", "race-gleader");
      g.append("text").attr("class", "race-gname");
      g.append("title");
      return g;
    });
    gl.each(function (l) {
      const g = d3.select(this), t = l.d.t, hx = l.d.head.x, hy = l.d.head.y;
      const tx = hx + (isRank ? 9 : 7);
      g.select("path").attr("d", Math.abs(l.ly - hy) < 1.5 ? null : `M${hx + 3},${hy}L${tx - 2},${l.ly}`);
      const name = phone ? t.initials : t.name;
      g.select("text").attr("x", tx).attr("y", l.ly).attr("dy", "0.34em").text(name);
      g.select("title").text(`${t.name} — tap to highlight`);
      hitBoxes.push({ id: t.id, x: hx - 4, y: l.ly - 8, w: textWidth(name, F.grey) + (tx - hx) + 8, h: 16 });
    });

    drawBadges(hls);
    const hx = x(timeAt(pos));
    progress.attr("x2", hx);
    handle.attr("cx", hx);
  }

  // ----- exact values: badges on the highlighted points of the inspected date (≤ 3 teams) -----
  function drawBadges(hls) {
    const k = inspectK;
    if (k == null || k > Math.floor(pos + 1e-6) || hls.length > 3) {
      gBadges.selectAll("*").remove();
      if (tip.hidden) cross.style("display", "none");
      return;
    }
    const bx = x(dates[k]);
    cross.style("display", null).attr("x1", bx).attr("x2", bx);
    const items = hls.map(d => ({ t: d.t, v: vals.get(d.t.id)[k] })).filter(o => o.v != null)
      .map(o => ({ ...o, y: y(o.v), h: 20, text: fmtValue(metric, o.v) }));
    dodge(items, m.top, plotBottom);
    const off = isRank ? 16 : 9;
    const g = gBadges.selectAll("g").data(items, o => o.t.id).join(enter => {
      const e = enter.append("g").attr("class", "race-badge");
      e.append("rect").attr("rx", 9).attr("height", 18);
      e.append("text").attr("dy", "0.34em");
      return e;
    });
    g.each(function (o) {
      const w = textWidth(o.text, F.badge) + 12;
      const right = bx + off + w <= W - 4;
      const left = right ? bx + off : bx - off - w;
      const s = d3.select(this);
      s.select("rect").attr("x", left).attr("y", o.ly - 9).attr("width", w).attr("stroke", o.t.color);
      s.select("text").attr("x", left + w / 2).attr("y", o.ly).text(o.text);
    });
  }
  function setInspect(k) {
    inspectK = k;
    draw(true);
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
    if (!playing) live.textContent = `${fmtDate(dates[Math.round(pos)])}: ${st?.headline ?? ""}`;
  }
  function moving() { if (inspectK != null) { inspectK = null; hideTip(); } }

  function animateTo(target, dur, done) {
    stopAnim();
    moving();
    target = clamp(target, 0, last);
    if (REDUCED.matches || dur <= 0 || Math.abs(target - pos) < 1e-6) { setPos(target); settle(); done?.(); return; }
    const from = pos;
    timer = d3.timer(elapsed => {
      const t = Math.min(1, elapsed / dur);
      setPos(from + (target - from) * d3.easeCubicInOut(t));
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
    if (REDUCED.matches) waitT = setTimeout(() => { setPos(target); stepPlay(); }, 900);
    else animateTo(target, STEP_MS * (target - pos), stepPlay);
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

  zoomBtn.addEventListener("click", () => {
    state.zoom = !state.zoom;
    zoomBtn.setAttribute("aria-pressed", String(state.zoom));
    ctx.onZoom?.(state.zoom);
    retarget(false);
  });

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

  // ----- slim desktop tooltip: revealed Pablete nearest the mouse, highlighted teams only -----
  function hideTip() { tip.hidden = true; if (inspectK == null) cross.style("display", "none"); }
  function showTip(k) {
    const rows = teams.filter(t => hlSet.has(t.id) && vals.get(t.id)[k] != null)
      .map(t => ({ t, v: vals.get(t.id)[k], prev: k > 0 ? vals.get(t.id)[k - 1] : null }))
      .sort((a, b) => (isRank ? a.v - b.v : b.v - a.v));
    if (!rows.length) { tip.hidden = true; return; }
    const head = h("p", "rt-head");
    head.append(h("strong", null, fmtDate(dates[k])), h("span", "muted", k > 0 ? ` · vs ${dayMonth(dates[k - 1])}` : " · first Pablete"));
    if (metric === "avgvl" && league[k] != null) head.append(h("span", "muted", ` · league ${fmtNum(league[k], 2)}`));
    const list = h("ul", "rt-list");
    for (const r of rows) {
      const li = h("li");
      const img = h("img"); img.src = r.t.logo; img.alt = ""; img.width = 16; img.height = 16;
      const d = r.prev == null ? null : r.v - r.prev;
      const better = d == null || Math.abs(d) < 1e-9 ? "flat" : (isRank ? d < 0 : d > 0) ? "up" : "down";
      const chg = d == null ? "—" : Math.abs(d) < 1e-9 ? "=" : isRank ? (d < 0 ? `▲${-d}` : `▼${d}`)
        : fmtNum(d, metric === "avg" || metric === "avgvl" ? 2 : 0, { sign: true });
      li.append(img, h("span", "rt-name", r.t.name), h("strong", "rt-val", fmtValue(metric, r.v)), h("span", `rt-chg ${better}`, chg));
      list.append(li);
    }
    tip.replaceChildren(head, list);
    tip.hidden = false;
    const tw = tip.offsetWidth, cx = x(dates[k]);
    // the tooltip sits left of the date line; value badges sit to the right of the points
    let left = cx - 14 - tw;
    if (left < 4) left = cx + 14 + 70;
    tip.style.left = `${clamp(left, 4, W - tw - 4)}px`;
    tip.style.top = `${m.top}px`;
  }
  const revealedNearest = px => {
    const upto = Math.floor(pos + 1e-6);
    return d3.minIndex(dates.slice(0, upto + 1), d => Math.abs(x(d) - px));
  };

  // Drag horizontally anywhere on the chart; a short tap picks a team or inspects a date.
  let drag = null;
  const svgNode = svg.node();
  svg.on("pointerdown", ev => {
    if (ev.button > 0) return;
    const [px, py] = d3.pointer(ev, svgNode);
    drag = { id: ev.pointerId, x0: px, y0: py, moved: false, onRail: py > plotH };
    try { svgNode.setPointerCapture(ev.pointerId); } catch { /* not capturable */ }
  });
  svg.on("pointermove", ev => {
    if (!drag && ev.pointerType === "mouse" && !phone && !playing && !timer) {
      const [px, py] = d3.pointer(ev, svgNode);
      if (py <= plotH && px >= m.left - 10) {
        const k = revealedNearest(px);
        if (k !== inspectK) { setInspect(k); showTip(k); }
      } else if (inspectK != null) { inspectK = null; hideTip(); draw(true); }
      return;
    }
    if (!drag || ev.pointerId !== drag.id) return;
    const [px, py] = d3.pointer(ev, svgNode);
    if (!drag.moved) {
      const dx = Math.abs(px - drag.x0), dy = Math.abs(py - drag.y0);
      if (dx < 6 || dx < dy) return;
      drag.moved = true;
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
      const k = nearestIndex(px);
      if (k <= Math.floor(pos + 1e-6)) {
        if (ev.pointerType !== "mouse") setInspect(inspectK === k ? null : k);
        return;
      }
    }
    goTo(nearestIndex(px));
  };
  svg.on("pointerup", ev => endDrag(ev, false));
  svg.on("pointercancel", ev => endDrag(ev, true));
  svg.on("pointerleave", ev => {
    if (ev.pointerType === "mouse" && inspectK != null) { inspectK = null; hideTip(); draw(true); }
  });

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
  st = story(cfg, data, Math.round(pos), metric, mode);
  hlSet = highlighted();
  dom = targetDomain();
  drawAxes();
  draw();
  if (wasPlaying && last > 0 && pos < last - 1e-6) play();
  else if (Math.abs(pos - Math.round(pos)) > 1e-6) animateTo(Math.round(pos), 150);
  else settle();

  active = { stop: () => { stopAnim(); domTimer?.stop(); playing = false; } };
  return active;
}
