"""Tariff estimates for confirmed reservations; no payment processing."""
from datetime import date
from database.db import get_db


async def summary(date_from=None, date_to=None, source=None):
    if source not in (None, 'bot', 'miniapp'):
        raise ValueError('Неизвестный источник')
    start = date.fromisoformat(date_from) if date_from else None
    end = date.fromisoformat(date_to) if date_to else None
    if start and end and start > end:
        raise ValueError('Начало периода позже окончания')
    clauses = ["b.status IN ('confirmed','user_confirmed')"]
    params = []
    for value, clause in ((date_from, "date(b.start_at,'+3 hours')>=?"), (date_to, "date(b.start_at,'+3 hours')<=?"), (source, 'b.source=?')):
        if value:
            clauses.append(clause)
            params.append(value)
    connection = await get_db()
    try:
        cursor = await connection.execute('''SELECT date(b.start_at,'+3 hours'), b.quoted_kopecks,
            b.commission_bps, b.duration_minutes,
            (SELECT count(*) FROM booking_items_v2 i WHERE i.booking_id=b.id)
            FROM booking_requests_v2 b WHERE ''' + ' AND '.join(clauses), params)
        rows = await cursor.fetchall()
    finally:
        await connection.close()
    daily = {}
    missing_prices = 0
    for day, quote, bps, minutes, seats in rows:
        bucket = daily.setdefault(day, dict(date=day, turnover_kopecks=0, commission_kopecks=0, club_kopecks=0, booking_count=0, hours=0))
        bucket['booking_count'] += 1
        bucket['hours'] += minutes * seats / 60
        if not quote:
            missing_prices += 1
        commission = quote * bps // 10000
        bucket['turnover_kopecks'] += quote
        bucket['commission_kopecks'] += commission
        bucket['club_kopecks'] += quote - commission
    result = {key: sum(row[key] for row in daily.values()) for key in ('turnover_kopecks', 'commission_kopecks', 'club_kopecks', 'booking_count', 'hours')}
    result.update(daily=[daily[key] for key in sorted(daily)], missing_prices=missing_prices, basis='confirmed_bookings')
    return result
