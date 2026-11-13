// Pablete ESPN ☕ — page: visuals first. Team chip bar + With/Without outs toggle drive every
// chart; "The Race" line chart; the full sortable table at the bottom.
// Data comes from js/pablete-data.js; charts load D3 lazily from js/pablete-race.js so the
// page still works (table included) if the chart library can't be fetched.

import { mountChrome, el, teamById, crownsOf } from "./ui.js";
import { loadPablete, buildPablete, fmtDate, fmtStamp, fmtNum } from "./pablete-data.js";

const root = document.getElementById("pablete");
const MODE_KEY = "pablete_mode_v1";
const SEL_KEY = "pablete_sel_v1";
const METRIC_KEY = "pablete_metric_v1";
const PHONE = window.matchMedia("(max-width: 640px)");
const METRIC_LABELS = { gap: ["Gap to leader", "Gap"], points: ["Total points", "Points"], avg: ["Average", "Average"], rank: ["Rank", "Rank"] };

// ---------- per-viewer preferences (never required to work) ----------

function readPref(key) { try { return localStorage.getItem(key); } catch { return null; } }
function savePref(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } }

function readSelection(cfg) {
  const ids = new Set(cfg.teams.map(t => t.id));
  try {
    const raw = JSON.parse(readPref(SEL_KEY));
    if (Array.isArray(raw)) return new Set(raw.filter(id => ids.has(id)));
  } catch { /* fall through */ }
  return new Set(ids);
}

// ---------- states ----------

function showError(problem) {
  root.dataset.state = "error";
  if (location.protocol === "file:") {
    root.replaceChildren(
      el("div", { class: "card empty-state", role: "alert" },
        el("strong", {}, "Open via a local server: python3 -m http.server"),
        "This page can't load its data from a file. Run the command in the site folder and open http://localhost:8000/pablete.html."));
    return;
  }
  root.replaceChildren(
    el("div", { class: "card empty-state", role: "alert" },
      el("strong", {}, "The Pablete can't load right now."),
      "The league sheet didn't answer. Try again in a minute.",
      el("div", { class: "btn-row center" },
        el("button", { class: "btn", type: "button", onclick: () => location.reload() }, "Try again")),
      problem ? el("p", { class: "fine" }, `Details: ${problem}`) : null));
}

function showEmpty() {
  root.dataset.state = "empty";
  root.replaceChildren(
    el("div", { class: "card empty-state" },
      el("strong", {}, "No Pablete yet."),
      "The sheet has no rows to show."));
}

// ---------- table cells ----------

const DASH = () => el("span", { class: "muted", title: "First Pablete — nothing to compare with" }, "—");

function rankCell(e) {
  let chg;
  if (e.dRank == null) chg = el("span", { class: "rk-chg same", title: "First Pablete — nothing to compare with" }, "—");
  else if (e.dRank > 0) chg = el("span", { class: "rk-chg up", "aria-label": `up ${e.dRank}` }, `▲${e.dRank}`);
  else if (e.dRank < 0) chg = el("span", { class: "rk-chg down", "aria-label": `down ${-e.dRank}` }, `▼${-e.dRank}`);
  else chg = el("span", { class: "rk-chg same", "aria-label": "no change" }, "=");
  return el("span", { class: "rk" }, el("b", {}, String(e.rank)), chg);
}

function teamCell(cfg, e) {
  const t = teamById(cfg, e.teamId);
  const crowns = crownsOf(cfg, e.teamId);
  return el("span", { class: "team-chip pb-team" },
    el("img", { src: t.logo, alt: "", width: 24, height: 24 }),
    el("span", { class: "tc-name tc-full" }, t.name),
    el("abbr", { class: "tc-name tc-short", title: t.name }, t.initials),
    crowns ? el("span", { class: "crowns", "aria-hidden": "true" }, crowns) : null);
}

// Main value with the change since the previous Pablete underneath ("—" on the first one).
function withDelta(main, delta, decimals) {
  return el("span", { class: "with-d" },
    el("span", {}, main),
    el("span", { class: "d" }, delta == null ? "—" : fmtNum(delta, decimals, { sign: true })));
}

