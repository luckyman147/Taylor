import sqlite3

conn = sqlite3.connect("data/resume_matcher.db")
rows = conn.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='outreach_analysis'"
).fetchall()
print("table exists:", bool(rows))
conn.close()
