// Draft and roster data shared by draft.html and teams.html: Firebase access, snake order,
// position helpers. Firestore layout:
//   drafts/{draftId}   {order, rounds, picks:[{n, round, teamId, espnId, name, pos, posMain, nbaTeam, ts}], status, updatedAt}
//   rosters/{teamId}   {teamId, season, source, players:[{espnId, name, pos, posMain, nbaTeam, pick, round}], updatedAt}
import { firebaseConfig, FIREBASE_SDK } from "./firebase-config.js";

export const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
// Starting slots that need a specific position; UTIL takes anyone.
const SLOT_ELIGIBLE = { PG: ["PG"], SG: ["SG"], SF: ["SF"], PF: ["PF"], C: ["C"], G: ["PG", "SG"], F: ["SF", "PF"] };

let fb;
export async function firebase() {
  if (fb) return fb;
  const [{ initializeApp }, auth, store] = await Promise.all([
    import(`${FIREBASE_SDK}/firebase-app.js`),
    import(`${FIREBASE_SDK}/firebase-auth.js`),
    import(`${FIREBASE_SDK}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  fb = { auth: auth.getAuth(app), db: store.getFirestore(app), A: auth, F: store };
  return fb;
}

// Team on the clock for overall pick n (1-based) in a snake draft.
export function snakeTeam(order, n) {
  const round = Math.floor((n - 1) / order.length);
  const i = (n - 1) % order.length;
  return round % 2 === 0 ? order[i] : order[order.length - 1 - i];
}

// Overall pick number of a team's pick in a given round.
export function pickNumber(order, teamId, round) {
  const i = order.indexOf(teamId);
  return (round - 1) * order.length + (round % 2 === 1 ? i + 1 : order.length - i);
}

export const mainPos = p => p.posMain || p.pos?.[0] || "";
export const posLabel = p => (p.pos || []).join("/") || "—";
export const byPosition = (a, b) =>
  POSITIONS.indexOf(mainPos(a)) - POSITIONS.indexOf(mainPos(b)) || (a.pick ?? a.n ?? 0) - (b.pick ?? b.n ?? 0);

// Eligibility counts and which positional slots can be filled at the same time
// (bipartite matching of players to PG, SG, SF, PF, C, G, F).
export function positionStrip(players) {
  const counts = Object.fromEntries(POSITIONS.map(p => [p, players.filter(x => x.pos?.includes(p)).length]));
  const slots = Object.keys(SLOT_ELIGIBLE);
  const owner = {};
  const tryAssign = (slot, seen) => {
    for (let i = 0; i < players.length; i++) {
      if (seen.has(i) || !SLOT_ELIGIBLE[slot].some(p => players[i].pos?.includes(p))) continue;
      seen.add(i);
      const holder = Object.keys(owner).find(s => owner[s] === i);
      if (holder === undefined || tryAssign(holder, seen)) {
        owner[slot] = i;
        return true;
      }
    }
    return false;
  };
  for (const s of slots) tryAssign(s, new Set());
  return { counts, filled: Object.fromEntries(slots.map(s => [s, s in owner])) };
}

// Checks a full set of picks against the league: count, numbering, picks per team,
// duplicate players, snake order. Returns a list of problems (empty = OK).
export function checkPicks(picks, order, rounds) {
  const problems = [];
  const total = order.length * rounds;
  const ns = picks.map(p => p.n).sort((a, b) => a - b);
  if (picks.length !== total || ns.some((n, i) => n !== i + 1)) problems.push(`expected picks 1–${total}, got ${picks.length}`);
  for (const t of order) {
    const c = picks.filter(p => p.teamId === t).length;
    if (c !== rounds) problems.push(`${t}: ${c} picks, expected ${rounds}`);
  }
  const seen = new Set();
  for (const p of picks) {
    if (seen.has(p.espnId)) problems.push(`${p.name} drafted twice`);
    seen.add(p.espnId);
    if (snakeTeam(order, p.n) !== p.teamId) problems.push(`pick ${p.n}: ${p.teamId}, snake order says ${snakeTeam(order, p.n)}`);
  }
  return problems;
}

// Rosters built from the draft picks.
export function rostersFromPicks(picks, order) {
  return Object.fromEntries(order.map(t => [t, picks.filter(p => p.teamId === t)
    .map(p => ({ espnId: p.espnId, name: p.name, pos: p.pos, posMain: p.posMain, nbaTeam: p.nbaTeam, pick: p.n, round: p.round }))]));
}

export async function loadResultsFile(season) {
  const r = await fetch(`data/draft-${season}.json`, { cache: "no-cache" });
  if (!r.ok) throw new Error(`data/draft-${season}.json: HTTP ${r.status}`);
  return r.json();
}