const ptsDecimals = x => (x == null || Number.isInteger(x) ? 0 : 1);

function columnsFor(cfg, mode, phone) {
  const clean = mode === "clean";
  const c = {
    rank: { key: "rank", label: "#", dir: "asc", sticky: 1, value: e => e.rank, render: rankCell },
    team: { key: "team", label: "Team", dir: "asc", sticky: 2, value: e => teamById(cfg, e.teamId).name, render: e => teamCell(cfg, e) },
    points: { key: "points", label: "Points", num: true, value: e => e.points, render: e => fmtNum(e.points, ptsDecimals(e.points)) },
    dPoints: { key: "dPoints", label: "Δ pts", num: true, value: e => e.dPoints ?? -Infinity,
      render: e => (e.dPoints == null ? DASH() : fmtNum(e.dPoints, ptsDecimals(e.dPoints), { sign: true })) },
    spaces: clean
      ? { key: "spaces", label: "Clean spaces", num: true, value: e => e.clean, render: e => withDelta(fmtNum(e.clean), e.dClean, 0) }
      : { key: "spaces", label: "Spaces", num: true, value: e => e.spaces, render: e => withDelta(fmtNum(e.spaces), e.dSpaces, 0) },
    outs: { key: "outs", label: "Outs", num: true, value: e => e.outs, render: e => (e.outs ? fmtNum(e.outs) : el("span", { class: "muted" }, "0")) },
    avg: clean
      ? { key: "avg", label: phone ? "Avg (no outs)" : "Avg without outs", num: true, value: e => e.avgClean ?? -Infinity, render: e => withDelta(fmtNum(e.avgClean, 2), e.dAvgClean, 2) }
      : { key: "avg", label: "Average", num: true, value: e => e.avg ?? -Infinity, render: e => withDelta(fmtNum(e.avg, 2), e.dAvg, 2) },
    lost: { key: "lost", label: "Lost pts", note: "estimate", num: true, value: e => e.lost ?? -Infinity,
      render: e => (e.outs ? fmtNum(e.lost, 0) : el("span", { class: "muted" }, "0")) },
  };
  // Phones see rank, team, points and average first; the rest scroll into view.
  const order = phone
    ? ["rank", "team", "points", "avg", "dPoints", "spaces", "outs"]
    : ["rank", "team", "points", "dPoints", "spaces", "outs", "avg"];
  if (clean) order.push("lost");
  return order.map(k => c[k]);
}

function pableteTable(cfg, entries, state, rerender) {
  const columns = columnsFor(cfg, state.mode, PHONE.matches);
  if (!columns.some(c => c.key === state.sortKey)) { state.sortKey = "points"; state.sortDir = "desc"; }
  const col = columns.find(c => c.key === state.sortKey);
  const sorted = [...entries].sort((a, b) => {
    const va = col.value(a), vb = col.value(b);
    const cmp = typeof va === "string" ? va.localeCompare(vb, "en", { sensitivity: "base" }) : va - vb;
    return (state.sortDir === "asc" ? cmp : -cmp) || a.rank - b.rank;
  });

  const head = el("tr", {}, columns.map(c => {
    const active = c.key === state.sortKey;
    const btn = el("button", { type: "button" },
      el("span", {}, c.label, c.note ? el("small", {}, c.note) : null),
      el("span", { class: "arrow", "aria-hidden": "true" }, active ? (state.sortDir === "asc" ? "▲" : "▼") : "↕"));
    btn.addEventListener("click", () => {
      if (state.sortKey === c.key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortKey = c.key; state.sortDir = c.dir || (c.num ? "desc" : "asc"); }
      rerender();
    });
    return el("th", {
      scope: "col",
      class: [c.num ? "num" : "", c.sticky ? `sticky-${c.sticky}` : ""].join(" ").trim() || null,
      "aria-sort": active ? (state.sortDir === "asc" ? "ascending" : "descending") : "none",
    }, btn);
  }));

  const body = el("tbody", {}, sorted.map(e => el("tr", { style: { "--team": teamById(cfg, e.teamId).color } },
    columns.map(c => el(c.key === "team" ? "th" : "td", {
      scope: c.key === "team" ? "row" : null,
      class: [c.num ? "num" : "", c.sticky ? `sticky-${c.sticky}` : "", c.key === "team" ? "pb-team-cell" : ""].join(" ").trim() || null,
    }, c.render(e))))));

  return el("div", { class: "table-wrap" },
    el("table", { class: "box-table pablete-table" },
      el("caption", { class: "visually-hidden" }, `Pablete ESPN ☕ standings, ${state.mode === "clean" ? "without outs" : "with outs"}. Column headers sort the table.`),
      el("thead", {}, head), body));
}

