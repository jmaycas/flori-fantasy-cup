#!/usr/bin/env python3
"""Build data/draft_pool.json from ESPN's public fantasy basketball player data.

    python3 scripts/build_draft_pool.py [--limit 500]

Source: ESPN public fantasy API (league defaults, no login), view=kona_player_info.
ESPN's projected season stats are re-scored with the league scoring in
config/league.json. Players without an ESPN projection keep proj_fp = null.
"""
import argparse
import datetime as dt
import json
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{season}"

# ESPN stat ids -> league scoring keys
STAT_IDS = {"PTS": "0", "BLK": "1", "STL": "2", "AST": "3", "REB": "6", "TO": "11",
            "FGM": "13", "FGA": "14", "FTM": "15", "FTA": "16", "3PM": "17"}
GP_ID = "42"
POS_SLOTS = {0: "PG", 1: "SG", 2: "SF", 3: "PF", 4: "C"}
DEFAULT_POS = {1: "PG", 2: "SG", 3: "SF", 4: "PF", 5: "C"}
INJURY_LABELS = {"ACTIVE": None, "DAY_TO_DAY": "DTD", "OUT": "O", "INJURY_RESERVE": "IR",
                 "SUSPENSION": "SSPD", "QUESTIONABLE": "Q", "DOUBTFUL": "D"}


def get(url, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=1000)
    args = ap.parse_args()

    cfg = json.loads((ROOT / "config/league.json").read_text(encoding="utf-8"))
    season = cfg["league"]["espn_season_id"]
    scoring = cfg["league"]["scoring"]
    base = BASE.format(season=season)

    pro = get(f"{base}?view=proTeamSchedules_wl")
    teams = {t["id"]: t["abbrev"] for t in pro["settings"]["proTeams"]}

    flt = {"players": {"limit": args.limit,
                       "sortDraftRanks": {"sortPriority": 100, "sortAsc": True, "value": "STANDARD"}}}
    data = get(f"{base}/segments/0/leaguedefaults/1?view=kona_player_info",
               {"X-Fantasy-Filter": json.dumps(flt), "X-Fantasy-Platform": "kona-PROD"})

    players = []
    for row in data["players"]:
        p = row["player"]
        proj = next((s["stats"] for s in p.get("stats", [])
                     if s["seasonId"] == season and s["statSourceId"] == 1 and s["statSplitTypeId"] == 0
                     and s.get("stats")), None)
        proj_fp = proj_fpg = proj_g = None
        if proj:
            proj_fp = sum(pts * proj.get(STAT_IDS[k], 0.0) for k, pts in scoring.items())
            proj_g = proj.get(GP_ID) or None
            proj_fpg = proj_fp / proj_g if proj_g else None
        rank = p.get("draftRanksByRankType", {}).get("STANDARD", {}).get("rank")
        own = p.get("ownership") or {}
        players.append({
            "espn_id": p["id"],
            "name": p["fullName"],
            "nba_team": teams.get(p.get("proTeamId"), "FA"),
            "pos": [POS_SLOTS[s] for s in sorted(p.get("eligibleSlots", [])) if s in POS_SLOTS],
            "pos_main": DEFAULT_POS.get(p.get("defaultPositionId")),
            "espn_rank": rank,
            "adp": round(own["averageDraftPosition"], 1) if own.get("averageDraftPosition") else None,
            "injury_status": INJURY_LABELS.get(p.get("injuryStatus"), p.get("injuryStatus")),
            "proj_fp": round(proj_fp, 1) if proj_fp is not None else None,
            "proj_fpg": round(proj_fpg, 1) if proj_fpg is not None else None,
            "proj_g": proj_g,
        })

    out = {
        "source": "ESPN public fantasy API (league defaults), projections re-scored with league scoring",
        "season": cfg["league"]["season"],
        "built": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "players": players,
    }
    path = ROOT / "data/draft_pool.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    with_proj = sum(p["proj_fp"] is not None for p in players)
    print(f"build_draft_pool: wrote {path.relative_to(ROOT)} — {len(players)} players, {with_proj} with projections")


if __name__ == "__main__":
    main()
