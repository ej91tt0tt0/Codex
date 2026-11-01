"""ASTER 1.9 local data protection.

SQLite's online backup API takes a consistent snapshot while the server runs.
Backups are local-only, private, validated, and rotated. Restoring is deliberately
an offline operation to avoid replacing a DB used by active server threads.
"""
from __future__ import annotations

import os
import re
import sqlite3
import threading
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

_BACKUP_LOCK = threading.Lock()
_CRITICAL_TABLES = {'settings', 'messages', 'memories', 'live_archives'}
_VALID_NAME = re.compile(r'^aster-(\d{8}T\d{6}Z)-([0-9a-f]{8})\.sqlite3$')


def directory(data_dir):
    return Path(data_dir) / 'backups'


def validate_database(path):
    """Validate both SQLite integrity and basic ASTER database identity."""
    path = Path(path)
    if not path.is_file() or path.stat().st_size < 512:
        raise ValueError('SQLiteバックアップファイルが見つからないか空です。')
    uri = path.resolve().as_uri() + '?mode=ro'
    with closing(sqlite3.connect(uri, uri=True, timeout=5)) as db:
        if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('バックアップの整合性チェックに失敗しました。')
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not _CRITICAL_TABLES.issubset(tables):
            raise ValueError('ASTERのバックアップ形式ではありません。')
    return True


def _backup(connect, destination):
    destination = Path(destination)
    with closing(connect()) as source, closing(sqlite3.connect(destination, timeout=20)) as copy:
        source.backup(copy, pages=1000, sleep=.05)
    validate_database(destination)


def create_backup(connect, data_dir, *, keep=10, now=None):
    """Write-then-verify-then-atomic-rename; never discard the last valid copy."""
    keep = max(2, min(int(keep), 40))
    folder = directory(data_dir)
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    clock = now or datetime.now(timezone.utc)
    stamp = clock.astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    with _BACKUP_LOCK:
        # Avoid collisions even when two manual backups run within a second.
        import secrets
        target = folder / f'aster-{stamp}-{secrets.token_hex(4)}.sqlite3'
        draft = folder / (target.name + '.pending')
        try:
            _backup(connect, draft)
            try: os.chmod(draft, 0o600)
            except OSError: pass
            os.replace(draft, target)
        finally:
            draft.unlink(missing_ok=True)
        candidates = list_backups(data_dir)
        for record in candidates[keep:]:
            (folder / record['name']).unlink(missing_ok=True)
        return {'name': target.name, 'size': target.stat().st_size,
                'created': stamp}


def list_backups(data_dir):
    folder = directory(data_dir)
    if not folder.is_dir():
        return []
    result = []
    for path in folder.iterdir():
        if not path.is_file() or not _VALID_NAME.fullmatch(path.name) or path.is_symlink():
            continue
        stat = path.stat()
        result.append({'name': path.name, 'size': stat.st_size,
                       'modified': datetime.fromtimestamp(stat.st_mtime,timezone.utc).isoformat()})
    return sorted(result, key=lambda x: x['name'], reverse=True)


def due(settings, now=None):
    if settings.get('backup_enabled', 'true') != 'true':
        return False
    try: hours = max(1,min(168,int(settings.get('backup_interval_hours', '24'))))
    except (ValueError,TypeError): hours = 24
    previous = settings.get('backup_last_attempt', '')
    if not previous:
        return True
    try:
        moment = datetime.fromisoformat(previous)
        if moment.tzinfo is None: moment = moment.replace(tzinfo=timezone.utc)
        return (now or datetime.now(timezone.utc)) >= moment + timedelta(hours=hours)
    except ValueError:
        return True


def sweep(connect, data_dir, *, now=None):
    """Called by the existing background scheduler; bounded to one daily attempt."""
    moment = now or datetime.now(timezone.utc)
    with connect() as db:
        settings = dict(db.execute(
            "SELECT key,value FROM settings WHERE key IN "
            "('backup_enabled','backup_keep','backup_interval_hours','backup_last_attempt')"))
        if not due(settings, moment):
            return None
        # Record attempt before IO to avoid retrying every scheduler tick on errors.
        db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES ('backup_last_attempt',?)",
                   (moment.isoformat(),))
    try:
        result = create_backup(connect, data_dir,
                               keep=settings.get('backup_keep','10'), now=moment)
    except (OSError, sqlite3.Error, ValueError) as exc:
        with connect() as db:
            db.execute("INSERT OR REPLACE INTO settings VALUES ('backup_error',?)",
                       (type(exc).__name__,))
        return None
    with connect() as db:
        db.execute("INSERT OR REPLACE INTO settings VALUES ('backup_last_success',?)",
                   (moment.isoformat(),))
        db.execute("INSERT OR REPLACE INTO settings VALUES ('backup_error','')")
    return result
