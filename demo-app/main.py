"""Read-only standalone view of the exact PostgreSQL dataset protected by AegisDR."""

import os
from pathlib import Path

import psycopg
from fastapi import FastAPI
from fastapi.responses import HTMLResponse

app = FastAPI(title="Atlas Notes · disposable demo")


def connection():
    url = (
        Path(os.environ["DATABASE_URL_FILE"]).read_text().strip()
        if os.environ.get("DATABASE_URL_FILE")
        else os.environ["DATABASE_URL"]
    )
    return psycopg.connect(url, connect_timeout=5)


@app.get("/health")
def health():
    with connection() as db:
        db.execute("SELECT 1")
    return {"status": "ok", "database": "postgresql"}


@app.get("/notes")
def notes():
    with connection() as db:
        exists = db.execute("SELECT to_regclass('public.notes')").fetchone()[0]
        if not exists:
            return {"notes": [], "state": "waiting for platform initialization"}
        return {
            "notes": [{"id": row[0], "text": row[1]} for row in db.execute("SELECT id, text FROM notes ORDER BY id")]
        }


@app.get("/", response_class=HTMLResponse)
def home():
    import html

    rows = "".join(f"<li>{html.escape(row['text'])}</li>" for row in notes()["notes"])
    return f"""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atlas Notes</title><style>body{{font:16px system-ui;background:#101010;color:#f5f5f5;max-width:700px;margin:12vh auto;padding:24px}}li{{padding:20px 0;border-bottom:1px solid #ffffff22}}p{{color:#aaaaaa}}a{{color:#ffffff}}</style><h1>Atlas Notes</h1><p>Practice notes protected by AegisDR. These notes are saved in a real database.</p><ul>{rows}</ul><p>Add notes, save backups and try a safe restore in the AegisDR dashboard.</p><a href="/docs">Technical details</a></html>"""
