import csv
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

csv_path = Path(r"C:\Ais_dossier\data\ais\taylor_energy_mc20_noaa_ais_2023_11_17.csv")
db_path = Path(r"C:\Ais_dossier\Krushna2\data\app.db")

print(f"Connecting to {db_path}...")
conn = sqlite3.connect(db_path)
cur = conn.cursor()

vessels = {}
pos_rows = []

print(f"Reading {csv_path}...")
with open(csv_path, "r", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        try:
            mmsi = int(row["mmsi"])
            dt = datetime.fromisoformat(row["timestamp"]).replace(tzinfo=timezone.utc)
            ts = dt.timestamp()
            lat = float(row["latitude"])
            lon = float(row["longitude"])
            sog = float(row["speed_knots"]) if row["speed_knots"] else 0.0
            cog = float(row["course_deg"]) if row["course_deg"] else 0.0
            navstat = int(float(row["nav_status"])) if row["nav_status"] else 15

            pos_rows.append((mmsi, ts, lon, lat, sog, cog, navstat))

            if mmsi not in vessels:
                vessels[mmsi] = (
                    mmsi,
                    row["vessel_name"] or f"MMSI {mmsi}",
                    int(float(row["vessel_type"])) if row["vessel_type"] else 0,
                    "",
                    float(row["draft"]) if row["draft"] else 0.0,
                    int(float(row["imo"])) if row["imo"] else None,
                    row["callsign"] or "",
                    0.0,
                    0.0,
                    time.time(),
                )
        except Exception:
            continue

print(f"Parsed {len(pos_rows)} positions and {len(vessels)} unique vessels.")

cur.executemany(
    "INSERT OR REPLACE INTO vessels (mmsi, name, ship_type, dest, draught, imo, call_sign, length, width, updated) VALUES (?,?,?,?,?,?,?,?,?,?)",
    list(vessels.values()),
)
cur.executemany(
    "INSERT OR IGNORE INTO ais_positions (mmsi, ts, lon, lat, sog, cog, navstat) VALUES (?,?,?,?,?,?,?)",
    pos_rows,
)
conn.commit()

cur.execute("SELECT count(*) FROM ais_positions")
print("Total rows in ais_positions:", cur.fetchone()[0])
cur.execute("SELECT count(*) FROM vessels")
print("Total rows in vessels:", cur.fetchone()[0])

import json
traj = json.load(open(r"C:\Ais_dossier\Krushna2\frontend\public\demo\trajectories.json"))
print("\nCandidate Suspect Fix Verification:")
for mmsi, info in traj.items():
    cur.execute("SELECT count(*) FROM ais_positions WHERE mmsi=?", (int(mmsi),))
    cnt = cur.fetchone()[0]
    print(f"  MMSI {mmsi} ({info['name']}): {cnt} fixes in DB")

conn.close()
print("\nDone!")
