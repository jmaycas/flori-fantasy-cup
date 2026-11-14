// Pablete ESPN ☕ — data-generated words for "The Race": headline, subtitle and up to two
// notes on the chart, for one Pablete date. Fixed templates only, filled with facts computed
// from the sheet CSV. No adjectives about teams or GMs. No D3 here (testable in Node).
// Every template is listed in notes/pablete_phase_3a.md for Jose's review.

import { fmtNum, fmtDate } from "./pablete-data.js";

export const TEMPLATES = {
  // Headlines — Gap to leader / Total points
  hOpen: "{leader} starts the season on top",
  hTie: "{teams} are level at the top",
  hTakesLead: "{leader} takes the lead from {prevLeader}",
  hLeads: "{leader} leads by {gap} points",
  // Headlines — Rank
  hClimbs: "{team} climbs to {rank}",
  hHold: "No change in the standings",
  // Headlines — Average
  hBestAvg: "{team} has the best average: {avg} points per {space}",

  // Subtitles — Gap to leader / Total points
  sOpen: "{points} points after the first Pablete, {gap} ahead of {second}.",
  sOpenTie: "{points} points each after the first Pablete.",
  sGapGrew: "The lead over {second} grew by {change} points since {prevDate}.",
  sGapShrank: "The lead over {second} shrank by {change} points since {prevDate}.",
  sGapSame: "The lead over {second} is the same as on {prevDate}.",
  sNewSecond: "{second} is now 2nd, {gap} points behind.",
  sClimb: "{team} climbs from {from} to {to}.",
  // Subtitles — Rank
  sStreak: "{leader} has been 1st in {k} of {n} Pabletes.",
  sClimbFrom: "{team} was {from} on {prevDate}.",
  // Subtitles — Average
  sAvgNext: "{second} is next with {avg}.",
  sAvgMove: "Biggest change since {prevDate}: {team}, {change}.",

  // Notes on the chart
  nClosed: "Closed {change} pts on the leader since {prevDate}",
  nStreakNow: "1st for {k} Pabletes in a row",
  nStreakPast: "Led {k} Pabletes in a row ({from}–{to})",
};

const fill = (tpl, vals) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(vals[k] ?? ""));

export function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th");
  return `${n}${s}`;
}

const dm = ms => fmtDate(ms).slice(0, 5);
const pts = x => fmtNum(Math.round(x), 0);
const listNames = names => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** Entries of one date sorted by rank (ties by name, so the order is stable). */
export function rankOrder(cfg, entries) {
  const name = id => cfg.teams.find(t => t.id === id)?.name ?? id;
  return [...entries].sort((a, b) => a.rank - b.rank || name(a.teamId).localeCompare(name(b.teamId)));
}

/** Longest run of consecutive Pabletes at rank 1 up to date index i (ties: the most recent). */
function longestLead(data, i) {
  const runs = new Map(); // teamId -> current run start
  let best = null;
  for (let j = 0; j <= i; j++) {
    const leaders = new Set(data.byDate.get(data.dates[j]).filter(e => e.rank === 1).map(e => e.teamId));
    for (const id of [...runs.keys()]) if (!leaders.has(id)) runs.delete(id);
    for (const id of leaders) {
      if (!runs.has(id)) runs.set(id, j);
      const k = j - runs.get(id) + 1;
      if (!best || k >= best.k) best = { teamId: id, k, from: runs.get(id), to: j };
    }
  }
  return best;
}

/**
 * Words for date index i.
 * Returns { headline, dek, notes: [{ teamId, kind, text }], order, spotlight } — notes are
 * metric-independent; spotlight = the top 2 on the current metric (by average on Average,
 * by rank otherwise) plus the team a Rank headline is about.
 */
