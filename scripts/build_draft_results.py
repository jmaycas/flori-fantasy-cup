#!/usr/bin/env python3
"""Turn an exported draft (pick number, team, player name) into data/draft-<season>.json.

    python3 scripts/build_draft_results.py private/<export>.json [--fix "Old Name=New Name" ...]

Only pick number, team and player name are read from the export; every other field is
ignored. Players are matched to data/draft_pool.json by name, accent-insensitive.
Checks: 8 x rounds picks, numbered 1..N, rounds per team, no duplicate players, team of
each pick = snake order from config/league.json. Nothing is written if a check fails.
"""
import argparse
import collections
import json
import pathlib
import re
import sys
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]", "", s).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("export")
    ap.add_argument("--fix", action="append", default=[], help='correct a pick: "Old Name=New Name"')
    args = ap.parse_args()

    cfg = json.loads((ROOT / "config/league.json").read_text(encoding="utf-8"))
    pool = json.loads((ROOT / "data/draft_pool.json").read_text(encoding="utf-8"))["players"]
    raw = json.loads(pathlib.Path(args.export).read_text(encoding="utf-8"))
    rows = raw if isinstance(raw, list) else next(
        v for v in raw.values() if isinstance(v, list) and v and isinstance(v[0], dict) and {"pick", "team", "player"} <= v[0].keys())
    fixes = dict(f.split("=", 1) for f in args.fix)

    by_name = collections.defaultdict(list)
    for p in pool:
        by_name[norm(p["name"])].append(p)
    team_ids = {norm(t["name"]): t["id"] for t in cfg["teams"]}
    order = [t["id"] for t in sorted(cfg["teams"], key=lambda t: t["draft_slot"])]
    n_teams, rounds = len(order), cfg["league"]["rounds"]

    def snake(n):
        r, i = divmod(n - 1, n_teams)
        return order[i] if r % 2 == 0 else order[n_teams - 1 - i]

    errors, picks = [], []
    for row in rows:
        n, team, name = int(row["pick"]), row["team"], fixes.get(row["player"], row["player"])
        team_id = team_ids.get(norm(team))
        matches = by_name.get(norm(name), [])
        if not team_id:
            errors.append(f"pick {n}: unknown team {team!r}")
        if len(matches) != 1:
            errors.append(f"pick {n}: {name!r} {'not in the pool' if not matches else 'matches several players'}")
            continue
        p = matches[0]
        picks.append({"n": n, "round": (n - 1) // n_teams + 1, "teamId": team_id, "espnId": p["espn_id"],
                      "name": p["name"], "pos": p["pos"], "posMain": p["pos_main"], "nbaTeam": p["nba_team"]})

    picks.sort(key=lambda p: p["n"])
    if [p["n"] for p in picks] != list(range(1, n_teams * rounds + 1)) and not errors:
        errors.append(f"pick numbers are not 1..{n_teams * rounds}")
    for t, c in collections.Counter(p["teamId"] for p in picks).items():
        if c != rounds:
            errors.append(f"{t}: {c} picks, expected {rounds}")
    for pid, c in collections.Counter(p["espnId"] for p in picks).items():
        if c > 1:
            errors.append(f"player drafted {c} times: {next(p['name'] for p in picks if p['espnId'] == pid)}")
    errors += [f"pick {p['n']}: {p['teamId']} but snake order says {snake(p['n'])}" for p in picks if snake(p["n"]) != p["teamId"]]

    if errors:
        print("build_draft_results: not written —", *errors, sep="\n  ")
        sys.exit(1)

    season = cfg["league"]["season"]
    out = ROOT / f"data/draft-{season}.json"
    lines = ",\n".join("  " + json.dumps(p, ensure_ascii=False) for p in picks)
    head = json.dumps({"draft": season, "order": order, "rounds": rounds}, ensure_ascii=False)[:-1]
    out.write_text(f'{head}, "picks": [\n{lines}\n]}}\n', encoding="utf-8")
    print(f"build_draft_results: wrote {out.relative_to(ROOT)} — {len(picks)} picks, {rounds} per team, snake order OK")


if __name__ == "__main__":
    main()
