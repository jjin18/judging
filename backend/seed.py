"""Populate dev database with one event, 10 judges, 50 projects, and partial scores."""
import random
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from database import get_conn, init_db, tx, insert_returning_id
from auth import normalize_pin


def seed(wipe: bool = True):
    init_db()
    if wipe:
        with tx() as c:
            c.execute("DELETE FROM scores")
            c.execute("DELETE FROM projects")
            c.execute("DELETE FROM judges")
            c.execute("DELETE FROM events")

    with tx() as c:
        event_id = insert_returning_id(
            c,
            """INSERT INTO events (name, date, venue, city, org_name, org_address, org_website,
                                   organizer_name, organizer_title, hours_expected)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            ("Hackathon SF 2026", "2026-05-15", "Pier 27", "San Francisco",
             "Buildspace", "395 The Embarcadero, San Francisco, CA", "buildspace.so",
             "Daniel Liu", "Director of Programs", 5.0),
        )

        judges = [
            ("Jia Jin",      "jia@example.com",     "AI/ML"),
            ("Daniel Park",  "daniel@example.com",  "Backend Systems"),
            ("Asha Patel",   "asha@example.com",    "Product Design"),
            ("Marcus Chen",  "marcus@example.com",  "Distributed Systems"),
            ("Priya Iyer",   "priya@example.com",   "Mobile"),
            ("Liam O'Brien", "liam@example.com",    "Web3"),
            ("Sofia Reyes",  "sofia@example.com",   "Computer Vision"),
            ("Hiro Tanaka",  "hiro@example.com",    "Robotics"),
            ("Nadia Volkov", "nadia@example.com",   "DevTools"),
            ("Eli Kim",      "eli@example.com",     "Security"),
        ]
        judge_ids = []
        for n, e, x in judges:
            jid = insert_returning_id(
                c,
                "INSERT INTO judges (event_id, name, email, expertise, pin) VALUES (?, ?, ?, ?, ?)",
                (event_id, n, e, x, normalize_pin(n)),
            )
            judge_ids.append(jid)

        tracks = ["AI", "Web3", "Climate", "Health", "Education", "DevTools"]
        adjectives = ["Quantum", "Neural", "Hyper", "Adaptive", "Mesh", "Open", "Stellar",
                      "Pulse", "Aurora", "Echo", "Nebula", "Forge"]
        nouns = ["Lab", "Forge", "Pilot", "Loop", "Beacon", "Compass", "Cipher",
                 "Atlas", "Pivot", "Prism", "Helm", "Tide"]
        team_words = ["Hackers", "Builders", "Collective", "Lab", "Studio", "Crew", "Team"]

        project_ids = []
        for i in range(50):
            title = f"{random.choice(adjectives)}{random.choice(nouns)}-{i + 1:02d}"
            team = f"{random.choice(adjectives)} {random.choice(team_words)}"
            track = random.choice(tracks)
            table = f"{i + 1:02d}"
            desc = f"A {track.lower()} project that {random.choice(['analyzes', 'predicts', 'visualizes', 'automates', 'optimizes'])} {random.choice(['workflows', 'data streams', 'user behavior', 'energy use', 'health signals'])}."
            slug = title.lower().replace(' ', '-')
            pid = insert_returning_id(
                c,
                """INSERT INTO projects (event_id, title, team_name, table_number, track, description, devpost_url)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (event_id, title, team, table, track, desc, f"https://example.devpost.com/{slug}"),
            )
            project_ids.append(pid)

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

    print(f"\nSeeded event {event_id}: 10 judges, 50 placeholder projects.")
    print("=" * 56)
    print("  Dummy judge PINs — type the name on /judge (any case,")
    print("  with or without spaces; accents and punctuation ignored).")
    print("=" * 56)
    for j in get_conn().execute("SELECT name, pin FROM judges WHERE event_id = ?", (event_id,)):
        print(f"  {j['name']:18s}  PIN: {j['pin']}")
    print("=" * 56)
    print(f"  Admin password: {__import__('os').environ.get('ADMIN_PASSWORD', 'admin')}")
    print("=" * 56)


if __name__ == "__main__":
    seed()
