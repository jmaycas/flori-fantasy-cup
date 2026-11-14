#!/usr/bin/env node
// Import a saved copy of ESPN's "League Rosters" page (plain text) into a roster snapshot.
//
//   node scripts/import_rosters.mjs private/rosters/2026-11-14_1130.txt
//
// The file name gives the snapshot date and time, Europe/Rome (YYYY-MM-DD_HHMM.txt).
// Writes data/rosters/<YYYY-MM-DD_HHMM>.json, updates data/rosters/index.json (every snapshot)
// and data/rosters/latest.json (a copy of the newest snapshot). Nothing is written if any
// check fails: all 8 teams present, every player with an NBA team and positions, no player
// on two teams, every line understood.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "data/rosters");

const SLOTS = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL", "Bench", "IR"];
const STATUSES = ["O", "DTD", "SSPD", "GTD"]; // ESPN injury/availability tags; none = healthy
const NBA_TEAMS = new Set(["ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GS", "HOU", "IND", "LAC", "LAL",
  "MEM", "MIA", "MIL", "MIN", "NO", "NY", "OKC", "ORL", "PHI", "PHX", "POR", "SA", "SAC", "TOR", "UTAH", "WSH", "FA"]);
const POSITIONS = new Set(["PG", "SG", "SF", "PF", "C", "G", "F"]);
const ACQ = ["Draft", "Free Agency", "Trade", "Waivers"];

const norm = s => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

