// Shared UI for every page: league config, header/nav/footer, team-chip, box-table,
// banner, jersey, password-gate, live-dot. Plain ES module, no build step.

const NAV = [
  { id: "home", href: "./", label: "Home" },
  { id: "draft", href: "draft.html", label: "Draft Night" },
  { id: "pablete", href: "pablete.html", label: "Pablete ESPN ☕" },
  { id: "teams", href: "teams.html", label: "Teams" },
  { id: "champions", href: "champions.html", label: "Hall of Champions" },
  { id: "gms", href: "gms.html", label: "General Managers" },
];

const SVG_NS = "http://www.w3.org/2000/svg";

let leaguePromise;
export function loadLeague() {
  leaguePromise ??= fetch("config/league.json").then(r => {
    if (!r.ok) throw new Error(`config/league.json: HTTP ${r.status}`);
    return r.json();
  });
  return leaguePromise;
}

// ---------- small helpers ----------

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "style" && typeof v === "object") for (const [prop, val] of Object.entries(v)) node.style.setProperty(prop, val);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c instanceof Node ? c : String(c));
  return node;
}

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : String(c));
  return node;
}

export function teamById(cfg, id) {
  return cfg.teams.find(t => t.id === id);
}

export function titlesOf(cfg, teamId) {
  return cfg.champions.filter(c => c.team_id === teamId).length;
}

export function crownsOf(cfg, teamId) {
  return cfg.crown_emoji.repeat(titlesOf(cfg, teamId));
}

// Seasons are labelled "2025-26"; the start year orders them.
export const seasonStart = s => parseInt(s.slice(0, 4), 10);

// Last completed season = the latest season with a champion.
export function lastCompletedSeason(cfg) {
  return [...cfg.champions].sort((a, b) => seasonStart(a.season) - seasonStart(b.season)).at(-1).season;
}

// Computed franchise facts — never typed: seasons played (founding season through the last
// completed season), titles, and this season's draft slot.
export function franchiseStats(cfg, teamId) {
  const t = teamById(cfg, teamId);
  const seasons = Math.max(0, seasonStart(lastCompletedSeason(cfg)) - seasonStart(t.founded) + 1);
  return { seasons, titles: titlesOf(cfg, teamId), pick: t.draft_slot, founded: t.founded, rookie: seasons === 1 };
}

function crownsSpan(cfg, teamId) {
  const n = titlesOf(cfg, teamId);
  if (!n) return null;
  return el("span", { class: "crowns", role: "img", "aria-label": `${n} title${n > 1 ? "s" : ""}` }, crownsOf(cfg, teamId));
}

// ---------- page chrome ----------

export async function mountChrome(pageId, { plain = false } = {}) {
  const cfg = await loadLeague();
  const { league } = cfg;

  const toggle = el("button", { class: "nav-toggle", type: "button", "aria-expanded": "false", "aria-controls": "site-nav" }, "Menu");
  const nav = el("nav", { class: "site-nav", id: "site-nav", "aria-label": "Sections" },
    el("ul", {}, NAV.map(n => el("li", {}, el("a", { href: n.href, "aria-current": n.id === pageId ? "page" : null }, plain ? n.label.replace(/\s*☕/u, "") : n.label)))));
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  const header = el("header", { class: "site-header" },
    el("div", { class: "wrap" },
      el("a", { class: "wordmark", href: "./" },
        el("img", { src: "assets/favicon.svg", alt: "", width: 30, height: 30 }),
        el("span", {}, league.name, el("small", {}, `${league.season} · ${league.scoring_type}`))),
      toggle, nav));

  const footer = el("footer", { class: "site-footer" },
    el("div", { class: "wrap" },
      el("span", {}, `${league.name} · ${league.season} · ${league.n_teams} franchises`),
      el("a", { href: "rumbita.html" }, `In memory of ${cfg.emeritus.name}, ${cfg.emeritus.title}`)));

  const skip = el("a", { class: "skip-link", href: "#main" }, "Skip to content");
  document.body.prepend(skip, header);
  document.body.append(footer);
  return cfg;
}

// ---------- team-chip ----------

