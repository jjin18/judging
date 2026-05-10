"""Populate dev database with one event and 10 judges. Projects are submitted
by teams via the public /submit page — we don't pre-list them."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from database import get_conn, init_db, tx, insert_returning_id
from auth import generate_pin


def seed(wipe: bool = True):
    init_db()
    if wipe:
        with tx() as c:
            c.execute("DELETE FROM scores")
            c.execute("DELETE FROM projects")
            c.execute("DELETE FROM judges")
            c.execute("DELETE FROM events")

    used_pins: set[str] = set()
    with tx() as c:
        event_id = insert_returning_id(
            c,
            """INSERT INTO events (name, date, venue, city, org_name, org_address, org_website,
                                   organizer_name, organizer_title, devpost_url, hours_expected)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            ("Hackathon May 9-10", "2026-05-09", "UBC", "Vancouver",
             "nwPlus", "University of British Columbia, Vancouver, BC", "nwplus.io",
             "nwPlus Director", "Director of Programs",
             "https://cmd-f-2025.devpost.com/", 6.0),
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
        for n, e, x in judges:
            pin = generate_pin(used_pins)
            insert_returning_id(
                c,
                "INSERT INTO judges (event_id, name, email, expertise, pin) VALUES (?, ?, ?, ?, ?)",
                (event_id, n, e, x, pin),
            )

    print(f"\nSeeded event {event_id}: {len(judges)} judges, 0 projects.")
    print("=" * 56)
    print("  Projects are submitted by teams at /submit")
    print("=" * 56)
    print("  Dummy judge PINs (6-digit numeric, randomly assigned).")
    print("  Judges enter their PIN at /judge — names no longer log in.")
    print("=" * 56)
    for j in get_conn().execute("SELECT name, pin FROM judges WHERE event_id = ?", (event_id,)):
        print(f"  {j['name']:18s}  PIN: {j['pin']}")
    print("=" * 56)
    print(f"  Admin password: {__import__('os').environ.get('ADMIN_PASSWORD', 'admin')}")
    print("=" * 56)


if __name__ == "__main__":
    seed()