// ---------- controls ----------

function segmented(label, options, current, onPick, cls = "") {
  return el("div", { class: `seg ${cls}`.trim(), role: "group", "aria-label": label },
    options.map(([value, text, short]) => el("button", {
      type: "button", "aria-pressed": String(current === value),
      onclick: () => { if (current !== value) onPick(value); },
    }, short ? [el("span", { class: "lbl-long" }, text), el("span", { class: "lbl-short", "aria-hidden": "true" }, short)] : text)));
}

function chipBar(cfg, state, update) {
  const all = cfg.teams.length;
  const chips = [...cfg.teams].sort((a, b) => a.draft_slot - b.draft_slot).map(t => {
    const on = state.selected.has(t.id);
    return el("button", {
      type: "button", class: "chip", "aria-pressed": String(on), title: t.name,
      style: { "--team": t.color },
      onclick: () => {
        if (on) state.selected.delete(t.id); else state.selected.add(t.id);
        update();
      },
    },
      el("img", { src: t.logo, alt: "", width: 28, height: 28 }),
      el("span", { class: "chip-name" }, t.initials),
      el("span", { class: "visually-hidden" }, ` ${t.name}`));
  });
  return el("div", { class: "chipbar-row" },
    el("div", { class: "chipbar-actions" },
      el("button", { type: "button", class: "chip-act", disabled: state.selected.size === all,
        onclick: () => { cfg.teams.forEach(t => state.selected.add(t.id)); update(); } }, "All"),
      el("button", { type: "button", class: "chip-act", disabled: state.selected.size === 0,
        onclick: () => { state.selected.clear(); update(); } }, "Clear")),
    el("div", { class: "chipbar", role: "group", "aria-label": "Teams shown" }, chips));
}

// ---------- page ----------