export function teamChip(cfg, teamId, { size = "", link = null, crowns = true } = {}) {
  const t = teamById(cfg, teamId);
  const tag = link ? "a" : "span";
  return el(tag, { class: `team-chip ${size}`.trim(), href: link },
    el("img", { src: t.logo, alt: "", width: size === "lg" ? 40 : 24, height: size === "lg" ? 40 : 24 }),
    el("span", { class: "tc-name" }, t.name),
    crowns ? crownsSpan(cfg, teamId) : null);
}

// ---------- box-table ----------
// columns: [{key, label, num?, value(row) -> sortable, render?(row) -> Node|string, dir?: "asc"|"desc" first-click}]
export function boxTable({ columns, rows, sortKey, sortDir = "desc", caption }) {
  let key = sortKey, dir = sortDir;
  const table = el("table", { class: "box-table" });
  if (caption) table.append(el("caption", { class: "visually-hidden" }, caption));
  const headRow = el("tr");
  const tbody = el("tbody");
  table.append(el("thead", {}, headRow), tbody);

  const ths = columns.map(col => {
    const btn = el("button", { type: "button" }, col.label, el("span", { class: "arrow", "aria-hidden": "true" }, "↕"));
    const th = el("th", { scope: "col", class: col.num ? "num" : null }, btn);
    btn.addEventListener("click", () => {
      if (key === col.key) dir = dir === "asc" ? "desc" : "asc";
      else { key = col.key; dir = col.dir || (col.num ? "desc" : "asc"); }
      render();
    });
    headRow.append(th);
    return th;
  });

  function render() {
    const col = columns.find(c => c.key === key);
    const sorted = [...rows].sort((a, b) => {
      const va = col.value(a), vb = col.value(b);
      const cmp = typeof va === "string" ? va.localeCompare(vb, "en", { sensitivity: "base" }) : va - vb;
      return dir === "asc" ? cmp : -cmp;
    });
    columns.forEach((c, i) => {
      const active = c.key === key;
      ths[i].setAttribute("aria-sort", active ? (dir === "asc" ? "ascending" : "descending") : "none");
      ths[i].querySelector(".arrow").textContent = active ? (dir === "asc" ? "▲" : "▼") : "↕";
    });
    tbody.replaceChildren(...sorted.map(r => el("tr", {},
      columns.map(c => el("td", { class: c.num ? "num" : null }, c.render ? c.render(r) : c.value(r))))));
  }
  render();
  return el("div", { class: "table-wrap" }, table);
}

// ---------- banner (championship pennant) ----------

function wrapWords(text, max) {
  const lines = [];
  for (const w of text.split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (last && (last + " " + w).length <= max) lines[lines.length - 1] = last + " " + w;
    else lines.push(w);
  }
  return lines;
}

export function bannerSVG(cfg, { season, teamId }) {
  const W = 150, H = 230;
  const cloth = "M4 0 H146 V200 L75 226 L4 200 Z";
  const trim = "M12 8 H138 V194 L75 217 L12 194 Z";
  const display = "Big Shoulders Display, Arial Narrow, sans-serif";

  if (!teamId) {
    return svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${season} champion: to be decided` },
      svg("path", { d: cloth, fill: "none", stroke: "#5D7598", "stroke-width": 2, "stroke-dasharray": "6 6" }),
      svg("text", { x: 75, y: 96, "text-anchor": "middle", fill: "#AFC0D8", "font-family": display, "font-weight": 800, "font-size": 26 }, season),
      svg("text", { x: 75, y: 124, "text-anchor": "middle", fill: "#AFC0D8", "font-family": "Barlow, sans-serif", "font-size": 13 }, "To be decided"));
  }

  const t = teamById(cfg, teamId);
  const lines = wrapWords(t.name.toUpperCase(), 12);
  const nameY0 = 150 - (lines.length - 1) * 8;
  return svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${season} champions: ${t.name}` },
    svg("path", { d: cloth, fill: "#13294B" }),
    svg("path", { d: trim, fill: "none", stroke: "#D9A93B", "stroke-width": 3 }),
    svg("text", { x: 75, y: 34, "text-anchor": "middle", fill: "#D9A93B", "font-family": display, "font-weight": 800, "font-size": 19, "letter-spacing": 1.5 }, "CHAMPIONS"),
    svg("circle", { cx: 75, cy: 82, r: 33, fill: "#FFFFFF" }),
    svg("circle", { cx: 75, cy: 82, r: 33, fill: "none", stroke: "#D9A93B", "stroke-width": 2 }),
    svg("image", { href: t.logo, x: 50, y: 57, width: 50, height: 50, preserveAspectRatio: "xMidYMid meet" }),
    lines.map((ln, i) => svg("text", { x: 75, y: nameY0 + i * 16, "text-anchor": "middle", fill: "#FFFFFF", "font-family": display, "font-weight": 700, "font-size": 15, "letter-spacing": .5 }, ln)),
    svg("text", { x: 75, y: 192, "text-anchor": "middle", fill: "#D9A93B", "font-family": display, "font-weight": 800, "font-size": 24 }, season));
}

