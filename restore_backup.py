"""Restore an ASTER SQLite backup while ASTER is fully stopped.

Usage:
  python restore_backup.py --list
  python restore_backup.py --verify .data/backups/aster-....sqlite3
  python restore_backup.py --apply .data/backups/aster-....sqlite3
Never expose this operation through a mobile HTTP endpoint.
"""
import argparse
import os
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path

import data_guard
from launch import running_app_url


def restore(source, db_path, data_dir, *, confirm=False, active_check=running_app_url):
    source = Path(source).resolve(strict=True)
    db_path = Path(db_path)
    if active_check():
        raise RuntimeError('ASTERが起動中です。先にPC側でCtrl+Cを押して停止してください。')
    data_guard.validate_database(source)
    if not confirm:
        raise RuntimeError('復元前に --apply を指定し、確認してください。')
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        def connect_current():
            db=sqlite3.connect(db_path)
            db.row_factory=sqlite3.Row
            return db
        data_guard.create_backup(connect_current, data_dir, keep=40)
    with tempfile.TemporaryDirectory(prefix='aster-restore-',dir=data_dir) as tmpdir:
        staged = Path(tmpdir) / 'incoming.sqlite3'
        with closing(sqlite3.connect(source)) as src, closing(sqlite3.connect(staged)) as dst:
            src.backup(dst)
        data_guard.validate_database(staged)
        # Stop another accidental ASTER startup before replacing the file.
        if active_check():
            raise RuntimeError('ASTERが起動したため復元を中止しました。')
        if db_path.exists():
            with closing(sqlite3.connect(db_path, timeout=2)) as old:
                old.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        # Previous database is backed up and incoming database is validated.
        os.replace(staged, db_path)
        for suffix in ('-wal', '-shm'):
            Path(str(db_path)+suffix).unlink(missing_ok=True)
        try: os.chmod(db_path, 0o600)
        except OSError: pass
    return db_path


def main(argv=None):
    parser=argparse.ArgumentParser(description='ASTER offline SQLite backup recovery')
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--list',action='store_true',help='list local backups')
    group.add_argument('--verify',type=Path,help='verify an archive without modifying anything')
    group.add_argument('--apply',type=Path,help='restore backup with explicit confirmation')
    opts=parser.parse_args(argv)
    data=Path(os.environ.get('APP_DATA_DIR',Path(__file__).parent/'.data')).resolve()
    target=data/'assistant.sqlite3'
    if opts.list:
        for item in data_guard.list_backups(data):
            print(item['name'],item['modified'],str(item['size'])+' bytes')
        return 0
    if opts.verify:
        data_guard.validate_database(opts.verify)
        print('整合性チェック成功：',opts.verify)
        return 0
    if running_app_url():
        parser.error('ASTERが起動しています。先に停止してください。')
    data_guard.validate_database(opts.apply)
    print('復元対象:',opts.apply)
    print('現在のデータは復元前に別ファイルへ自動バックアップします。')
    try:
        answer=input('復元する場合は RESTORE と入力してください: ').strip()
    except EOFError:
        return 1
    if answer!='RESTORE':
        print('キャンセルしました。')
        return 1
    restore(opts.apply,target,data,confirm=True)
    print('復元完了。ASTERを起動し、会話と記憶を確認してください。')
    return 0


if __name__=='__main__':
    raise SystemExit(main())
