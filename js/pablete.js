// Pablete ESPN ☕ — page rendering: latest Pablete as a sortable box-score table with a
// "With outs / Without outs" toggle. Data comes from js/pablete-data.js.

import { mountChrome, el, teamById, crownsOf } from "./ui.js";
import { loadPablete, buildPablete, fmtDate, fmtStamp, fmtNum } from "./pablete-data.js";

const root = document.getElementById("pablete");
const MODE_KEY = "pablete_mode_v1";
const PHONE = window.matchMedia("(max-width: 640px)");

function readMode() {
  try { return localStorage.getItem(MODE_KEY) === "clean" ? "clean" : "all"; } catch { return "all"; }
}
function saveMode(mode) {
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* storage unavailable */ }
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

// ---------- cells ----------

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

// ---------- columns ----------

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

// ---------- sortable table (state survives the toggle and the phone/desktop switch) ----------

function pableteTable(cfg, entries, state) {
  const columns = columnsFor(cfg, state.mode, PHONE.matches);
  if (!columns.some(c => c.key === state.key)) { state.key = "points"; state.dir = "desc"; }
  const col = columns.find(c => c.key === state.key);
  const sorted = [...entries].sort((a, b) => {
    const va = col.value(a), vb = col.value(b);
    const cmp = typeof va === "string" ? va.localeCompare(vb, "en", { sensitivity: "base" }) : va - vb;
    return (state.dir === "asc" ? cmp : -cmp) || a.rank - b.rank;
  });

  const head = el("tr", {}, columns.map(c => {
    const active = c.key === state.key;
    const btn = el("button", { type: "button" },
      el("span", {}, c.label, c.note ? el("small", {}, c.note) : null),
      el("span", { class: "arrow", "aria-hidden": "true" }, active ? (state.dir === "asc" ? "▲" : "▼") : "↕"));
    btn.addEventListener("click", () => {
      if (state.key === c.key) state.dir = state.dir === "asc" ? "desc" : "asc";
      else { state.key = c.key; state.dir = c.dir || (c.num ? "desc" : "asc"); }
      state.rerender();
    });
    return el("th", {
      scope: "col",
      class: [c.num ? "num" : "", c.sticky ? `sticky-${c.sticky}` : ""].join(" ").trim() || null,
      "aria-sort": active ? (state.dir === "asc" ? "ascending" : "descending") : "none",
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

function modeToggle(state) {
  const opt = (mode, label) => el("button", {
    type: "button", "aria-pressed": String(state.mode === mode),
    onclick: () => { if (state.mode !== mode) { state.mode = mode; saveMode(mode); state.rerender(); } },
  }, label);
  return el("div", { class: "seg", role: "group", "aria-label": "Outs" }, opt("all", "With outs"), opt("clean", "Without outs"));
}

function modeNote(mode) {
  return mode === "clean"
    ? el("p", { class: "fine" }, "Without outs: clean spaces = spaces − outs; average = points ÷ clean spaces. Lost points (estimate) = outs × average without outs. Small figures: change since the previous Pablete.")
    : el("p", { class: "fine" }, "Average = total points ÷ spaces used (spaces include outs). Small figures: change since the previous Pablete.");
}

// ---------- page ----------

function render(cfg, result) {
  const { parsed } = result;
  const data = buildPablete(parsed.rows, cfg);
  if (data.latest == null) return showEmpty();

  const entries = data.byDate.get(data.latest);
  const prevDates = data.dates.filter(d => d < data.latest);
  const warnings = [...parsed.warnings, ...data.warnings];

  const state = { mode: readMode(), key: "points", dir: "desc", rerender: null };
  const tableSlot = el("div");
  const toolbar = el("div", { class: "pb-toolbar" });

  state.rerender = () => {
    toolbar.replaceChildren(
      el("p", { class: "pb-updated" },
        `Updated: ${fmtDate(data.latest)}`,
        el("span", { class: "muted" }, prevDates.length ? ` · vs ${fmtDate(prevDates.at(-1)).slice(0, 5)}` : " · first Pablete")),
      modeToggle(state));
    tableSlot.replaceChildren(
      el("p", { class: "fine pb-scroll-hint", "aria-hidden": "true" }, "Swipe the table for more →"),
      pableteTable(cfg, entries, state), modeNote(state.mode));
  };
  state.rerender();
  PHONE.addEventListener("change", () => state.rerender());

  const banner = result.source === "cache"
    ? el("p", { class: "notice", role: "status" }, `Saved data from ${fmtStamp(result.fetchedAt)} — couldn’t refresh`)
    : null;

  const warnBox = warnings.length
    ? el("details", { class: "pb-warn" },
        el("summary", {}, `${warnings.length} row${warnings.length > 1 ? "s" : ""} skipped or flagged in the sheet`),
        el("ul", {}, warnings.map(w => el("li", {}, w))))
    : null;

  root.dataset.state = "ready";
  root.replaceChildren(...[banner, toolbar, tableSlot, warnBox].filter(Boolean));
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