// ---------- jersey (retired) ----------

export function jerseySVG(cfg) {
  const em = cfg.emeritus;
  const display = "Big Shoulders Display, Arial Narrow, sans-serif";
  const body = "M62 8 C70 30 130 30 138 8 L170 18 C164 44 166 64 180 78 L180 232 L20 232 L20 78 C34 64 36 44 30 18 Z";
  const number = em.jersey_number;
  const center = number != null
    ? svg("text", { x: 100, y: 176, "text-anchor": "middle", fill: "#FFFFFF", stroke: "#D9A93B", "stroke-width": 2.5, "paint-order": "stroke", "font-family": display, "font-weight": 800, "font-size": 96 }, String(number))
    : svg("g", {},
        svg("circle", { cx: 100, cy: 146, r: 40, fill: "#FFFFFF", stroke: "#D9A93B", "stroke-width": 3 }),
        em.logo ? svg("image", { href: em.logo, x: 70, y: 116, width: 60, height: 60, preserveAspectRatio: "xMidYMid meet" }) : null);
  return svg("svg", { viewBox: "0 0 200 244", role: "img", "aria-label": `Retired jersey: ${em.name}${number != null ? `, number ${number}` : ""}` },
    svg("path", { d: body, fill: "#0A7E7E" }),
    svg("path", { d: "M62 8 C70 30 130 30 138 8", fill: "none", stroke: "#FFFFFF", "stroke-width": 7 }),
    svg("path", { d: "M30 18 C36 44 34 64 20 78 M170 18 C164 44 166 64 180 78", fill: "none", stroke: "#FFFFFF", "stroke-width": 6 }),
    svg("path", { d: "M20 226 H180", stroke: "#D9A93B", "stroke-width": 4 }),
    svg("text", { x: 100, y: 78, "text-anchor": "middle", fill: "#FFFFFF", "font-family": display, "font-weight": 800, "font-size": 26, "letter-spacing": 3 }, em.name.toUpperCase()),
    center);
}

// ---------- password-gate ----------
// check(password) -> Promise<boolean>. Resolves when the password is accepted; null if cancelled.
export function passwordGate({ title, message, check, cancelHref = "./" }) {
  return new Promise(resolve => {
    const input = el("input", { type: "password", id: "gate-pw", autocomplete: "current-password", required: true });
    const error = el("p", { class: "error", role: "alert", "aria-live": "assertive" });
    const submit = el("button", { class: "btn", type: "submit" }, "Open");
    const form = el("form", { class: "gate", "aria-labelledby": "gate-title" },
      el("h2", { id: "gate-title" }, title),
      el("p", {}, message),
      el("label", { for: "gate-pw" }, "League password"),
      input, error,
      el("div", { class: "actions" }, submit, el("a", { class: "btn secondary", href: cancelHref }, "Back to home")));
    const backdrop = el("div", { class: "gate-backdrop", role: "dialog", "aria-modal": "true", "aria-labelledby": "gate-title" }, form);

    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      submit.disabled = true;
      error.textContent = "";
      let ok = false;
      try { ok = await check(input.value); } catch { ok = false; }
      submit.disabled = false;
      if (ok) { backdrop.remove(); resolve(true); }
      else { error.textContent = "Wrong password. Try again."; input.select(); }
    });
    document.body.append(backdrop);
    input.focus();
  });
}

// ---------- live-dot ----------

export function liveDot() {
  const dot = el("span", { class: "live-dot", role: "status" }, "Offline");
  return {
    node: dot,
    set(on) { dot.classList.toggle("on", on); dot.textContent = on ? "Live" : "Reconnecting…"; },
  };
}
