"""Populate dev database with one event, 10 judges, 50 projects, and partial scores."""
import random
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from database import get_conn, init_db, tx


def seed():
    init_db()
    conn = get_conn()
    conn.execute("DELETE FROM scores")
    conn.execute("DELETE FROM projects")
    conn.execute("DELETE FROM judges")
    conn.execute("DELETE FROM events")

    with tx() as c:
        cur = c.execute(
            """INSERT INTO events (name, date, venue, city, org_name, org_address, org_website,
                                   organizer_name, organizer_title, hours_expected)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            ("Hackathon SF 2026", "2026-05-15", "Pier 27", "San Francisco",
             "Buildspace", "395 The Embarcadero, San Francisco, CA", "buildspace.so",
             "Daniel Liu", "Director of Programs", 5.0),
        )
        event_id = cur.lastrowid

        judges = [
            ("Jia Jin",      "jia@example.com",     "AI/ML",                "100001"),
            ("Daniel Park",  "daniel@example.com",  "Backend Systems",      "100002"),
            ("Asha Patel",   "asha@example.com",    "Product Design",       "100003"),
            ("Marcus Chen",  "marcus@example.com",  "Distributed Systems",  "100004"),
            ("Priya Iyer",   "priya@example.com",   "Mobile",               "100005"),
            ("Liam O'Brien", "liam@example.com",    "Web3",                 "100006"),
            ("Sofia Reyes",  "sofia@example.com",   "Computer Vision",      "100007"),
            ("Hiro Tanaka",  "hiro@example.com",    "Robotics",             "100008"),
            ("Nadia Volkov", "nadia@example.com",   "DevTools",             "100009"),
            ("Eli Kim",      "eli@example.com",     "Security",             "100010"),
        ]
        judge_ids = []
        for n, e, x, pin in judges:
            cur = c.execute(
                "INSERT INTO judges (event_id, name, email, expertise, pin) VALUES (?, ?, ?, ?, ?)",
                (event_id, n, e, x, pin),
            )
            judge_ids.append(cur.lastrowid)

        tracks = ["AI", "Web3", "Climate", "Health", "Education", "DevTools"]
        adjectives = ["Quantum", "Neural", "Hyper", "Adaptive", "Mesh", "Open", "Stellar",
                      "Pulse", "Aurora", "Echo", "Nebula", "Forge"]
        nouns = ["Lab", "Forge", "Pilot", "Loop", "Beacon", "Compass", "Cipher",
                 "Atlas", "Pivot", "Prism", "Helm", "Tide"]
        team_words = ["Hackers", "Builders", "Collective", "Lab", "Studio", "Crew", "Team"]

        project_ids = []
        for i in range(50):
            title = f"{random.choice(adjectives)}{random.choice(nouns)}"
            team = f"{random.choice(adjectives)} {random.choice(team_words)}"
            track = random.choice(tracks)
            table = f"{i + 1:02d}"
            desc = f"A {track.lower()} project that {random.choice(['analyzes', 'predicts', 'visualizes', 'automates', 'optimizes'])} {random.choice(['workflows', 'data streams', 'user behavior', 'energy use', 'health signals'])}."
            cur = c.execute(
                """INSERT INTO projects (event_id, title, team_name, table_number, track, description, devpost_url)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (event_id, title, team, table, track, desc, f"https://example.devpost.com/{title.lower()}"),
            )
            project_ids.append(cur.lastrowid)

        weights = (0.25, 0.25, 0.25, 0.25)
        for jid in judge_ids[:5]:
            for pid in random.sample(project_ids, k=random.randint(8, 20)):
                inn = round(random.uniform(4, 10), 1)
                tech = round(random.uniform(4, 10), 1)
                imp = round(random.uniform(4, 10), 1)
                pres = round(random.uniform(4, 10), 1)
                raw = inn + tech + imp + pres
                weighted = inn * weights[0] + tech * weights[1] + imp * weights[2] + pres * weights[3]
                c.execute(
                    """INSERT INTO scores (judge_id, project_id, innovation, technical, impact, presentation,
                                           total_raw, total_weighted, notes, sync_status)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')""",
                    (jid, pid, inn, tech, imp, pres, raw, weighted, ""),
                )

    print(f"\nSeeded event {event_id}: 10 judges, 50 projects.")
    print("=" * 48)
    print("  Dummy judge PINs — type any of these on /judge")
    print("=" * 48)
    for j in get_conn().execute("SELECT name, pin FROM judges WHERE event_id = ?", (event_id,)):
        print(f"  {j['name']:18s}  PIN: {j['pin']}")
    print("=" * 48)
    print(f"  Admin password: {__import__('os').environ.get('ADMIN_PASSWORD', 'admin')}")
    print("=" * 48)


if __name__ == "__main__":
    seed()
