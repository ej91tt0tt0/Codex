"""ASTER 1.9 API-cost *estimates*, not provider invoices or guaranteed hard caps.

Text cost uses the actual API token counts when provided, multiplied by user
editable indicative rates. Live uses bounded elapsed seconds; the host and
browser can terminate abruptly, so charges can differ from a provider invoice.
A monthly limit blocks new requests; it cannot retroactively prevent charges.
"""
from __future__ import annotations

import re
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

_LOCK = threading.RLock()
_DB_PATH = None
_DEFAULTS = {
    'usage_monthly_limit_usd': '0',
    'usage_warn_percent': '80',
    'usage_text_input_per_million': '0.50',
    'usage_text_output_per_million': '2.00',
    'usage_live_per_minute': '0.05',
}
_ALLOWED = set(_DEFAULTS)
_LIVE_ID = re.compile(r'^live_[A-Za-z0-9_-]{3,125}$')


class BudgetExceeded(Exception):
    pass


def configure(db_path):
    global _DB_PATH
    _DB_PATH = str(db_path) if db_path is not None else None


def init_schema(db):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS usage_events(
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        amount_usd TEXT NOT NULL DEFAULT '0',
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        observed INTEGER NOT NULL DEFAULT 0,
        created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS usage_live_sessions(
        session_id TEXT PRIMARY KEY,
        started TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        measured_seconds REAL NOT NULL DEFAULT 0,
        rate_usd_per_min TEXT NOT NULL DEFAULT '0.05',
        finished INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS usage_events_date ON usage_events(created);
    """)
    for key,value in _DEFAULTS.items():
        db.execute('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)',(key,value))


def _conn():
    if not _DB_PATH:
        return None
    db=sqlite3.connect(_DB_PATH,timeout=5)
    db.row_factory=sqlite3.Row
    return db


def _rates(db):
    cfg=dict(db.execute("SELECT key,value FROM settings WHERE key LIKE 'usage_%'"))
    cfg={**_DEFAULTS, **{key:value for key,value in cfg.items() if key in _ALLOWED}}
    return {key:Decimal(value) for key,value in cfg.items()}


def _current_periods():
    # SQLite timestamps use UTC. Present 'today' and 'month' in Japan time.
    jst=timezone(timedelta(hours=9))
    now=datetime.now(jst)
    month=now.replace(day=1,hour=0,minute=0,second=0,microsecond=0)
    day=now.replace(hour=0,minute=0,second=0,microsecond=0)
    return (month.astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),
            day.astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M:%S'))


def _totals(db):
    month,day=_current_periods()
    r=_rates(db)
    events=db.execute("SELECT amount_usd,created,observed FROM usage_events WHERE created>=?",(month,)).fetchall()
    month_amount=sum((Decimal(x['amount_usd']) for x in events),Decimal('0'))
    today=sum((Decimal(x['amount_usd']) for x in events if x['created']>=day),Decimal('0'))
    unknown=sum(1 for x in events if not x['observed'])
    live=db.execute("SELECT started,measured_seconds,rate_usd_per_min FROM usage_live_sessions WHERE started>=?",(month,)).fetchall()
    live_all=sum((Decimal(str(x['measured_seconds']))*Decimal(x['rate_usd_per_min'])/60 for x in live),Decimal('0'))
    live_today=sum((Decimal(str(x['measured_seconds']))*Decimal(x['rate_usd_per_min'])/60 for x in live if x['started']>=day),Decimal('0'))
    return month_amount+live_all,today+live_today,unknown,len(live)


def status(connect=None):
    with _LOCK:
        if connect:
            db=connect();own=True
        else:
            db=_conn();own=True
        if db is None:
            return {'configured':False}
        try:
            monthly,today,unknown,live_calls=_totals(db)
            cfg=_rates(db)
            cap=cfg['usage_monthly_limit_usd']
            warning=cap>0 and monthly>=cap*cfg['usage_warn_percent']/100
            return {
                'configured':True,'month_usd':float(round(monthly,6)),
                'today_usd':float(round(today,6)),
                'monthly_limit_usd':float(cap),
                'warning':bool(warning),'limit_reached':bool(cap>0 and monthly>=cap),
                'unmetered_requests':unknown,'live_sessions':live_calls,
                'settings':{k:str(v) for k,v in cfg.items()},
                'note':'推定値です。API請求額ではありません。未計測・音声遅延・委任先の料金は含まれない場合があります。',
            }
        finally: db.close()


def check_budget(projected_usd='0'):
    if not _DB_PATH:return
    with _LOCK:
        with _conn() as db:
            used,_,_,_=_totals(db)
            cap=_rates(db)['usage_monthly_limit_usd']
            expected=Decimal(str(projected_usd))
            if cap>0 and used+expected>=cap:
                raise BudgetExceeded('ASTERの設定した月間概算予算に達したため新しいAPI呼び出しを停止しました。'
                                     'OpenAI側の請求制限ではありません。料金設定から変更できます。')


def change_settings(connect, update):
    if not isinstance(update,dict) or not update or any(x not in _ALLOWED for x in update):
        raise ValueError('料金設定が不正です。')
    values={}
    for key,value in update.items():
        try: num=Decimal(str(value))
        except (InvalidOperation,TypeError): raise ValueError('料金には数値を指定してください。') from None
        if not num.is_finite() or num<0 or num>100000:
            raise ValueError('料金の指定値が範囲外です。')
        if key=='usage_warn_percent' and not 1<=num<=100:
            raise ValueError('警告割合は1〜100です。')
        values[key]=str(num)
    with _LOCK,connect() as db:
        for k,v in values.items():
            db.execute('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)',(k,v))


def add_text_usage(kind,usage):
    """Call only after an API request returns; unknown usage is flagged."""
    if not _DB_PATH:return
    usage=usage if isinstance(usage,dict) else {}
    def valid_int(*names):
        for name in names:
            if isinstance(usage.get(name),int) and 0<=usage[name]<=100000000:
                return usage[name]
        return 0
    input_tokens=valid_int('input_tokens','prompt_tokens')
    output_tokens=valid_int('output_tokens','completion_tokens')
    seen=bool(input_tokens or output_tokens)
    with _LOCK, _conn() as db:
        cfg=_rates(db)
        cost=(Decimal(input_tokens)*cfg['usage_text_input_per_million']+
              Decimal(output_tokens)*cfg['usage_text_output_per_million'])/1000000
        db.execute(
            'INSERT INTO usage_events(kind,amount_usd,input_tokens,output_tokens,observed) '
            'VALUES (?,?,?,?,?)',
            (str(kind)[:35],str(cost),input_tokens,output_tokens,int(seen)))


def start_live(session_id):
    if not _LIVE_ID.fullmatch(str(session_id)):
        raise ValueError('Live session ID invalid')
    if not _DB_PATH:return
    with _LOCK, _conn() as db:
        rate=str(_rates(db)['usage_live_per_minute'])
        db.execute("INSERT OR IGNORE INTO usage_live_sessions(session_id,rate_usd_per_min) VALUES (?,?)",
                   (session_id,rate))


def update_live(session_id,seconds,finished=False):
    if not _LIVE_ID.fullmatch(str(session_id)):
        raise ValueError('Live session ID invalid')
    try: amount=float(seconds)
    except (ValueError,TypeError): raise ValueError('Live duration invalid') from None
    if not 0<=amount<=86400:
        raise ValueError('Live duration out of range')
    if not _DB_PATH:return status()
    with _LOCK, _conn() as db:
        row=db.execute(
            "SELECT measured_seconds,finished FROM usage_live_sessions WHERE session_id=?",
            (session_id,)).fetchone()
        if not row:raise ValueError('Live session unknown')
        if not row['finished']:
            db.execute("UPDATE usage_live_sessions SET measured_seconds=max(measured_seconds,?),"
                       "finished=? WHERE session_id=?",(amount,int(finished),session_id))
    return status()


def minimum_live_cost(connect):
    with connect() as db:
        return str(_rates(db)['usage_live_per_minute'])
