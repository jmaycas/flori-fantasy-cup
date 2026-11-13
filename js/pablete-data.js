// Pablete ESPN ☕ — data layer: fetch the published sheet CSV, keep a last-good copy in
// localStorage, parse it by hand (no locale-dependent parsing) and compute the per-team,
// per-date table. No DOM code here, so the functions can be checked outside the browser.

import { PABLETE } from "./pablete-config.js";

// ---------- small formatting helpers (locale-independent) ----------

const pad2 = n => String(n).padStart(2, "0");

export function fmtDate(ms) {
  const d = new Date(ms);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

// Local wall-clock time of a timestamp, e.g. "09/11 08:42" (used for the cache banner).
export function fmtStamp(ms) {
  const d = new Date(ms);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Fixed decimals, "." as decimal mark, thin-space thousands from 10 000 up, real minus sign.
export function fmtNum(x, decimals = 0, { sign = false } = {}) {
  if (x == null || !Number.isFinite(x)) return "—";
  const factor = 10 ** decimals;
  let r = Math.round(Math.abs(x) * factor) / factor;
  let [int, frac] = r.toFixed(decimals).split(".");
  if (int.length > 4) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const body = frac ? `${int}.${frac}` : int;
  const isZero = r === 0;
  if (x < 0 && !isZero) return `−${body}`;
  if (sign && !isZero) return `+${body}`;
  return body;
}

// ---------- CSV ----------

// RFC 4180-style parser: quoted fields, doubled quotes, \r\n, \n or \r line endings, BOM.
export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

// Numbers as typed in a sheet: "3985", "3985.5", "3985,5", "12,345", "12.345", "12 345".
// Groups of exactly three digits after a separator are thousands; otherwise a decimal mark.
export function parseNumber(raw) {
  const s = String(raw).trim().replace(/[\s  ]/g, "");
  if (!s) return NaN;
  const neg = /^[-−]/.test(s);
  const t = neg ? s.slice(1) : s;
  let v;
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) v = Number(t.replace(/[.,]/g, ""));
  else if (/^\d+([.,]\d+)?$/.test(t)) v = Number(t.replace(",", "."));
  else return NaN;
  return neg ? -v : v;
}

// DD/MM/YYYY (also D/M/YYYY) -> UTC midnight in ms, or null if not a real calendar date.
export function parseDate(raw) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(raw).trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

// Team-name lookup: current league.json names plus each team's former names ("aliases").
function teamLookup(cfg) {
  const map = new Map();
  for (const t of cfg.teams) for (const n of [t.name, ...(t.aliases ?? [])]) map.set(norm(n), t.id);
  return map;
}

// Returns { rows, warnings, error }. rows: [{ ms, teamId, points, spaces, outs }].
export function parsePablete(text, cfg) {
  const warnings = [];
  const table = parseCSV(text ?? "");
  const nonEmpty = table.map((cells, i) => ({ cells, line: i + 1 })).filter(r => r.cells.some(c => c.trim() !== ""));
  if (!nonEmpty.length) return { rows: [], warnings, error: "The sheet came back empty." };

  const header = nonEmpty[0].cells.map(norm);
  const idx = {};
  const missing = [];
  for (const [key, name] of Object.entries(PABLETE.columns)) {
    idx[key] = header.indexOf(norm(name));
    if (idx[key] < 0) missing.push(name);
  }
  if (missing.length) return { rows: [], warnings, error: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.` };

  const lookup = teamLookup(cfg);
  const seen = new Map();
  for (const { cells, line } of nonEmpty.slice(1)) {
    const get = k => (cells[idx[k]] ?? "").trim();
    const teamName = get("team");
    if (!teamName) continue; // rows without a team are spacer/blank rows in the sheet
    const where = `line ${line} (${teamName}${get("date") ? `, ${get("date")}` : ""})`;

    const ms = parseDate(get("date"));
    if (ms == null) { warnings.push(`${where}: bad date "${get("date")}"`); continue; }
    const teamId = lookup.get(norm(teamName));
    if (!teamId) { warnings.push(`${where}: unknown team`); continue; }
    const points = parseNumber(get("points"));
    const spaces = parseNumber(get("spaces"));
    const outs = parseNumber(get("outs"));
    if (!Number.isFinite(points) || points < 0) { warnings.push(`${where}: bad points "${get("points")}"`); continue; }
    if (!Number.isInteger(spaces) || spaces < 0) { warnings.push(`${where}: bad spaces "${get("spaces")}"`); continue; }
    if (!Number.isInteger(outs) || outs < 0 || outs > spaces) { warnings.push(`${where}: bad outs "${get("outs")}"`); continue; }

    const key = `${ms}|${teamId}`;
    if (seen.has(key)) warnings.push(`${where}: duplicate team on this date — the later row is used`);
    seen.set(key, { ms, teamId, points, spaces, outs });
  }
  return { rows: [...seen.values()], warnings, error: null };
}

// ---------- calculations ----------

const div = (a, b) => (b > 0 ? a / b : null);
const sub = (a, b) => (a == null || b == null ? null : a - b);

// Returns { dates: [ms ascending], latest: ms, byDate: Map(ms -> entries[]), warnings }.
// Entry: { teamId, ms, points, spaces, outs, clean, avg, avgClean, lost, rank,
//          prevMs, dPoints, dSpaces, dClean, dAvg, dAvgClean, dRank }
// dRank > 0 means the team moved up (e.g. from 4th to 2nd = +2).
export function buildPablete(rows, cfg) {
  const warnings = [];
  const dates = [...new Set(rows.map(r => r.ms))].sort((a, b) => a - b);
  const byDate = new Map(dates.map(ms => [ms, []]));
  for (const r of rows) {
    const clean = r.spaces - r.outs;
    const avgClean = div(r.points, clean);
    byDate.get(r.ms).push({
      ...r, clean,
      avg: div(r.points, r.spaces),
      avgClean,
      lost: avgClean == null ? null : r.outs * avgClean,
    });
  }

  // Competition ranking by total points (ties share a rank: 1, 2, 2, 4).
  for (const list of byDate.values()) {
    list.sort((a, b) => b.points - a.points);
    list.forEach((e, i) => { e.rank = i > 0 && e.points === list[i - 1].points ? list[i - 1].rank : i + 1; });
  }

  // Changes against each team's previous Pablete.
  const last = new Map();
  for (const ms of dates) {
    for (const e of byDate.get(ms)) {
      const p = last.get(e.teamId) ?? null;
      e.prevMs = p ? p.ms : null;
      e.dPoints = p ? e.points - p.points : null;
      e.dSpaces = p ? e.spaces - p.spaces : null;
      e.dClean = p ? e.clean - p.clean : null;
      e.dAvg = p ? sub(e.avg, p.avg) : null;
      e.dAvgClean = p ? sub(e.avgClean, p.avgClean) : null;
      e.dRank = p ? p.rank - e.rank : null;
      if (p && e.outs < p.outs) warnings.push(`${fmtDate(ms)}, ${cfg.teams.find(t => t.id === e.teamId).name}: outs went down (${p.outs} → ${e.outs})`);
      last.set(e.teamId, e);
    }
  }

  const latest = dates.at(-1) ?? null;
  if (latest != null) {
    const have = new Set(byDate.get(latest).map(e => e.teamId));
    const absent = cfg.teams.filter(t => !have.has(t.id)).map(t => t.name);
    if (absent.length) warnings.push(`${fmtDate(latest)}: no row for ${absent.join(", ")}`);
  }
  return { dates, latest, byDate, warnings };
}

// ---------- fetch + last-good cache ----------

function readCache() {
  try {
    const raw = localStorage.getItem(PABLETE.cacheKey);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return typeof o?.csv === "string" && Number.isFinite(o?.fetchedAt) ? o : null;
  } catch { return null; }
}

function writeCache(csv) {
  try { localStorage.setItem(PABLETE.cacheKey, JSON.stringify({ csv, fetchedAt: Date.now() })); } catch { /* storage unavailable */ }
}

function usable(parsed) {
  return !parsed.error && parsed.rows.length >= PABLETE.minValidRows;
}

async function fetchCSV() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PABLETE.fetchTimeoutMs);
  try {
    const r = await fetch(PABLETE.csvUrl, { cache: "no-store", signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(timer); }
}

// Returns { source: "live" | "cache" | "none", parsed?, fetchedAt?, problem? }.
// A fetched CSV is cached only if it parses with at least minValidRows valid rows,
// so a broken or empty sheet never overwrites a good copy.
export async function loadPablete(cfg) {
  let problem;
  try {
    const text = await fetchCSV();
    const parsed = parsePablete(text, cfg);
    if (usable(parsed)) {
      writeCache(text);
      return { source: "live", parsed, fetchedAt: Date.now() };
    }
    problem = parsed.error ?? `only ${parsed.rows.length} valid rows`;
  } catch (e) {
    problem = e?.name === "AbortError" ? "the sheet took too long to answer" : String(e?.message ?? e);
  }

  const cached = readCache();
  if (cached) {
    const parsed = parsePablete(cached.csv, cfg);
    if (usable(parsed)) return { source: "cache", parsed, fetchedAt: cached.fetchedAt, problem };
  }
  return { source: "none", problem };
}
