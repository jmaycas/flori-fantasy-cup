// Teams page: current rosters from ESPN snapshots (data/rosters/, written by
// scripts/import_rosters.mjs). One card per team, grouped Starters / Bench / IR, badges for
// O / DTD and free-agency pickups; "Changes since DD/MM" when there is a previous snapshot.

import { mountChrome, el, teamById, crownsOf } from "./ui.js";

const STARTER_SLOTS = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"];
const PHONE = window.matchMedia("(max-width: 640px)");
const STATUS = { O: ["Out", "o"], DTD: ["Day-to-day", "dtd"], SSPD: ["Suspended", "o"], GTD: ["Game-time decision", "dtd"] };
const $ = id => document.getElementById(id);
const norm = s => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// "2026-11-14T11:30" (Europe/Rome, as saved) -> "14/11/2026 · 11:30" / "14/11"
const stamp = s => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} · ${s.slice(11, 16)}`;
const dayMonth = s => `${s.slice(8, 10)}/${s.slice(5, 7)}`;

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

function badges(p) {
  const out = [];
  if (STATUS[p.status]) {
    const [label, cls] = STATUS[p.status];
    out.push(el("abbr", { class: `badge badge-${cls}`, title: label }, p.status));
  }
  if (p.acquired === "Free Agency") out.push(el("abbr", { class: "badge badge-fa", title: "Picked up in free agency" }, "FA"));
  else if (p.acquired && p.acquired !== "Draft") out.push(el("span", { class: "badge badge-fa", title: `Acquired via ${p.acquired}` }, p.acquired));
  return out.length ? el("span", { class: "badges" }, out) : null;
}

function row(p) {
  if (p.empty) {
    return el("li", { class: "rs-row empty" },
      el("span", { class: "rs-slot" }, p.slot === "Bench" ? "BE" : p.slot),
      el("span", { class: "rs-name muted" }, "Empty"));
  }
  return el("li", { class: `rs-row${p.status === "O" ? " is-out" : ""}` },
    el("span", { class: "rs-slot" }, p.slot === "Bench" ? "BE" : p.slot),
    el("span", { class: "rs-main" },
      el("span", { class: "rs-name" }, p.player, badges(p)),
      el("span", { class: "rs-meta" }, `${p.nbaTeam} · ${p.positions.join(", ")}`)));
}

function group(title, players) {
  if (!players.length) return null;
  return el("section", { class: "rs-group" },
    el("h3", {}, title, el("span", { class: "muted" }, ` ${players.filter(p => !p.empty).length}`)),
    el("ul", {}, players.map(row)));
}

function teamCard(cfg, t, roster, open) {
  const players = roster.filter(p => !p.empty);
  const out = players.filter(p => p.status === "O").length;
  const dtd = players.filter(p => p.status === "DTD").length;
  const fa = players.filter(p => p.acquired === "Free Agency").length;
  const summaryBits = [`${players.length} players`, out ? `${out} out` : null, dtd ? `${dtd} day-to-day` : null, fa ? `${fa} from free agency` : null].filter(Boolean);
  const starters = STARTER_SLOTS.flatMap(s => roster.filter(p => p.slot === s));
  return el("details", { class: "team-roster card", id: `team-${t.id}`, style: { "--team": t.color }, open },
    el("summary", { class: "tr-head" },
      el("img", { src: t.logo, alt: "" }),
      el("div", {},
        el("h2", {}, t.name, " ", el("span", { class: "crowns" }, crownsOf(cfg, t.id))),
        el("p", { class: "muted" }, summaryBits.join(" · "))),
      el("span", { class: "tr-chev", "aria-hidden": "true" })),
    group("Starters", starters),
    group("Bench", roster.filter(p => p.slot === "Bench")),
    group("IR", roster.filter(p => p.slot === "IR")));
}

// Added / dropped per team between two snapshots (by player name).
function changes(cfg, prev, cur) {
  const names = snap => new Map(snap.teams.map(t => [t.teamId, new Map(t.roster.filter(p => !p.empty).map(p => [norm(p.player), p]))]));
  const a = names(prev), b = names(cur);
  const ownerNow = new Map();
  for (const [id, m] of b) for (const k of m.keys()) ownerNow.set(k, id);
  return cfg.teams.map(t => {
    const before = a.get(t.id) ?? new Map(), after = b.get(t.id) ?? new Map();
    const added = [...after].filter(([k]) => !before.has(k)).map(([, p]) => p);
    const dropped = [...before].filter(([k]) => !after.has(k)).map(([k, p]) => ({ ...p, nowWith: ownerNow.get(k) }));
    return { t, added, dropped };
  }).filter(c => c.added.length || c.dropped.length);
}

function changesSection(cfg, prev, cur) {
  const list = changes(cfg, prev, cur);
  const body = list.length
    ? el("div", { class: "chg-grid" }, list.map(({ t, added, dropped }) =>
        el("div", { class: "chg-team", style: { "--team": t.color } },
          el("p", { class: "chg-name" }, el("img", { src: t.logo, alt: "" }), t.name),
          el("ul", {},
            added.map(p => el("li", { class: "chg-add" }, el("b", { "aria-label": "added" }, "+"), ` ${p.player}`, el("span", { class: "muted" }, ` · ${p.nbaTeam}`))),
            dropped.map(p => el("li", { class: "chg-drop" }, el("b", { "aria-label": "dropped" }, "−"), ` ${p.player}`,
              el("span", { class: "muted" }, p.nowWith ? ` → ${teamById(cfg, p.nowWith).name}` : " · dropped")))))))
    : el("p", { class: "muted" }, "No roster moves.");
  return el("section", { class: "chg card", "aria-labelledby": "h-chg" },
    el("h2", { id: "h-chg" }, `Changes since ${dayMonth(prev.snapshot)}`),
    el("p", { class: "fine" }, `Added and dropped players between the ESPN snapshots of ${stamp(prev.snapshot)} and ${stamp(cur.snapshot)}.`),
    body);
}

async function main() {
  const cfg = await mountChrome("teams");
  let index, cur, prev = null;
  try {
    index = await getJSON("data/rosters/index.json");
    const files = index.snapshots ?? [];
    if (!files.length) throw new Error("no snapshots yet");
    cur = await getJSON("data/rosters/latest.json");
    const curFile = `${cur.snapshot.slice(0, 10)}_${cur.snapshot.slice(11, 13)}${cur.snapshot.slice(14, 16)}.json`;
    const older = files.filter(f => f < curFile).sort();
    if (older.length) prev = await getJSON(`data/rosters/${older.at(-1)}`);
  } catch (e) {
    console.error(e);
    $("content").replaceChildren(el("div", { class: "card empty-state", role: "alert" },
      el("strong", {}, "Rosters can't load right now."),
      "Try again in a minute."));
    return;
  }

  $("status").textContent = `Rosters updated: ${stamp(cur.snapshot)}`;
  const order = [...cfg.teams].sort((a, b) => a.draft_slot - b.draft_slot);
  const byId = new Map(cur.teams.map(t => [t.teamId, t.roster]));

  const jump = el("nav", { class: "team-jump", "aria-label": "Jump to team" },
    order.map(t => el("a", {
      href: `#team-${t.id}`, title: t.name,
      onclick: () => { const d = document.getElementById(`team-${t.id}`); if (d) d.open = true; },
    }, el("img", { src: t.logo, alt: "" }), el("span", {}, t.initials || t.id))));

  const cards = order.map(t => teamCard(cfg, t, byId.get(t.id) ?? [], !PHONE.matches));
  const legend = el("p", { class: "fine rs-legend" },
    el("abbr", { class: "badge badge-o" }, "O"), " out · ",
    el("abbr", { class: "badge badge-dtd" }, "DTD"), " day-to-day · ",
    el("abbr", { class: "badge badge-fa" }, "FA"), " picked up in free agency. Source: ESPN League Rosters, Europe/Rome time.");

  $("content").replaceChildren(...[
    jump,
    prev ? changesSection(cfg, prev, cur) : null,
    legend,
    el("div", { class: "team-rosters" }, cards),
  ].filter(Boolean));

  // Desktop shows every roster open; phones collapse each team behind its header.
  PHONE.addEventListener("change", () => { if (!PHONE.matches) cards.forEach(c => { c.open = true; }); });
  cards.forEach(c => c.addEventListener("toggle", () => { if (!PHONE.matches && !c.open) c.open = true; }));

  if (location.hash.startsWith("#team-")) {
    const d = document.getElementById(location.hash.slice(1));
    if (d) { d.open = true; d.scrollIntoView(); }
  }
}

main();