function fail(errors) {
  console.error(`Roster import stopped — nothing written. ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const file = process.argv[2];
if (!file) fail(["usage: node scripts/import_rosters.mjs <saved ESPN League Rosters .txt>"]);
const base = path.basename(file).replace(/\.txt$/i, "");
const fm = base.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})$/);
if (!fm) fail([`file name must be YYYY-MM-DD_HHMM.txt (Europe/Rome), got "${path.basename(file)}"`]);
const [, Y, Mo, D, hh, mm] = fm;

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config/league.json"), "utf8"));
const teamByName = new Map();
for (const t of cfg.teams) for (const n of [t.name, ...(t.aliases ?? [])]) teamByName.set(norm(n), t.id);

// Lines, trimmed, blanks dropped. Crowns and other emoji are removed from team names below.
const lines = fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r\n|\n|\r/).map(l => l.trim()).filter(Boolean);
const errors = [];
const teams = [];
let i = 0;
const at = () => lines[i];
const where = () => `line ${i + 1} ("${(at() ?? "end of file").slice(0, 40)}")`;

// Header: "League Rosters<league name>"
if (/^League Rosters/i.test(at() ?? "")) i++;

while (i < lines.length) {
  // ----- team header: name, "(N pts)", SLOT, PLAYER, ACQ -----
  const rawName = at();
  const cleanName = rawName.replace(/[\p{Extended_Pictographic}️‍]/gu, "").trim();
  const teamId = teamByName.get(norm(cleanName));
  i++;
  if (/^\(\s*[\d.,]+\s*pts\s*\)$/i.test(at() ?? "")) i++; // season total: ignored
  if (at() === "SLOT" && lines[i + 1] === "PLAYER" && lines[i + 2] === "ACQ") i += 3;
  else errors.push(`team "${cleanName}": no SLOT / PLAYER / ACQ header at ${where()}`);
  if (!teamId) errors.push(`unknown team "${cleanName}" (add it to config/league.json name or aliases)`);

  const roster = [];
  // ----- entries until "View Team" (then an optional "Propose Trade") -----
  while (i < lines.length && at() !== "View Team") {
    const slot = at();
    if (!SLOTS.includes(slot)) { errors.push(`${cleanName}: expected a slot (${SLOTS.join(", ")}) at ${where()}`); i++; continue; }
    i++;
    if (at() === "Empty") { roster.push({ slot, empty: true }); i++; continue; }
    // ESPN prints the name twice glued together, then once more on its own line.
    let name = at();
    const next = lines[i + 1];
    if (next && name === next + next) { name = next; i += 2; }
    else if (name.length % 2 === 0 && name.slice(0, name.length / 2) === name.slice(name.length / 2)) { name = name.slice(0, name.length / 2); i += 1; }
    else { i += 1; }
    let status = "healthy";
    if (STATUSES.includes(at())) { status = at(); i++; }
    const nbaTeam = at();
    if (!NBA_TEAMS.has(nbaTeam)) { errors.push(`${cleanName}: ${name} has no NBA team (found "${nbaTeam}") at ${where()}`); }
    else i++;
    const posLine = at() ?? "";
    const positions = posLine.split(",").map(s => s.trim()).filter(Boolean);
    if (!positions.length || !positions.every(p => POSITIONS.has(p))) { errors.push(`${cleanName}: ${name} has no valid positions (found "${posLine}") at ${where()}`); }
    else i++;
    const acquired = at();
    if (!ACQ.includes(acquired)) errors.push(`${cleanName}: ${name} has no acquisition type (found "${acquired}") at ${where()}`);
    else i++;
    roster.push({ slot, player: name, nbaTeam, positions, status, acquired });
  }
  if (at() === "View Team") i++;
  else errors.push(`${cleanName}: roster does not end with "View Team"`);
  if (at() === "Propose Trade") i++; // missing on the viewer's own team
  teams.push({ teamId, name: cleanName, roster });
}

// ----- validation -----
const ids = teams.map(t => t.teamId).filter(Boolean);
for (const t of cfg.teams) if (!ids.includes(t.id)) errors.push(`team missing from the file: ${t.name}`);
const dupTeams = ids.filter((id, k) => ids.indexOf(id) !== k);
for (const id of new Set(dupTeams)) errors.push(`team appears twice: ${id}`);
const owner = new Map();
for (const t of teams) for (const p of t.roster) {
  if (p.empty) continue;
  const key = norm(p.player);
  if (owner.has(key)) errors.push(`${p.player} is on two teams: ${owner.get(key)} and ${t.name}`);
  else owner.set(key, t.name);
}
if (errors.length) fail(errors);

// ----- write -----
const snapshot = {
  snapshot: `${Y}-${Mo}-${D}T${hh}:${mm}`,
  timezone: "Europe/Rome",
  source: "ESPN League Rosters page, saved as text",
  teams: cfg.teams.map(t => ({ teamId: t.id, roster: teams.find(x => x.teamId === t.id).roster })),
};
fs.mkdirSync(OUT_DIR, { recursive: true });
const outName = `${base}.json`;
fs.writeFileSync(path.join(OUT_DIR, outName), JSON.stringify(snapshot, null, 1) + "\n");

const all = fs.readdirSync(OUT_DIR).filter(f => /^\d{4}-\d{2}-\d{2}_\d{4}\.json$/.test(f)).sort();
fs.writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify({ snapshots: all }, null, 1) + "\n");
const newest = all.at(-1);
fs.copyFileSync(path.join(OUT_DIR, newest), path.join(OUT_DIR, "latest.json"));

const count = snapshot.teams.reduce((n, t) => n + t.roster.filter(p => !p.empty).length, 0);
const empty = snapshot.teams.reduce((n, t) => n + t.roster.filter(p => p.empty).length, 0);
console.log(`Wrote data/rosters/${outName}: 8 teams, ${count} players, ${empty} empty slots.`);
for (const t of snapshot.teams) {
  const r = t.roster.filter(p => !p.empty);
  console.log(`  ${t.teamId.padEnd(9)} ${String(r.length).padStart(2)} players · O ${r.filter(p => p.status === "O").length} · DTD ${r.filter(p => p.status === "DTD").length} · FA ${r.filter(p => p.acquired === "Free Agency").length} · empty ${t.roster.length - r.length}`);
}
console.log(`latest.json = ${newest}${newest === outName ? "" : " (this file is older; latest unchanged)"}. ${all.length} snapshot(s) in index.json.`);