export function story(cfg, data, i, metric, mode) {
  const name = id => cfg.teams.find(t => t.id === id)?.name ?? id;
  const ms = data.dates[i];
  const prevMs = i > 0 ? data.dates[i - 1] : null;
  const order = rankOrder(cfg, data.byDate.get(ms));
  const prevOrder = prevMs != null ? rankOrder(cfg, data.byDate.get(prevMs)) : null;
  const leaders = order.filter(e => e.rank === 1);
  const lead = leaders[0];
  const second = order.find(e => e.rank > 1) ?? null;
  const gap = second ? lead.points - second.points : 0;
  const prevLeaders = prevOrder ? prevOrder.filter(e => e.rank === 1) : [];
  const prevDate = prevMs != null ? dm(prevMs) : "";

  // biggest climb since the previous Pablete (dRank > 0 = moved up); ties → better new rank
  const climber = order.filter(e => e.dRank > 0).sort((a, b) => b.dRank - a.dRank || a.rank - b.rank)[0] ?? null;

  let headline, dek;
  // Teams the words are about: shown in colour when the viewer hasn't picked any team.
  let spotlight = order.slice(0, 2).map(e => e.teamId);
  if (metric === "avg") {
    const val = e => (mode === "clean" ? e.avgClean : e.avg);
    const chg = e => (mode === "clean" ? e.dAvgClean : e.dAvg);
    const byAvg = order.filter(e => val(e) != null).sort((a, b) => val(b) - val(a));
    const top = byAvg[0], next = byAvg[1];
    spotlight = byAvg.slice(0, 2).map(e => e.teamId);
    headline = fill(TEMPLATES.hBestAvg, { team: name(top.teamId), avg: fmtNum(val(top), 2), space: mode === "clean" ? "clean space" : "space" });
    const parts = [];
    if (next) parts.push(fill(TEMPLATES.sAvgNext, { second: name(next.teamId), avg: fmtNum(val(next), 2) }));
    const mover = order.filter(e => chg(e) != null).sort((a, b) => Math.abs(chg(b)) - Math.abs(chg(a)))[0];
    if (i > 0 && mover && chg(mover) !== 0) {
      parts.push(fill(TEMPLATES.sAvgMove, { prevDate, team: name(mover.teamId), change: fmtNum(chg(mover), 2, { sign: true }) }));
    }
    dek = parts.join(" ");
  } else if (metric === "rank") {
    if (leaders.length > 1) headline = fill(TEMPLATES.hTie, { teams: listNames(leaders.map(e => name(e.teamId))) });
    else if (i === 0) headline = fill(TEMPLATES.hOpen, { leader: name(lead.teamId) });
    else if (climber) {
      headline = fill(TEMPLATES.hClimbs, { team: name(climber.teamId), rank: ordinal(climber.rank) });
      if (!spotlight.includes(climber.teamId)) spotlight.push(climber.teamId);
    }
    else headline = TEMPLATES.hHold;
    const k = data.dates.slice(0, i + 1).filter(d => data.byDate.get(d).some(e => e.teamId === lead.teamId && e.rank === 1)).length;
    const parts = [];
    if (i === 0) {
      if (leaders.length > 1) parts.push(fill(TEMPLATES.sOpenTie, { points: pts(lead.points) }));
      else if (second) parts.push(fill(TEMPLATES.sOpen, { points: pts(lead.points), gap: pts(gap), second: name(second.teamId) }));
    } else parts.push(fill(TEMPLATES.sStreak, { leader: name(lead.teamId), k, n: i + 1 }));
    if (i > 0 && climber && leaders.length === 1) {
      parts.push(fill(TEMPLATES.sClimbFrom, { team: name(climber.teamId), from: ordinal(climber.rank + climber.dRank), prevDate }));
    }
    dek = parts.join(" ");
  } else {
    // Gap to leader and Total points tell the same story: who leads and by how much.
    if (leaders.length > 1) headline = fill(TEMPLATES.hTie, { teams: listNames(leaders.map(e => name(e.teamId))) });
    else if (i === 0) headline = fill(TEMPLATES.hOpen, { leader: name(lead.teamId) });
    else if (!prevLeaders.some(e => e.teamId === lead.teamId)) {
      headline = fill(TEMPLATES.hTakesLead, { leader: name(lead.teamId), prevLeader: listNames(prevLeaders.map(e => name(e.teamId))) });
    } else headline = fill(TEMPLATES.hLeads, { leader: name(lead.teamId), gap: pts(gap) });

    const parts = [];
    if (i === 0) {
      if (leaders.length > 1) parts.push(fill(TEMPLATES.sOpenTie, { points: pts(lead.points) }));
      else if (second) parts.push(fill(TEMPLATES.sOpen, { points: pts(lead.points), gap: pts(gap), second: name(second.teamId) }));
    } else if (leaders.length === 1 && second) {
      const prevLead = prevOrder[0];
      const prevSecond = prevOrder.find(e => e.rank > 1);
      const sameTop = prevLead.teamId === lead.teamId && prevSecond && prevSecond.teamId === second.teamId && prevLeaders.length === 1;
      if (sameTop) {
        const d = Math.round(gap) - Math.round(prevLead.points - prevSecond.points);
        const tpl = d > 0 ? TEMPLATES.sGapGrew : d < 0 ? TEMPLATES.sGapShrank : TEMPLATES.sGapSame;
        parts.push(fill(tpl, { second: name(second.teamId), change: pts(Math.abs(d)), prevDate }));
      } else {
        parts.push(fill(TEMPLATES.sNewSecond, { second: name(second.teamId), gap: pts(gap) }));
      }
      if (climber && climber.teamId !== lead.teamId && climber.teamId !== second.teamId) {
        parts.push(fill(TEMPLATES.sClimb, { team: name(climber.teamId), from: ordinal(climber.rank + climber.dRank), to: ordinal(climber.rank) }));
      }
    }
    dek = parts.join(" ");
  }

  // ----- notes (fixed rules, at most two) -----
  const notes = [];
  if (prevOrder) {
    const leadNow = Math.max(...order.map(e => e.points));
    const leadPrev = Math.max(...prevOrder.map(e => e.points));
    let best = null;
    for (const e of order) {
      const p = prevOrder.find(q => q.teamId === e.teamId);
      if (!p) continue;
      const gp = leadPrev - p.points, gn = leadNow - e.points;
      const closed = gp - gn;
      if (gp > 0 && Math.round(closed) >= 1 && (!best || closed > best.closed)) best = { teamId: e.teamId, closed };
    }
    if (best) notes.push({ teamId: best.teamId, kind: "closed", text: fill(TEMPLATES.nClosed, { change: pts(best.closed), prevDate }) });
  }
  const run = longestLead(data, i);
  if (run && run.k >= 2) {
    const text = run.to === i
      ? fill(TEMPLATES.nStreakNow, { k: run.k })
      : fill(TEMPLATES.nStreakPast, { k: run.k, from: dm(data.dates[run.from]), to: dm(data.dates[run.to]) });
    notes.push({ teamId: run.teamId, kind: "streak", text });
  }

  return { headline, dek, notes, order, spotlight };
}