function render(cfg, result) {
  const { parsed } = result;
  const data = buildPablete(parsed.rows, cfg);
  if (data.latest == null) return showEmpty();

  const entries = data.byDate.get(data.latest);
  const prevDates = data.dates.filter(d => d < data.latest);
  const warnings = [...parsed.warnings, ...data.warnings];

  const state = {
    mode: readPref(MODE_KEY) === "clean" ? "clean" : "all",
    metric: METRIC_LABELS[readPref(METRIC_KEY)] ? readPref(METRIC_KEY) : "gap",
    selected: readSelection(cfg),
    raceMs: null,
    sortKey: "points", sortDir: "desc",
  };

  const toolbar = el("div", { class: "pb-toolbar" });
  const chipsSlot = el("div", { class: "chipbar-wrap" });
  const raceControls = el("div", { class: "race-controls" });
  const raceHost = el("div", { class: "race-host" }, el("p", { class: "muted race-loading" }, "Drawing the chart…"));
  const tableSlot = el("div");

  let raceModule = null, raceFailed = false;

  function drawRace() {
    if (raceFailed) return;
    if (!raceModule) return;
    try {
      raceModule.renderRace(raceHost, {
        cfg, data, state,
        onPickTeam: id => {
          const all = state.selected.size === cfg.teams.length;
          if (all) { state.selected.clear(); state.selected.add(id); }
          else if (state.selected.has(id)) state.selected.delete(id);
          else state.selected.add(id);
          update();
        },
        onDate: ms => { state.raceMs = ms; },
      });
    } catch (e) {
      console.error(e);
      raceHost.replaceChildren(el("p", { class: "fine" }, "The chart couldn't be drawn. Every number is in the full table below."));
    }
  }

  function drawAll() {
    toolbar.replaceChildren(
      el("p", { class: "pb-updated" },
        `Updated: ${fmtDate(data.latest)}`,
        el("span", { class: "muted" }, prevDates.length ? ` · vs ${fmtDate(prevDates.at(-1)).slice(0, 5)}` : " · first Pablete")),
      segmented("Outs", [["all", "With outs"], ["clean", "Without outs"]], state.mode, v => { state.mode = v; savePref(MODE_KEY, v); drawAll(); }));
    chipsSlot.replaceChildren(chipBar(cfg, state, update));
    raceControls.replaceChildren(
      segmented("Metric", Object.entries(METRIC_LABELS).map(([k, [long, short]]) => [k, long, short]), state.metric,
        v => { state.metric = v; savePref(METRIC_KEY, v); drawAll(); }, "seg-metric"));
    drawRace();
    tableSlot.replaceChildren(
      el("p", { class: "fine pb-scroll-hint", "aria-hidden": "true" }, "Swipe the table for more →"),
      pableteTable(cfg, entries, state, drawAll),
      el("p", { class: "fine" }, state.mode === "clean"
        ? "Without outs: clean spaces = spaces − outs; average = points ÷ clean spaces. Lost points (estimate) = outs × average without outs. Small figures: change since the previous Pablete."
        : "Average = total points ÷ spaces used (spaces include outs). Small figures: change since the previous Pablete."));
  }

  function update() {
    savePref(SEL_KEY, JSON.stringify([...state.selected]));
    drawAll();
  }

  const banner = result.source === "cache"
    ? el("p", { class: "notice", role: "status" }, `Saved data from ${fmtStamp(result.fetchedAt)} — couldn’t refresh`)
    : null;

  const warnBox = warnings.length
    ? el("details", { class: "pb-warn" },
        el("summary", {}, `${warnings.length} row${warnings.length > 1 ? "s" : ""} skipped or flagged in the sheet`),
        el("ul", {}, warnings.map(w => el("li", {}, w))))
    : null;

  root.dataset.state = "ready";
  root.replaceChildren(...[
    banner,
    toolbar,
    chipsSlot,
    el("section", { class: "card pb-card", "aria-labelledby": "h-race" },
      el("div", { class: "pb-card-head" }, el("h2", { id: "h-race" }, "The Race"), raceControls),
      raceHost),
    el("section", { class: "pb-section", "aria-labelledby": "h-table" },
      el("h2", { id: "h-table" }, "Full table"),
      tableSlot),
    warnBox,
  ].filter(Boolean));
  drawAll();

  // Redraw the chart when its width changes (rotation, window resize) or phone/desktop flips.
  let lastW = 0, raf = 0;
  new ResizeObserver(() => {
    const w = Math.floor(raceHost.clientWidth);
    if (w === lastW) return;
    lastW = w;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(drawRace);
  }).observe(raceHost);
  PHONE.addEventListener("change", drawAll);

  import("./pablete-race.js")
    .then(mod => { raceModule = mod; drawRace(); })
    .catch(e => {
      console.error(e);
      raceFailed = true;
      raceHost.replaceChildren(el("p", { class: "fine" }, "The chart library couldn't load. Every number is in the full table below."));
    });
}

async function main() {
  if (location.protocol === "file:") return showError();
  let cfg;
  try {
    cfg = await mountChrome("pablete");
  } catch (e) {
    return showError(`league settings: ${e?.message ?? e}`);
  }
  try {
    const result = await loadPablete(cfg);
    if (result.source === "none") return showError(result.problem);
    render(cfg, result);
  } catch (e) {
    console.error(e);
    showError(String(e?.message ?? e));
  }
}

main();
