import aiosqlite
import random
import logging

from config import DB_NAME
logger = logging.getLogger(__name__)

async def get_db():
    db = await aiosqlite.connect(DB_NAME, timeout=30, isolation_level=None)
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA synchronous=NORMAL")
    await db.execute("PRAGMA foreign_keys=ON")
    await db.execute("PRAGMA busy_timeout=30000")
    await db.execute("PRAGMA temp_store=MEMORY")
    return db

async def init_db():
    db = await get_db()

    # Таблицы
    await db.execute('''
        CREATE TABLE IF NOT EXISTS pilots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER UNIQUE,
            username TEXT,
            phone TEXT,
            display_name TEXT,
            pilot_number INTEGER,
            rating INTEGER DEFAULT 0,
            hours_driven REAL DEFAULT 0,
            visits_count INTEGER DEFAULT 0,
            yclients_client_id INTEGER,
            bonus_mobile_minutes INTEGER DEFAULT 0,
            bonus_static_minutes INTEGER DEFAULT 0,
            experience_minutes INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    await db.execute('''
        CREATE TABLE IF NOT EXISTS disciplines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE
        )
    ''')
    await db.execute('''
        CREATE TABLE IF NOT EXISTS laps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discipline_id INTEGER,
            username TEXT,
            telegram_id INTEGER,
            track TEXT,
            lap_time_text TEXT,
            lap_time_ms INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    await db.execute('''
        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discipline_id INTEGER,
            name TEXT,
            UNIQUE(discipline_id, name)
        )
    ''')
    await db.execute("""
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pilot_telegram_id INTEGER,
            phone TEXT,
            yclients_record_id TEXT UNIQUE,
            service_name TEXT,
            staff_name TEXT,
            booking_time TEXT,
            duration_minutes INTEGER,
            notified INTEGER DEFAULT 0,
            completed INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS season_awards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            season_key TEXT NOT NULL,
            telegram_id INTEGER NOT NULL,
            place INTEGER,
            bonus_hours INTEGER DEFAULT 0,
            rating_delta INTEGER DEFAULT 0,
            reason TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(season_key, telegram_id, reason)
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS time_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            pilot_number INTEGER,
            discipline TEXT NOT NULL,
            track TEXT NOT NULL,
            lap_time_text TEXT NOT NULL,
            lap_time_ms INTEGER NOT NULL,
            photo_file_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            admin_id INTEGER,
            lap_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            decided_at TIMESTAMP
        )
    """)

    await db.execute("""
        CREATE TABLE IF NOT EXISTS class_benchmarks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            class_name TEXT NOT NULL,
            month_key TEXT NOT NULL,
            track TEXT,
            benchmark_ms INTEGER NOT NULL,
            set_by_admin_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(class_name, month_key)
        )
    """)

    await db.execute("""
        CREATE TABLE IF NOT EXISTS pilot_class_status (
            telegram_id INTEGER PRIMARY KEY,
            current_class TEXT NOT NULL DEFAULT 'MX-5',
            promoted_at TIMESTAMP,
            promoted_month_key TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    await db.execute("""
        CREATE TABLE IF NOT EXISTS pilot_achievements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER NOT NULL,
            achievement_code TEXT NOT NULL,
            unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(telegram_id, achievement_code)
        )
    """)

    await db.execute("""
        CREATE TABLE IF NOT EXISTS bot_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)

    await db.execute("""
        CREATE TABLE IF NOT EXISTS support_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER NOT NULL,
            username TEXT,
            message_text TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            admin_id INTEGER,
            reply_text TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            answered_at TIMESTAMP
        )
    """)

    # Состояние уведомлений об общем зачёте. Ключевое поле — notified_place:
    # это место, о котором пилоту РЕАЛЬНО сообщили, а не то, которое он занимал
    # секунду назад. Сравнение идёт именно с ним, поэтому цепочка 2→3→2 внутри
    # одного вечера не порождает ни одного сообщения: пилот вернулся туда, где
    # был по его же данным.
    #
    # pending_* — состояние, ожидающее отправки (дебаунс). Админ обычно
    # разбирает несколько заявок подряд, и без паузы каждая заявка рассылала бы
    # свою волну уведомлений.
    await db.execute("""
        CREATE TABLE IF NOT EXISTS standings_notify_state (
            telegram_id INTEGER PRIMARY KEY,
            month_key TEXT NOT NULL,
            notified_place INTEGER,
            notified_total REAL,
            notified_at TEXT,
            pending_place INTEGER,
            pending_total REAL,
            pending_rival TEXT,
            pending_since TEXT,
            sent_day TEXT,
            sent_today INTEGER NOT NULL DEFAULT 0
        )
    """)

    await db.execute("""
        CREATE INDEX IF NOT EXISTS idx_standings_pending
        ON standings_notify_state(pending_since)
    """)

    # Индексы по laps. Все горячие запросы турнира фильтруют круги по пилоту,
    # дисциплине и дате — без индексов каждый из них шёл полным сканом таблицы,
    # а на один рендер ТВ-табло таких запросов уходили сотни.
    await db.execute("""
        CREATE INDEX IF NOT EXISTS idx_laps_pilot_disc_time
        ON laps(telegram_id, discipline_id, created_at)
    """)
    await db.execute("""
        CREATE INDEX IF NOT EXISTS idx_laps_disc_time
        ON laps(discipline_id, created_at)
    """)
    await db.execute("""
        CREATE INDEX IF NOT EXISTS idx_laps_created_at
        ON laps(created_at)
    """)
    await db.execute("""
        CREATE INDEX IF NOT EXISTS idx_laps_disc_track_time
        ON laps(discipline_id, track, lap_time_ms)
    """)

    await db.execute("""
        CREATE INDEX IF NOT EXISTS idx_time_requests_user_status
        ON time_requests(telegram_id, status)
    """)

    await db.execute("""
        CREATE INDEX IF NOT EXISTS idx_time_requests_created_at
        ON time_requests(created_at)
    """)
    await db.commit()

    # Заполняем дисциплины и трассы из constants.py
    from data.constants import DISCIPLINES, TRACKS
    for discipline in DISCIPLINES:
        await db.execute('INSERT OR IGNORE INTO disciplines(name) VALUES(?)', (discipline,))
    await db.commit()

    for discipline, track_list in TRACKS.items():
        cursor = await db.execute('SELECT id FROM disciplines WHERE name = ?', (discipline,))
        row = await cursor.fetchone()
        if row:
            disc_id = row[0]
            for track_name in track_list:
                await db.execute(
                    'INSERT OR IGNORE INTO tracks(discipline_id, name) VALUES(?, ?)',
                    (disc_id, track_name)
                )
    await db.commit()

    # Миграция – добавляем колонки, если их нет
    cursor = await db.execute("PRAGMA table_info(pilots)")
    columns = [row[1] for row in await cursor.fetchall()]

    async def safe_add(col_sql, col_name):
        if col_name not in columns:
            try:
                await db.execute(f"ALTER TABLE pilots ADD COLUMN {col_sql}")
            except Exception as e:
                logger.warning(f"Не удалось добавить колонку {col_name}: {e}")

    await safe_add("display_name TEXT", "display_name")
    await safe_add("pilot_number INTEGER", "pilot_number")
    await safe_add("rating INTEGER DEFAULT 0", "rating")
    await safe_add("hours_driven REAL DEFAULT 0", "hours_driven")
    await safe_add("visits_count INTEGER DEFAULT 0", "visits_count")
    await safe_add("yclients_client_id INTEGER", "yclients_client_id")
    await safe_add("bonus_mobile_minutes INTEGER DEFAULT 0", "bonus_mobile_minutes")
    await safe_add("bonus_static_minutes INTEGER DEFAULT 0", "bonus_static_minutes")
    await safe_add("experience_minutes INTEGER DEFAULT 0", "experience_minutes")
    await safe_add("menu_version INTEGER DEFAULT 0", "menu_version")
    # Персональный выключатель уведомлений о движении в общем зачёте. Лучше дать
    # человеку отключить один тип сообщений, чем получить mute бота целиком.
    await safe_add("notify_standings INTEGER DEFAULT 1", "notify_standings")

    async def safe_add_to_table(table_name: str, col_sql: str, col_name: str):
        cursor = await db.execute(f"PRAGMA table_info({table_name})")
        table_columns = [row[1] for row in await cursor.fetchall()]
        if col_name not in table_columns:
            try:
                await db.execute(f"ALTER TABLE {table_name} ADD COLUMN {col_sql}")
            except Exception as e:
                logger.warning(f"Не удалось добавить колонку {table_name}.{col_name}: {e}")

    # Миграции сезонных начислений: только добавляют поля, старые данные не трогают.
    await safe_add_to_table("season_awards", "yclients_bonus_rub REAL DEFAULT 0", "yclients_bonus_rub")
    await safe_add_to_table("season_awards", "yclients_status TEXT DEFAULT 'not_required'", "yclients_status")
    await safe_add_to_table("season_awards", "yclients_error TEXT", "yclients_error")
    await safe_add_to_table("season_awards", "yclients_card_id TEXT", "yclients_card_id")


    await db.execute("""
        CREATE TABLE IF NOT EXISTS bonus_wallet (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER NOT NULL,
            yclients_client_id INTEGER,
            source TEXT NOT NULL,
            amount REAL NOT NULL,
            spent REAL DEFAULT 0,
            remaining REAL NOT NULL,
            expires_at TEXT,
            expired_at TEXT,
            yclients_status TEXT DEFAULT 'pending',
            yclients_operation_id INTEGER,
            reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS pending_yclients_operations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER,
            yclients_client_id INTEGER,
            operation_type TEXT NOT NULL,
            amount REAL DEFAULT 0,
            title TEXT,
            source TEXT,
            status TEXT DEFAULT 'pending',
            attempts INTEGER DEFAULT 0,
            last_error TEXT,
            yclients_card_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS yclients_sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER,
            phone TEXT,
            yclients_client_id INTEGER,
            status TEXT NOT NULL,
            message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    await db.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    await db.execute("INSERT OR IGNORE INTO schema_migrations(name) VALUES(?)", ("2026_05_safe_production_schema",))

    await db.commit()

    # Уникальные индексы
    try:
        await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_pilots_phone ON pilots(phone)")
    except Exception as e:
        logger.warning(f"Индекс phone не создан: {e}")
    try:
        await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_pilots_username ON pilots(username)")
    except Exception as e:
        logger.warning(f"Индекс username не создан: {e}")
    try:
        await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_pilots_pilot_number ON pilots(pilot_number)")
    except Exception as e:
        logger.warning(f"Индекс pilot_number не создан: {e}")
    try:
        await db.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_pilots_display_name ON pilots(display_name) WHERE display_name IS NOT NULL"
    )
    except Exception as e:
        logger.warning(f"Индекс display_name не создан: {e}")

    await db.commit()
    await db.close()

# --- Pilots CRUD ---
async def create_pilot(telegram_id, username, phone, yclients_client_id=None):
    db = await get_db()
    try:
        # Проверка уникальности телефона
        cursor = await db.execute("SELECT telegram_id FROM pilots WHERE phone = ?", (phone,))
        if await cursor.fetchone():
            return False, "phone_exists"

        # Проверка уникальности username
        if username:
            cursor = await db.execute("SELECT telegram_id FROM pilots WHERE username = ?", (username,))
            if await cursor.fetchone():
                return False, "username_exists"

        # Генерация уникального пилотского номера
        pilot_number = None
        for _ in range(100):
            candidate = random.randint(1, 999)
            cursor = await db.execute("SELECT telegram_id FROM pilots WHERE pilot_number = ?", (candidate,))
            if not await cursor.fetchone():
                pilot_number = candidate
                break
        if pilot_number is None:
            return False, "no_number"

        cursor = await db.execute(
            '''INSERT OR IGNORE INTO pilots (telegram_id, username, phone, pilot_number, yclients_client_id)
               VALUES (?, ?, ?, ?, ?)''',
            (telegram_id, username, phone, pilot_number, yclients_client_id)
        )
        await db.commit()

        # INSERT OR IGNORE молча ничего не делает при конфликте уникальных индексов
        # (например, параллельная регистрация с тем же telegram_id/телефоном/номером).
        # Без этой проверки функция вернула бы "успех", хотя строка не была создана.
        if cursor.rowcount != 1:
            return False, "conflict"

        return True, pilot_number
    finally:
        await db.close()

async def get_pilot(telegram_id):
    db = await get_db()
    cursor = await db.execute('SELECT * FROM pilots WHERE telegram_id = ?', (telegram_id,))
    row = await cursor.fetchone()
    await cursor.close()
    await db.close()
    return row

async def get_pilot_by_username(username):
    db = await get_db()
    cursor = await db.execute('SELECT * FROM pilots WHERE username = ?', (username,))
    row = await cursor.fetchone()
    await cursor.close()
    await db.close()
    return row

async def get_pilot_by_telegram_id(telegram_id):
    db = await get_db()
    cursor = await db.execute(
        '''SELECT telegram_id, username, phone, rating, pilot_number,
                  display_name, hours_driven, visits_count,
                  yclients_client_id, bonus_mobile_minutes, bonus_static_minutes
           FROM pilots WHERE telegram_id = ?''',
        (telegram_id,)
    )
    row = await cursor.fetchone()
    await cursor.close()
    await db.close()
    if not row:
        return None
    return {
        "telegram_id": row[0],
        "username": row[1],
        "phone": row[2],
        "rating": row[3],
        "pilot_number": row[4],
        "display_name": row[5],
        "hours_driven": row[6],
        "visits_count": row[7],
        "yclients_client_id": row[8],         # ← ВОТ ОНО
        "bonus_mobile_minutes": row[9],
        "bonus_static_minutes": row[10]
    }

async def get_pilot_by_number(number):
    db = await get_db()
    cursor = await db.execute(
        '''SELECT telegram_id, username, phone, rating, pilot_number,
                  display_name, hours_driven, visits_count,
                  yclients_client_id, bonus_mobile_minutes, bonus_static_minutes
           FROM pilots WHERE pilot_number = ?''',
        (number,)
    )
    row = await cursor.fetchone()
    await cursor.close()
    await db.close()
    if not row:
        return None
    return {
        "telegram_id": row[0],
        "username": row[1],
        "phone": row[2],
        "rating": row[3],
        "pilot_number": row[4],
        "display_name": row[5],
        "hours_driven": row[6],
        "visits_count": row[7],
        "yclients_client_id": row[8],         # ← ВОТ ОНО
        "bonus_mobile_minutes": row[9],
        "bonus_static_minutes": row[10]
    }

async def get_all_pilots():
    db = await get_db()
    cursor = await db.execute(
        '''SELECT telegram_id, username, phone, rating, pilot_number, display_name
           FROM pilots ORDER BY rating DESC'''
    )
    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()
    return [
        {
            "telegram_id": r[0], "username": r[1], "phone": r[2],
            "rating": r[3], "pilot_number": r[4], "display_name": r[5]
        } for r in rows
    ]

async def update_pilot_rating(telegram_id, amount):
    db = await get_db()
    await db.execute('UPDATE pilots SET rating = rating + ? WHERE telegram_id = ?', (amount, telegram_id))
    await db.commit()
    await db.close()

async def update_pilot_number(telegram_id, number):
    """Возвращает True, если номер пилота изменён.

    Может выбросить sqlite3.IntegrityError, если номер заняли параллельно
    между проверкой на уровне хендлера и этим UPDATE — вызывающий код должен
    обработать это как "номер уже занят".
    """
    db = await get_db()
    try:
        cursor = await db.execute('UPDATE pilots SET pilot_number = ? WHERE telegram_id = ?', (number, telegram_id))
        await db.commit()
        return cursor.rowcount == 1
    finally:
        await db.close()

async def update_display_name(telegram_id, new_display_name):
    """Возвращает True, если ник обновлён, иначе False (если ник занят).

    Может выбросить sqlite3.IntegrityError, если такой же ник заняли параллельно
    между проверкой ниже и этим UPDATE (уникальный индекс idx_pilots_display_name) —
    вызывающий код должен обработать это как "ник уже занят".
    """
    db = await get_db()
    try:
        # Проверяем, не занято ли такое же имя другим пилотом (игнорируя себя)
        cursor = await db.execute(
            "SELECT telegram_id FROM pilots WHERE display_name = ? AND telegram_id != ?",
            (new_display_name, telegram_id)
        )
        if await cursor.fetchone():
            return False
        await db.execute(
            "UPDATE pilots SET display_name = ? WHERE telegram_id = ?",
            (new_display_name, telegram_id)
        )
        await db.commit()
        return True
    finally:
        await db.close()

async def sync_pilot_menu_version(telegram_id: int, target_version: int) -> bool:
    """Обновляет сохранённую версию reply-меню пилота, если она отстала от текущей.

    Возвращает True, если версия была обновлена — значит, пилоту нужно один раз
    показать обновлённую клавиатуру. Хранится в БД (а не в FSM-состоянии),
    потому что FSM-состояние регулярно очищается state.clear() внутри обычных сценариев.
    """
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT menu_version FROM pilots WHERE telegram_id = ?", (telegram_id,)
        )
        row = await cursor.fetchone()
        if row is None:
            return False
        current = row[0] or 0
        if current == target_version:
            return False
        await db.execute(
            "UPDATE pilots SET menu_version = ? WHERE telegram_id = ?",
            (target_version, telegram_id),
        )
        await db.commit()
        return True
    finally:
        await db.close()


async def update_pilot_bonus(telegram_id, platform, minutes_delta):
    field = "bonus_mobile_minutes" if platform == "mobile" else "bonus_static_minutes"
    db = await get_db()
    await db.execute(
        f'UPDATE pilots SET {field} = {field} + ? WHERE telegram_id = ?',
        (minutes_delta, telegram_id)
    )
    await db.commit()
    await db.close()

# --- Disciplines ---
async def create_discipline(name):
    db = await get_db()
    await db.execute('INSERT OR IGNORE INTO disciplines(name) VALUES(?)', (name,))
    await db.commit()
    await db.close()

async def get_discipline_id(name):
    db = await get_db()
    cursor = await db.execute('SELECT id FROM disciplines WHERE name = ?', (name,))
    row = await cursor.fetchone()
    await cursor.close()
    await db.close()
    return row[0] if row else None

# --- Laps ---
async def add_lap(discipline, username, telegram_id, track, lap_time_text, lap_time_ms):
    await create_discipline(discipline)
    disc_id = await get_discipline_id(discipline)
    db = await get_db()
    cursor = await db.execute(
        '''INSERT INTO laps(discipline_id, username, telegram_id, track, lap_time_text, lap_time_ms)
           VALUES (?, ?, ?, ?, ?, ?)''',
        (disc_id, username, telegram_id, track, lap_time_text, lap_time_ms)
    )
    lap_id = cursor.lastrowid
    await db.commit()
    await db.close()
    return lap_id

async def delete_lap(lap_id: int):
    db = await get_db()
    await db.execute('DELETE FROM laps WHERE id = ?', (lap_id,))
    await db.commit()
    await db.close()


async def get_disciplines_with_current_results():
    """Возвращает дисциплины, у которых есть хотя бы один результат.

    current_track — трасса последнего добавленного круга в дисциплине.
    Это совпадает с логикой текущей таблицы/API: как только на новой трассе
    появляется первый круг, она становится актуальной.
    """
    db = await get_db()
    cursor = await db.execute(
        """
        SELECT
            d.id,
            d.name,
            (
                SELECT l.track
                FROM laps l
                WHERE l.discipline_id = d.id
                  AND NULLIF(TRIM(l.track), '') IS NOT NULL
                ORDER BY datetime(l.created_at) DESC, l.id DESC
                LIMIT 1
            ) AS current_track
        FROM disciplines d
        WHERE EXISTS (
            SELECT 1 FROM laps l WHERE l.discipline_id = d.id
        )
        ORDER BY d.name COLLATE NOCASE
        """
    )
    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()
    return [
        {"id": row[0], "name": row[1], "current_track": row[2]}
        for row in rows
        if row[2]
    ]


async def get_current_discipline_results(discipline_id: int):
    """Возвращает ВСЕ места актуальной таблицы выбранной дисциплины.

    Для каждого пилота берётся его лучший круг только на актуальной трассе.
    В каждой строке есть настоящий lap_id, поэтому удаление выполняется
    по конкретной записи, а не по изменчивому номеру места.
    """
    db = await get_db()

    track_cursor = await db.execute(
        """
        SELECT track
        FROM laps
        WHERE discipline_id = ?
          AND NULLIF(TRIM(track), '') IS NOT NULL
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 1
        """,
        (discipline_id,)
    )
    track_row = await track_cursor.fetchone()
    await track_cursor.close()

    if not track_row:
        await db.close()
        return []

    current_track = track_row[0]

    cursor = await db.execute(
        """
        WITH ranked_attempts AS (
            SELECT
                l.id AS lap_id,
                l.discipline_id,
                l.username,
                l.telegram_id,
                l.track,
                l.lap_time_text,
                l.lap_time_ms,
                l.created_at,
                ROW_NUMBER() OVER (
                    PARTITION BY COALESCE(
                        CAST(l.telegram_id AS TEXT),
                        NULLIF(TRIM(l.username), ''),
                        CAST(l.id AS TEXT)
                    )
                    ORDER BY l.lap_time_ms ASC, l.id ASC
                ) AS attempt_rank
            FROM laps l
            WHERE l.discipline_id = ?
              AND l.track = ?
              AND l.lap_time_ms IS NOT NULL
              AND l.lap_time_ms > 0
        )
        SELECT
            r.lap_id,
            r.username,
            r.telegram_id,
            r.track,
            r.lap_time_text,
            r.lap_time_ms,
            COALESCE(NULLIF(TRIM(p.display_name), ''),
                     NULLIF(TRIM(p.username), ''),
                     NULLIF(TRIM(r.username), ''),
                     'Пилот') AS display_name,
            p.pilot_number,
            d.name AS discipline
        FROM ranked_attempts r
        JOIN disciplines d ON d.id = r.discipline_id
        LEFT JOIN pilots p ON p.telegram_id = r.telegram_id
        WHERE r.attempt_rank = 1
        ORDER BY r.lap_time_ms ASC, r.lap_id ASC
        """,
        (discipline_id, current_track)
    )
    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()

    return [
        {
            "place": index,
            "lap_id": row[0],
            "username": row[1],
            "telegram_id": row[2],
            "track": row[3],
            "lap_time_text": row[4],
            "lap_time_ms": row[5],
            "display_name": row[6],
            "pilot_number": row[7],
            "discipline": row[8],
        }
        for index, row in enumerate(rows, start=1)
    ]


async def get_current_ranked_lap(lap_id: int):
    """Находит lap_id в текущей таблице и возвращает строку с актуальным местом.

    Если таблица успела измениться или выбранный круг больше не является лучшим
    кругом пилота, возвращает None — это защищает от удаления не той записи.
    """
    db = await get_db()
    cursor = await db.execute(
        "SELECT discipline_id FROM laps WHERE id = ?",
        (lap_id,)
    )
    row = await cursor.fetchone()
    await cursor.close()
    await db.close()

    if not row:
        return None

    results = await get_current_discipline_results(row[0])
    return next((item for item in results if item["lap_id"] == lap_id), None)

# --- Top‑3 and Stats ---
async def get_top3():
    db = await get_db()
    cursor = await db.execute('''
        SELECT d.name, l.username, l.track, l.lap_time_ms, l.lap_time_text
        FROM (
            SELECT *,
                ROW_NUMBER() OVER (
                    PARTITION BY discipline_id, username
                    ORDER BY lap_time_ms ASC
                ) AS rn
            FROM laps
        ) l
        JOIN disciplines d ON d.id = l.discipline_id
        WHERE l.rn = 1
        ORDER BY d.name, l.lap_time_ms ASC
    ''')
    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()

    result = {}
    for discipline, username, track, lap_ms, lap_text in rows:
        result.setdefault(discipline, [])
        if len(result[discipline]) < 3:
            result[discipline].append({
                "username": username, "track": track,
                "lap_ms": lap_ms, "lap_text": lap_text
            })
    return result

async def get_pilot_stats(username):
    all_top3 = await get_top3()
    gold = silver = bronze = rating = 0
    for discipline, rows in all_top3.items():
        for idx, row in enumerate(rows):
            if row["username"] != username:
                continue
            if idx == 0:
                gold += 1; rating += 20
            elif idx == 1:
                silver += 1; rating += 15
            elif idx == 2:
                bronze += 1; rating += 10
    records_count = gold + silver + bronze
    return {
        "records": records_count,
        "gold": gold,
        "silver": silver,
        "bronze": bronze,
        "rating": rating
    }


async def get_pilot_history_stats(telegram_id: int, username: str | None = None):
    """Возвращает историю пилота по всем сохранённым результатам.

    Основная привязка выполняется по telegram_id. Username используется только
    для старых кругов, в которых telegram_id отсутствует.
    """
    username_norm = str(username or "").strip().lower()
    db = await get_db()

    cursor = await db.execute(
        """
        SELECT
            l.id,
            d.name AS discipline,
            l.track,
            l.lap_time_text,
            l.lap_time_ms,
            l.created_at
        FROM laps l
        JOIN disciplines d ON d.id = l.discipline_id
        WHERE l.telegram_id = ?
           OR (
                (l.telegram_id IS NULL OR l.telegram_id = 0)
                AND ? != ''
                AND LOWER(TRIM(COALESCE(l.username, ''))) = ?
           )
        ORDER BY datetime(l.created_at) ASC, l.id ASC
        """,
        (telegram_id, username_norm, username_norm),
    )
    rows = await cursor.fetchall()
    await cursor.close()

    # Для каждой дисциплины берём лучший результат каждого пилота,
    # затем определяем итоговое место этого пилота.
    cursor = await db.execute(
        """
        WITH best_results AS (
            SELECT
                discipline_id,
                CASE
                    WHEN telegram_id IS NOT NULL AND telegram_id != 0
                        THEN 't:' || CAST(telegram_id AS TEXT)
                    ELSE 'u:' || LOWER(TRIM(COALESCE(username, '')))
                END AS pilot_key,
                MIN(lap_time_ms) AS best_ms
            FROM laps
            WHERE lap_time_ms IS NOT NULL
              AND lap_time_ms > 0
            GROUP BY discipline_id, pilot_key
        ),
        ranked AS (
            SELECT
                discipline_id,
                pilot_key,
                best_ms,
                ROW_NUMBER() OVER (
                    PARTITION BY discipline_id
                    ORDER BY best_ms ASC, pilot_key ASC
                ) AS place
            FROM best_results
        )
        SELECT place
        FROM ranked
        WHERE pilot_key = ?
           OR (? != '' AND pilot_key = ?)
        """,
        (f"t:{telegram_id}", username_norm, f"u:{username_norm}"),
    )
    places = [int(row[0]) for row in await cursor.fetchall()]
    await cursor.close()
    await db.close()

    discipline_counts: dict[str, int] = {}
    track_counts: dict[str, int] = {}

    for row in rows:
        discipline = str(row[1] or "").strip()
        track = str(row[2] or "").strip()

        if discipline:
            discipline_counts[discipline] = discipline_counts.get(discipline, 0) + 1
        if track:
            track_counts[track] = track_counts.get(track, 0) + 1

    favorite_discipline = max(
        discipline_counts,
        key=lambda name: (discipline_counts[name], name.lower()),
        default=None,
    )
    favorite_track = max(
        track_counts,
        key=lambda name: (track_counts[name], name.lower()),
        default=None,
    )

    last_result = None
    if rows:
        latest = rows[-1]
        last_result = {
            "discipline": latest[1],
            "track": latest[2],
            "lap_time_text": latest[3],
            "lap_time_ms": latest[4],
            "created_at": latest[5],
        }

    return {
        "total_results": len(rows),
        "disciplines_count": len(discipline_counts),
        "favorite_discipline": favorite_discipline,
        "favorite_discipline_count": (
            discipline_counts.get(favorite_discipline, 0)
            if favorite_discipline else 0
        ),
        "favorite_track": favorite_track,
        "favorite_track_count": (
            track_counts.get(favorite_track, 0)
            if favorite_track else 0
        ),
        "first_result_at": rows[0][5] if rows else None,
        "last_result": last_result,
        "gold": sum(1 for place in places if place == 1),
        "silver": sum(1 for place in places if place == 2),
        "bronze": sum(1 for place in places if place == 3),
        "podiums": sum(1 for place in places if place in (1, 2, 3)),
    }


async def get_season_participant_ids():
    """Возвращает telegram_id пилотов, у которых есть хотя бы один круг в текущем сезоне."""
    db = await get_db()
    cursor = await db.execute(
        """SELECT DISTINCT telegram_id FROM laps WHERE telegram_id IS NOT NULL"""
    )
    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()
    return [r[0] for r in rows if r[0] is not None]

async def has_season_award(season_key, telegram_id, reason):
    db = await get_db()
    cursor = await db.execute(
        """SELECT 1 FROM season_awards WHERE season_key = ? AND telegram_id = ? AND reason = ? LIMIT 1""",
        (season_key, telegram_id, reason)
    )
    row = await cursor.fetchone()
    await cursor.close()
    await db.close()
    return row is not None


async def has_award_for_month(month_key, telegram_id, reason):
    """Выдавалась ли пилоту награда за этот КАЛЕНДАРНЫЙ месяц любым закрытием.

    Нужна из-за смены схемы закрытия сезона. Раньше закрытие шло 20-го числа и
    season_key выглядел как "2026-08-20-18"; теперь закрытие идёт 1-го числа за
    предыдущий полный месяц и season_key равен просто "2026-08". Если бы мы
    проверяли только новый ключ, месяц, уже закрытый по старой схеме, был бы
    награждён второй раз. Проверка по префиксу месяца ловит оба формата.

    LIKE с явным ESCAPE: month_key приходит из strftime и служебных символов
    содержать не может, но подстановка в шаблон без экранирования — плохая
    привычка, которая однажды выстрелит.
    """
    db = await get_db()
    cursor = await db.execute(
        """SELECT 1 FROM season_awards
           WHERE telegram_id = ? AND reason = ?
             AND season_key LIKE ? ESCAPE '\\'
           LIMIT 1""",
        (telegram_id, reason, f"{month_key}%")
    )
    row = await cursor.fetchone()
    await cursor.close()
    await db.close()
    return row is not None


async def get_season_award(season_key, telegram_id, reason):
    db = await get_db()
    cursor = await db.execute(
        """SELECT bonus_hours, rating_delta, yclients_bonus_rub, yclients_status
           FROM season_awards WHERE season_key = ? AND telegram_id = ? AND reason = ? LIMIT 1""",
        (season_key, telegram_id, reason)
    )
    row = await cursor.fetchone()
    await cursor.close()
    await db.close()
    if not row:
        return None
    return {
        "bonus_hours": row[0],
        "rating_delta": row[1],
        "yclients_bonus_rub": row[2],
        "yclients_status": row[3],
    }


async def claim_season_award(
    season_key, telegram_id, place, bonus_hours, rating_delta, reason,
    yclients_bonus_rub=0, wallet_entry=None, yclients_status="pending",
):
    """Атомарно резервирует сезонную награду и применяет её локальные последствия
    (рейтинг, запись в бонусный кошелёк) одной транзакцией.

    Если процесс упадёт до COMMIT — ничего не применится, и при следующем запуске
    награда обработается заново с нуля. Если COMMIT прошёл — рейтинг и кошелёк
    гарантированно применены вместе, а не по отдельности, поэтому промежуточного
    состояния "начислили рейтинг, но забыли про деньги" быть не может.

    wallet_entry (если передан) — dict с ключами yclients_client_id, amount,
    expires_at, reason для записи в bonus_wallet.

    Возвращает True, если награда наша (только что застолблена и применена).
    False — награда уже была выдана раньше другим запуском (гонка/повторный запуск).
    """
    db = await get_db()
    try:
        await db.execute("BEGIN IMMEDIATE")
        cursor = await db.execute(
            """INSERT OR IGNORE INTO season_awards
               (season_key, telegram_id, place, bonus_hours, rating_delta, reason,
                yclients_bonus_rub, yclients_status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (season_key, telegram_id, place, bonus_hours, rating_delta, reason, yclients_bonus_rub, yclients_status)
        )
        if cursor.rowcount != 1:
            await db.rollback()
            return False

        if rating_delta:
            await db.execute(
                "UPDATE pilots SET rating = rating + ? WHERE telegram_id = ?",
                (rating_delta, telegram_id)
            )

        if wallet_entry:
            amount = round(float(wallet_entry.get("amount") or 0), 2)
            await db.execute(
                """INSERT INTO bonus_wallet
                   (telegram_id, yclients_client_id, source, amount, spent, remaining,
                    expires_at, reason, yclients_status)
                   VALUES (?, ?, 'season_award', ?, 0, ?, ?, ?, 'pending')""",
                (
                    telegram_id,
                    wallet_entry.get("yclients_client_id"),
                    amount,
                    amount,
                    wallet_entry.get("expires_at"),
                    wallet_entry.get("reason"),
                )
            )

        await db.commit()
        return True
    except Exception:
        await db.rollback()
        raise
    finally:
        await db.close()

async def mark_season_award(
    season_key, telegram_id, place, bonus_hours, rating_delta, reason,
    yclients_bonus_rub=0, yclients_status="not_required", yclients_error=None, yclients_card_id=None
):
    db = await get_db()
    await db.execute(
        """INSERT OR IGNORE INTO season_awards
           (season_key, telegram_id, place, bonus_hours, rating_delta, reason,
            yclients_bonus_rub, yclients_status, yclients_error, yclients_card_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (season_key, telegram_id, place, bonus_hours, rating_delta, reason,
         yclients_bonus_rub, yclients_status, yclients_error, yclients_card_id)
    )
    await db.commit()
    await db.close()


async def update_season_award_yclients(season_key, telegram_id, reason, status, bonus_rub=0, error=None, card_id=None):
    db = await get_db()
    await db.execute(
        """UPDATE season_awards
           SET yclients_status = ?, yclients_bonus_rub = ?, yclients_error = ?, yclients_card_id = ?
           WHERE season_key = ? AND telegram_id = ? AND reason = ?""",
        (status, bonus_rub, error, str(card_id) if card_id is not None else None, season_key, telegram_id, reason)
    )
    await db.commit()
    await db.close()

async def clear_all_laps():
    """Удаляет все записи о кругах, не трогая пилотов и рейтинг."""
    db = await get_db()
    await db.execute('DELETE FROM laps')
    await db.commit()
    await db.close()

async def get_leaderboard_data():
    """Возвращает до 5 лучших результатов по каждой дисциплине (для отображения)."""
    db = await get_db()
    cursor = await db.execute('''
        SELECT d.name, l.username, l.track, l.lap_time_ms, l.lap_time_text
        FROM (
            SELECT *,
                ROW_NUMBER() OVER (
                    PARTITION BY discipline_id, username
                    ORDER BY lap_time_ms ASC
                ) AS rn
            FROM laps
        ) l
        JOIN disciplines d ON d.id = l.discipline_id
        WHERE l.rn = 1
        ORDER BY d.name, l.lap_time_ms ASC
    ''')
    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()

    result = {}
    for discipline, username, track, lap_ms, lap_text in rows:
        result.setdefault(discipline, [])
        if len(result[discipline]) < 5:
            result[discipline].append({
                "username": username,
                "track": track,
                "lap_ms": lap_ms,
                "lap_text": lap_text
            })
    return result

async def get_top10_pilots():
    db = await get_db()
    cursor = await db.execute(
        '''SELECT username, display_name, pilot_number, rating
           FROM pilots
           ORDER BY rating DESC
           LIMIT 10'''
    )
    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()
    return [
        {
            "username": row[0],
            "display_name": row[1],
            "pilot_number": row[2],
            "rating": row[3]
        }
        for row in rows
    ]

async def sync_yclients_client(telegram_id: int, yclients_client_id: int):
    db = await get_db()
    await db.execute('UPDATE pilots SET yclients_client_id = ? WHERE telegram_id = ?',
                     (yclients_client_id, telegram_id))
    await db.commit()
    await db.close()

async def bind_yclients_client(telegram_id: int, client_id: int):
    """Сохраняет ID клиента YCLIENTS в профиле пилота."""
    db = await get_db()
    await db.execute(
        'UPDATE pilots SET yclients_client_id = ? WHERE telegram_id = ?',
        (client_id, telegram_id)
    )
    await db.commit()
    await db.close()

async def add_track(discipline: str, track_name: str):
    """Добавляет новую трассу в дисциплину. Если дисциплины нет – создаёт."""
    await create_discipline(discipline)
    disc_id = await get_discipline_id(discipline)
    db = await get_db()
    # Проверим, нет ли уже такой трассы
    cursor = await db.execute(
        "SELECT id FROM tracks WHERE discipline_id = ? AND name = ?",
        (disc_id, track_name)
    )
    existing = await cursor.fetchone()
    await cursor.close()
    if existing:
        await db.close()
        return False, "exists"
    await db.execute(
        "INSERT INTO tracks (discipline_id, name) VALUES (?, ?)",
        (disc_id, track_name)
    )
    await db.commit()
    await db.close()
    return True, None

async def remove_track(discipline: str, track_name: str):
    """Удаляет трассу из дисциплины."""
    disc_id = await get_discipline_id(discipline)
    if not disc_id:
        return False
    db = await get_db()
    await db.execute(
        "DELETE FROM tracks WHERE discipline_id = ? AND name = ?",
        (disc_id, track_name)
    )
    await db.commit()
    await db.close()
    return True

async def get_all_disciplines():
    """Возвращает список названий всех дисциплин."""
    db = await get_db()
    cursor = await db.execute("SELECT name FROM disciplines")
    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()
    return [r[0] for r in rows]

async def get_tracks_for_discipline(discipline: str):
    """Возвращает список трасс для конкретной дисциплины."""
    disc_id = await get_discipline_id(discipline)
    if not disc_id:
        return []
    db = await get_db()
    cursor = await db.execute(
        "SELECT name FROM tracks WHERE discipline_id = ?",
        (disc_id,)
    )
    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()
    return [r[0] for r in rows]

# --- Bonus wallet / YCLIENTS pending operations ---
async def add_bonus_wallet_entry(telegram_id: int, yclients_client_id: int | None, source: str, amount: float,
                                 expires_at: str | None = None, reason: str | None = None,
                                 yclients_status: str = "pending", yclients_operation_id: int | None = None):
    amount = round(float(amount or 0), 2)
    db = await get_db()
    cur = await db.execute(
        """INSERT INTO bonus_wallet
           (telegram_id, yclients_client_id, source, amount, spent, remaining, expires_at, reason, yclients_status, yclients_operation_id)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)""",
        (telegram_id, yclients_client_id, source, amount, amount, expires_at, reason, yclients_status, yclients_operation_id)
    )
    row_id = cur.lastrowid
    await db.commit()
    await db.close()
    return row_id

async def create_pending_yclients_operation(telegram_id: int | None, yclients_client_id: int | None,
                                            operation_type: str, amount: float = 0, title: str | None = None,
                                            source: str | None = None, status: str = "pending",
                                            last_error: str | None = None):
    db = await get_db()
    cur = await db.execute(
        """INSERT INTO pending_yclients_operations
           (telegram_id, yclients_client_id, operation_type, amount, title, source, status, last_error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (telegram_id, yclients_client_id, operation_type, round(float(amount or 0), 2), title, source, status, last_error)
    )
    row_id = cur.lastrowid
    await db.commit()
    await db.close()
    return row_id

async def claim_pending_yclients_operation(operation_id: int) -> bool:
    """Атомарно резервирует отложенную операцию перед обработкой.

    Без этого шага параллельный запуск обработки (например, задача при
    старте бота и одновременно сработавший scheduler) мог бы применить
    одну и ту же операцию (начисление/списание бонуса) дважды.
    """
    db = await get_db()
    try:
        cursor = await db.execute(
            """UPDATE pending_yclients_operations
               SET status = 'processing', updated_at = CURRENT_TIMESTAMP
               WHERE id = ? AND status IN ('pending', 'retry')""",
            (operation_id,)
        )
        await db.commit()
        return cursor.rowcount == 1
    finally:
        await db.close()


async def update_pending_yclients_operation(operation_id: int, status: str, last_error: str | None = None,
                                            yclients_card_id: str | None = None):
    db = await get_db()
    await db.execute(
        """UPDATE pending_yclients_operations
           SET status = ?, attempts = attempts + 1, last_error = ?, yclients_card_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?""",
        (status, last_error, yclients_card_id, operation_id)
    )
    await db.commit()
    await db.close()

async def get_pending_yclients_operations(limit: int = 100):
    db = await get_db()
    cur = await db.execute(
        """SELECT id, telegram_id, yclients_client_id, operation_type, amount, title, source, attempts
           FROM pending_yclients_operations
           WHERE status IN ('pending', 'retry')
           ORDER BY id ASC LIMIT ?""",
        (limit,)
    )
    rows = await cur.fetchall()
    await cur.close()
    await db.close()
    return [
        {"id": r[0], "telegram_id": r[1], "yclients_client_id": r[2], "operation_type": r[3],
         "amount": r[4], "title": r[5], "source": r[6], "attempts": r[7]}
        for r in rows
    ]

async def log_yclients_sync(telegram_id: int | None, phone: str | None, yclients_client_id: int | None,
                            status: str, message: str | None = None):
    db = await get_db()
    await db.execute(
        """INSERT INTO yclients_sync_log (telegram_id, phone, yclients_client_id, status, message)
           VALUES (?, ?, ?, ?, ?)""",
        (telegram_id, phone, yclients_client_id, status, message)
    )
    await db.commit()
    await db.close()

async def get_unsynced_pilots():
    db = await get_db()
    cur = await db.execute(
        """SELECT telegram_id, username, phone, yclients_client_id
           FROM pilots
           WHERE phone IS NOT NULL AND phone != ''"""
    )
    rows = await cur.fetchall()
    await cur.close()
    await db.close()
    return [
        {"telegram_id": r[0], "username": r[1], "phone": r[2], "yclients_client_id": r[3]}
        for r in rows
    ]

async def get_expired_season_wallet_entries(now_iso: str):
    db = await get_db()
    cur = await db.execute(
        """SELECT id, telegram_id, yclients_client_id, remaining, source, reason
           FROM bonus_wallet
           WHERE source = 'season_award'
             AND expires_at IS NOT NULL
             AND expired_at IS NULL
             AND remaining > 0
             AND expires_at <= ?
           ORDER BY expires_at ASC""",
        (now_iso,)
    )
    rows = await cur.fetchall()
    await cur.close()
    await db.close()
    return [
        {"id": r[0], "telegram_id": r[1], "yclients_client_id": r[2], "remaining": r[3], "source": r[4], "reason": r[5]}
        for r in rows
    ]

async def claim_wallet_entry_expiry(entry_id: int, amount_to_withdraw: float) -> bool:
    """Атомарно резервирует сгорание бонуса (ставит expired_at) до попытки
    списания через YCLIENTS.

    Порядок важен: если сначала списывать деньги через внешний API, а потом
    отмечать запись сгоревшей, то падение процесса между этими шагами приведёт
    к повторному списанию той же суммы при следующем запуске. Пометка первой
    гарантирует, что при сбое максимум "потеряется" списание в YCLIENTS
    (безопасно и восстановимо через pending_yclients_operations), но никогда
    не произойдёт двойное списание с карты клиента.
    """
    db = await get_db()
    try:
        cursor = await db.execute(
            """UPDATE bonus_wallet
               SET expired_at = CURRENT_TIMESTAMP, remaining = 0,
                   spent = spent + ?
               WHERE id = ? AND expired_at IS NULL AND remaining > 0""",
            (round(float(amount_to_withdraw or 0), 2), entry_id)
        )
        await db.commit()
        return cursor.rowcount == 1
    finally:
        await db.close()


async def mark_wallet_entry_expired(entry_id: int, amount_spent: float = 0):
    db = await get_db()
    await db.execute(
        """UPDATE bonus_wallet
           SET expired_at = CURRENT_TIMESTAMP, remaining = 0,
               spent = spent + ?
           WHERE id = ?""",
        (round(float(amount_spent or 0), 2), entry_id)
    )
    await db.commit()
    await db.close()

# --- Week CUP ---

WEEK_CUP_NAMES = ("WEEK CUP", "WEEKCUP", "WEEK_CUP", "WEEK")


async def get_weekcup_top3():
    """
    Возвращает TOP-3 Week CUP.
    Берёт лучший круг каждого пилота и сортирует по времени.
    """
    db = await get_db()

    cursor = await db.execute(
        """
        WITH best_laps AS (
            SELECT
                l.id,
                d.name AS discipline,
                l.username,
                l.telegram_id,
                l.track,
                l.lap_time_text,
                l.lap_time_ms,
                COALESCE(NULLIF(p.display_name, ''), NULLIF(p.username, ''), l.username) AS display_name,
                p.pilot_number,
                p.yclients_client_id,
                ROW_NUMBER() OVER (
                    PARTITION BY COALESCE(CAST(l.telegram_id AS TEXT), l.username)
                    ORDER BY l.lap_time_ms ASC
                ) AS rn
            FROM laps l
            JOIN disciplines d ON d.id = l.discipline_id
            LEFT JOIN pilots p ON p.telegram_id = l.telegram_id
            WHERE UPPER(TRIM(d.name)) IN ('WEEK CUP', 'WEEKCUP', 'WEEK_CUP', 'WEEK')
        )
        SELECT
            id,
            discipline,
            username,
            telegram_id,
            track,
            lap_time_text,
            lap_time_ms,
            display_name,
            pilot_number,
            yclients_client_id
        FROM best_laps
        WHERE rn = 1
        ORDER BY lap_time_ms ASC
        LIMIT 3
        """
    )

    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()

    result = []

    for index, row in enumerate(rows, start=1):
        result.append({
            "place": index,
            "lap_id": row[0],
            "discipline": row[1],
            "username": row[2],
            "telegram_id": row[3],
            "track": row[4],
            "lap_time_text": row[5],
            "lap_time_ms": row[6],
            "display_name": row[7],
            "pilot_number": row[8],
            "yclients_client_id": row[9],
        })

    return result


async def clear_weekcup_laps():
    """
    Очищает только Week CUP.
    Остальные дисциплины не трогает.
    """
    db = await get_db()

    cursor = await db.execute(
        """
        DELETE FROM laps
        WHERE discipline_id IN (
            SELECT id FROM disciplines
            WHERE UPPER(TRIM(name)) IN ('WEEK CUP', 'WEEKCUP', 'WEEK_CUP', 'WEEK')
        )
        """
    )

    deleted_count = cursor.rowcount

    await db.commit()
    await db.close()

    return deleted_count


async def get_weekcup_all_results():
    """
    Возвращает все результаты Week CUP для лога перед очисткой.
    """
    db = await get_db()

    cursor = await db.execute(
        """
        SELECT
            d.name AS discipline,
            l.username,
            l.telegram_id,
            l.track,
            l.lap_time_text,
            l.lap_time_ms,
            l.created_at
        FROM laps l
        JOIN disciplines d ON d.id = l.discipline_id
        WHERE UPPER(TRIM(d.name)) IN ('WEEK CUP', 'WEEKCUP', 'WEEK_CUP', 'WEEK')
        ORDER BY l.lap_time_ms ASC
        """
    )

    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()

    return [
        {
            "discipline": row[0],
            "username": row[1],
            "telegram_id": row[2],
            "track": row[3],
            "lap_time_text": row[4],
            "lap_time_ms": row[5],
            "created_at": row[6],
        }
        for row in rows
    ]

# =========================================================
# ЗАЯВКИ ПИЛОТОВ НА УСТАНОВКУ ВРЕМЕНИ
# =========================================================

async def expire_old_time_requests():
    """
    Просрочивает заявки, которые администраторы не рассмотрели за 24 часа.
    Это не даёт старой заявке навсегда блокировать пользователя.
    """
    db = await get_db()

    cursor = await db.execute(
        """
        UPDATE time_requests
        SET status = 'expired',
            decided_at = CURRENT_TIMESTAMP
        WHERE status = 'pending'
          AND datetime(created_at) <= datetime('now', '-1 day')
        """
    )

    changed = cursor.rowcount

    await db.commit()
    await db.close()

    return changed


async def get_pending_time_request(telegram_id: int):
    db = await get_db()

    cursor = await db.execute(
        """
        SELECT
            id,
            telegram_id,
            username,
            pilot_number,
            discipline,
            track,
            lap_time_text,
            lap_time_ms,
            photo_file_id,
            status,
            admin_id,
            lap_id,
            created_at,
            decided_at
        FROM time_requests
        WHERE telegram_id = ?
          AND status IN ('pending', 'processing')
        ORDER BY id DESC
        LIMIT 1
        """,
        (telegram_id,)
    )

    row = await cursor.fetchone()
    await cursor.close()
    await db.close()

    if not row:
        return None

    return {
        "id": row[0],
        "telegram_id": row[1],
        "username": row[2],
        "pilot_number": row[3],
        "discipline": row[4],
        "track": row[5],
        "lap_time_text": row[6],
        "lap_time_ms": row[7],
        "photo_file_id": row[8],
        "status": row[9],
        "admin_id": row[10],
        "lap_id": row[11],
        "created_at": row[12],
        "decided_at": row[13],
    }


async def get_time_request_cooldown_minutes(
    telegram_id: int,
    cooldown_minutes: int = 30
):
    """
    Возвращает оставшееся количество минут КД.
    Если КД закончился — возвращает 0.
    """
    db = await get_db()

    cursor = await db.execute(
        """
        SELECT
            MAX(
                0,
                CAST(
                    ROUND(
                        (
                            julianday(
                                datetime(
                                    created_at,
                                    '+' || ? || ' minutes'
                                )
                            )
                            - julianday('now')
                        ) * 1440
                    ) AS INTEGER
                )
            )
        FROM time_requests
        WHERE telegram_id = ?
        ORDER BY id DESC
        LIMIT 1
        """,
        (int(cooldown_minutes), telegram_id)
    )

    row = await cursor.fetchone()
    await cursor.close()
    await db.close()

    if not row or row[0] is None:
        return 0

    return max(0, int(row[0]))


async def create_time_request(
    telegram_id: int,
    username: str,
    pilot_number: int | None,
    discipline: str,
    track: str,
    lap_time_text: str,
    lap_time_ms: int,
    photo_file_id: str,
):
    db = await get_db()

    cursor = await db.execute(
        """
        INSERT INTO time_requests (
            telegram_id,
            username,
            pilot_number,
            discipline,
            track,
            lap_time_text,
            lap_time_ms,
            photo_file_id,
            status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        """,
        (
            telegram_id,
            username,
            pilot_number,
            discipline,
            track,
            lap_time_text,
            lap_time_ms,
            photo_file_id,
        )
    )

    request_id = cursor.lastrowid

    await db.commit()
    await db.close()

    return request_id


async def get_time_request(request_id: int):
    db = await get_db()

    cursor = await db.execute(
        """
        SELECT
            id,
            telegram_id,
            username,
            pilot_number,
            discipline,
            track,
            lap_time_text,
            lap_time_ms,
            photo_file_id,
            status,
            admin_id,
            lap_id,
            created_at,
            decided_at
        FROM time_requests
        WHERE id = ?
        LIMIT 1
        """,
        (request_id,)
    )

    row = await cursor.fetchone()
    await cursor.close()
    await db.close()

    if not row:
        return None

    return {
        "id": row[0],
        "telegram_id": row[1],
        "username": row[2],
        "pilot_number": row[3],
        "discipline": row[4],
        "track": row[5],
        "lap_time_text": row[6],
        "lap_time_ms": row[7],
        "photo_file_id": row[8],
        "status": row[9],
        "admin_id": row[10],
        "lap_id": row[11],
        "created_at": row[12],
        "decided_at": row[13],
    }


async def acquire_time_request(request_id: int, admin_id: int):
    """
    Атомарно резервирует заявку за администратором.

    Если одновременно нажали два администратора,
    обработать заявку сможет только первый.
    """
    db = await get_db()

    cursor = await db.execute(
        """
        UPDATE time_requests
        SET status = 'processing',
            admin_id = ?
        WHERE id = ?
          AND status = 'pending'
        """,
        (admin_id, request_id)
    )

    acquired = cursor.rowcount == 1

    await db.commit()
    await db.close()

    return acquired


async def complete_time_request(
    request_id: int,
    status: str,
    admin_id: int | None = None,
    lap_id: int | None = None,
):
    db = await get_db()

    await db.execute(
        """
        UPDATE time_requests
        SET status = ?,
            admin_id = COALESCE(?, admin_id),
            lap_id = COALESCE(?, lap_id),
            decided_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (status, admin_id, lap_id, request_id)
    )

    await db.commit()
    await db.close()


async def create_support_message(telegram_id: int, username: str | None, message_text: str) -> int:
    db = await get_db()
    cursor = await db.execute(
        """
        INSERT INTO support_messages(telegram_id, username, message_text)
        VALUES (?, ?, ?)
        """,
        (telegram_id, username, message_text),
    )
    message_id = cursor.lastrowid
    await db.commit()
    await db.close()
    return message_id


async def get_support_message(message_id: int):
    db = await get_db()
    cursor = await db.execute(
        "SELECT * FROM support_messages WHERE id = ?",
        (message_id,),
    )
    row = await cursor.fetchone()
    columns = [d[0] for d in cursor.description]
    await cursor.close()
    await db.close()
    return dict(zip(columns, row)) if row else None


async def claim_support_message_for_reply(message_id: int, admin_id: int) -> bool:
    """Атомарно закрепляет заявку за админом, который начал печатать ответ,
    чтобы два администратора не отправили клиенту два разных ответа."""
    db = await get_db()
    cursor = await db.execute(
        """
        UPDATE support_messages
        SET status = 'answering', admin_id = ?
        WHERE id = ? AND status = 'pending'
        """,
        (admin_id, message_id),
    )
    changed = cursor.rowcount == 1
    await db.commit()
    await db.close()
    return changed


async def release_support_message(message_id: int) -> None:
    """Возвращает заявку в pending, если админ отменил ответ."""
    db = await get_db()
    await db.execute(
        """
        UPDATE support_messages
        SET status = 'pending', admin_id = NULL
        WHERE id = ? AND status = 'answering'
        """,
        (message_id,),
    )
    await db.commit()
    await db.close()


async def complete_support_message(message_id: int, admin_id: int, reply_text: str) -> None:
    db = await get_db()
    await db.execute(
        """
        UPDATE support_messages
        SET status = 'answered', admin_id = ?, reply_text = ?, answered_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (admin_id, reply_text, message_id),
    )
    await db.commit()
    await db.close()


# ============================================================================
# ТУРНИРНАЯ СИСТЕМА v2 (живой рейтинг по эталону)
# ============================================================================

async def set_class_benchmark(class_name: str, month_key: str, track: str | None, benchmark_ms: int, admin_id: int) -> None:
    db = await get_db()
    await db.execute(
        """
        INSERT INTO class_benchmarks(class_name, month_key, track, benchmark_ms, set_by_admin_id)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(class_name, month_key) DO UPDATE SET
            track = excluded.track,
            benchmark_ms = excluded.benchmark_ms,
            set_by_admin_id = excluded.set_by_admin_id
        """,
        (class_name, month_key, track, benchmark_ms, admin_id),
    )
    await db.commit()
    await db.close()


async def carry_benchmarks_to_current_season() -> int:
    """Переносит эталоны в ключ текущего сезона, если для него их ещё нет.

    Зачем. Сезон теперь считается как интервал между закрытиями (20-е 18:00 →
    20-е 18:00), а не как календарный месяц, и ключ сезона — месяц закрытия.
    После 20-го числа ключ текущего сезона указывает на СЛЕДУЮЩИЙ месяц: 25
    августа идёт сезон "2026-09". Эталоны, заданные админом по прежней схеме,
    лежат под ключом "2026-08" — без переноса таблица лидеров и ТВ-табло сразу
    после обновления показали бы "эталон не задан" и обнулили бы баллы всех
    пилотов, хотя ничего не менялось.

    Переносится только если для текущего сезона эталонов нет вообще: если админ
    уже задал их сам, ничего не трогаем. Берём последнюю по времени запись
    на каждый класс. Возвращает число перенесённых классов.
    """
    from config import MOSCOW_TZ, SEASON_CLOSE_DAY, SEASON_CLOSE_HOUR, SEASON_CLOSE_MINUTE
    from data.tournament import month_bounds

    season_key = month_bounds(
        moscow_tz_name=MOSCOW_TZ,
        close_day=SEASON_CLOSE_DAY,
        close_hour=SEASON_CLOSE_HOUR,
        close_minute=SEASON_CLOSE_MINUTE,
    )[0]

    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT COUNT(*) FROM class_benchmarks WHERE month_key = ?", (season_key,)
        )
        existing = (await cursor.fetchone())[0]
        await cursor.close()
        if existing:
            return 0

        # Последний заданный эталон на каждый класс из любого прежнего периода.
        cursor = await db.execute(
            """
            SELECT class_name, track, benchmark_ms, set_by_admin_id
            FROM class_benchmarks
            WHERE id IN (
                SELECT MAX(id) FROM class_benchmarks
                WHERE month_key < ?
                GROUP BY class_name
            )
            """,
            (season_key,),
        )
        rows = await cursor.fetchall()
        await cursor.close()

        if not rows:
            return 0

        for class_name, track, benchmark_ms, admin_id in rows:
            await db.execute(
                """INSERT OR IGNORE INTO class_benchmarks
                       (class_name, month_key, track, benchmark_ms, set_by_admin_id)
                   VALUES (?, ?, ?, ?, ?)""",
                (class_name, season_key, track, benchmark_ms, admin_id),
            )
        await db.commit()
        logger.info(
            "Эталоны перенесены в ключ текущего сезона %s: %s классов. "
            "Проверьте их в админ-меню «🎯 Эталоны месяца».",
            season_key, len(rows),
        )
        return len(rows)
    finally:
        await db.close()


async def get_class_benchmark(class_name: str, month_key: str) -> dict | None:
    db = await get_db()
    cursor = await db.execute(
        "SELECT * FROM class_benchmarks WHERE class_name = ? AND month_key = ?",
        (class_name, month_key),
    )
    row = await cursor.fetchone()
    columns = [d[0] for d in cursor.description]
    await cursor.close()
    await db.close()
    return dict(zip(columns, row)) if row else None


async def get_all_class_benchmarks(month_key: str) -> dict[str, dict]:
    db = await get_db()
    cursor = await db.execute(
        "SELECT * FROM class_benchmarks WHERE month_key = ?",
        (month_key,),
    )
    rows = await cursor.fetchall()
    columns = [d[0] for d in cursor.description]
    await cursor.close()
    await db.close()
    return {row[columns.index("class_name")]: dict(zip(columns, row)) for row in rows}


async def get_pilot_class(telegram_id: int) -> str:
    db = await get_db()
    cursor = await db.execute(
        "SELECT current_class FROM pilot_class_status WHERE telegram_id = ?",
        (telegram_id,),
    )
    row = await cursor.fetchone()
    await cursor.close()
    await db.close()
    return row[0] if row else "MX-5"


async def get_all_pilot_classes() -> dict[int, str]:
    db = await get_db()
    cursor = await db.execute("SELECT telegram_id, current_class FROM pilot_class_status")
    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()
    return {tid: cls for tid, cls in rows}


async def get_all_pilots_indexed() -> dict[int, dict]:
    """{telegram_id: строка пилота} — для мест, где нужны и имя, и номер сразу
    (ТВ-табло подписывает каждую строку общего зачёта именем и номером)."""
    db = await get_db()
    cursor = await db.execute(
        "SELECT telegram_id, display_name, username, pilot_number FROM pilots WHERE telegram_id IS NOT NULL"
    )
    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()
    return {
        int(telegram_id): {
            "telegram_id": int(telegram_id),
            "display_name": display_name,
            "username": username,
            "pilot_number": pilot_number,
        }
        for telegram_id, display_name, username, pilot_number in rows
    }


async def get_all_pilot_display_names() -> dict[int, str]:
    """{telegram_id: отображаемое имя} для всех пилотов одним запросом.

    Таблица лидеров и ТВ-табло подписывают каждую строку именем пилота, и
    раньше на каждую строку шёл отдельный get_pilot_by_telegram_id — по два-три
    десятка запросов на один рендер, причём табло перезапрашивает данные каждые
    30 секунд.
    """
    db = await get_db()
    cursor = await db.execute(
        """SELECT telegram_id,
                  COALESCE(NULLIF(TRIM(display_name), ''),
                           NULLIF(TRIM(username), ''),
                           CAST(telegram_id AS TEXT)) AS shown
           FROM pilots WHERE telegram_id IS NOT NULL"""
    )
    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()
    return {int(telegram_id): str(shown) for telegram_id, shown in rows}


async def get_all_promoted_months() -> dict[int, str | None]:
    """{telegram_id: месяц перехода в текущий класс} для всех пилотов одним
    запросом. Релегация проверяет это для каждого кандидата на понижение —
    раньше на каждого открывалось отдельное соединение прямо в цикле."""
    db = await get_db()
    cursor = await db.execute("SELECT telegram_id, promoted_month_key FROM pilot_class_status")
    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()
    return {int(telegram_id): month_key for telegram_id, month_key in rows}


async def set_pilot_class(telegram_id: int, new_class: str, month_key: str | None = None) -> None:
    db = await get_db()
    await db.execute(
        """
        INSERT INTO pilot_class_status(telegram_id, current_class, promoted_at, promoted_month_key, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(telegram_id) DO UPDATE SET
            current_class = excluded.current_class,
            promoted_at = CURRENT_TIMESTAMP,
            promoted_month_key = excluded.promoted_month_key,
            updated_at = CURRENT_TIMESTAMP
        """,
        (telegram_id, new_class, month_key),
    )
    await db.commit()
    await db.close()


async def get_pilot_month_best(telegram_id: int, discipline: str, month_start_iso: str, month_end_iso: str) -> tuple[int | None, int]:
    """Личный лучший круг и число стартов пилота в дисциплине за календарный месяц."""
    db = await get_db()
    cursor = await db.execute(
        """
        SELECT MIN(l.lap_time_ms), COUNT(*)
        FROM laps l
        JOIN disciplines d ON d.id = l.discipline_id
        WHERE l.telegram_id = ? AND d.name = ?
          AND l.created_at >= ? AND l.created_at < ?
        """,
        (telegram_id, discipline, month_start_iso, month_end_iso),
    )
    row = await cursor.fetchone()
    await cursor.close()
    await db.close()
    if not row:
        return None, 0
    best_ms, starts = row
    return (int(best_ms) if best_ms is not None else None), int(starts or 0)


async def get_month_participants(discipline: str, month_start_iso: str, month_end_iso: str) -> list[dict]:
    """Все пилоты с хотя бы одним стартом в дисциплине за месяц (для релегации/зачёта)."""
    db = await get_db()
    cursor = await db.execute(
        """
        SELECT l.telegram_id, MIN(l.lap_time_ms) AS best_ms, COUNT(*) AS starts
        FROM laps l
        JOIN disciplines d ON d.id = l.discipline_id
        WHERE d.name = ? AND l.created_at >= ? AND l.created_at < ?
        GROUP BY l.telegram_id
        """,
        (discipline, month_start_iso, month_end_iso),
    )
    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()
    return [{"telegram_id": tid, "best_ms": best_ms, "starts": starts} for tid, best_ms, starts in rows]


async def get_all_month_bests(month_start_iso: str, month_end_iso: str) -> dict[tuple[int, str], tuple[int | None, int]]:
    """Лучшие круги и число стартов ВСЕХ пилотов по ВСЕМ дисциплинам за месяц
    одним запросом: {(telegram_id, дисциплина): (лучший_ms, стартов)}.

    Заменяет N×6 отдельных вызовов get_pilot_month_best при расчёте общего
    зачёта. Раньше полный расчёт зачёта открывал примерно 36×N соединений к
    SQLite (каждая функция в этом модуле открывает своё), и ТВ-табло дёргало
    этот расчёт каждые 30 секунд — на 20 пилотах это ~770 соединений на рендер.
    """
    db = await get_db()
    cursor = await db.execute(
        """
        SELECT l.telegram_id, d.name, MIN(l.lap_time_ms), COUNT(*)
        FROM laps l
        JOIN disciplines d ON d.id = l.discipline_id
        WHERE l.created_at >= ? AND l.created_at < ?
          AND l.telegram_id IS NOT NULL
        GROUP BY l.telegram_id, d.name
        """,
        (month_start_iso, month_end_iso),
    )
    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()
    return {
        (int(telegram_id), discipline): (
            int(best_ms) if best_ms is not None else None,
            int(starts or 0),
        )
        for telegram_id, discipline, best_ms, starts in rows
    }


async def get_pilots_active_before(month_start_iso: str) -> set[int]:
    """Пилоты, у которых есть хотя бы один круг ДО начала месяца.

    Пакетная замена is_first_active_month: бонус новичка в MX-5 получают все,
    кого в этом множестве нет.
    """
    db = await get_db()
    cursor = await db.execute(
        "SELECT DISTINCT telegram_id FROM laps WHERE created_at < ? AND telegram_id IS NOT NULL",
        (month_start_iso,),
    )
    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()
    return {int(row[0]) for row in rows}


async def is_first_active_month(telegram_id: int, month_start_iso: str) -> bool:
    """True, если у пилота нет ни одного круга раньше начала этого месяца
    (то есть это его первый активный месяц — новичок или "разбуженный" аккаунт)."""
    db = await get_db()
    cursor = await db.execute(
        "SELECT 1 FROM laps WHERE telegram_id = ? AND created_at < ? LIMIT 1",
        (telegram_id, month_start_iso),
    )
    row = await cursor.fetchone()
    await cursor.close()
    await db.close()
    return row is None


async def count_lifetime_laps(telegram_id: int) -> int:
    db = await get_db()
    cursor = await db.execute("SELECT COUNT(*) FROM laps WHERE telegram_id = ?", (telegram_id,))
    row = await cursor.fetchone()
    await cursor.close()
    await db.close()
    return int(row[0] or 0) if row else 0


async def lifetime_disciplines_raced(telegram_id: int) -> set[str]:
    db = await get_db()
    cursor = await db.execute(
        """
        SELECT DISTINCT d.name FROM laps l
        JOIN disciplines d ON d.id = l.discipline_id
        WHERE l.telegram_id = ?
        """,
        (telegram_id,),
    )
    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()
    return {row[0] for row in rows}


async def has_prior_laps_on_track(discipline: str, track: str, before_created_at: str) -> bool:
    """Были ли уже круги на этой трассе/дисциплине до данного момента (для ачивки "первопроходец")."""
    db = await get_db()
    cursor = await db.execute(
        """
        SELECT 1 FROM laps l
        JOIN disciplines d ON d.id = l.discipline_id
        WHERE d.name = ? AND l.track = ? AND l.created_at < ?
        LIMIT 1
        """,
        (discipline, track, before_created_at),
    )
    row = await cursor.fetchone()
    await cursor.close()
    await db.close()
    return row is not None


async def count_month_improvements(telegram_id: int, discipline: str, start_iso: str, end_iso: str) -> int:
    """Сколько раз за месяц личный лучший круг в дисциплине реально улучшался
    (а не просто повторялся хуже прежнего)."""
    db = await get_db()
    cursor = await db.execute(
        """
        SELECT l.lap_time_ms
        FROM laps l
        JOIN disciplines d ON d.id = l.discipline_id
        WHERE l.telegram_id = ? AND d.name = ?
          AND l.created_at >= ? AND l.created_at < ?
        ORDER BY l.created_at ASC
        """,
        (telegram_id, discipline, start_iso, end_iso),
    )
    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()

    improvements = 0
    best = None
    for (lap_ms,) in rows:
        if best is None:
            best = lap_ms
            continue
        if lap_ms < best:
            improvements += 1
            best = lap_ms
    return improvements


async def unlock_achievement(telegram_id: int, achievement_code: str) -> bool:
    """Атомарно разблокирует ачивку. Возвращает True, только если она открыта впервые сейчас."""
    db = await get_db()
    cursor = await db.execute(
        "INSERT OR IGNORE INTO pilot_achievements(telegram_id, achievement_code) VALUES (?, ?)",
        (telegram_id, achievement_code),
    )
    unlocked_now = cursor.rowcount == 1
    await db.commit()
    await db.close()
    return unlocked_now


async def get_pilot_achievements(telegram_id: int) -> set[str]:
    db = await get_db()
    cursor = await db.execute(
        "SELECT achievement_code FROM pilot_achievements WHERE telegram_id = ?",
        (telegram_id,),
    )
    rows = await cursor.fetchall()
    await cursor.close()
    await db.close()
    return {row[0] for row in rows}


async def get_setting(key: str) -> str | None:
    db = await get_db()
    cursor = await db.execute("SELECT value FROM bot_settings WHERE key = ?", (key,))
    row = await cursor.fetchone()
    await cursor.close()
    await db.close()
    return row[0] if row else None


async def set_setting(key: str, value: str) -> None:
    db = await get_db()
    await db.execute(
        "INSERT INTO bot_settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
    await db.commit()
    await db.close()


# --- Уведомления об общем зачёте месяца ---
async def get_standings_notify_state(month_key: str) -> dict[int, dict]:
    """Всё состояние уведомлений за месяц одним запросом: {telegram_id: строка}.

    Читается целиком, потому что диффер всё равно сравнивает состояние по всем
    пилотам сразу — построчные запросы дали бы N походов в базу на каждый
    засчитанный круг.
    """
    db = await get_db()
    cursor = await db.execute(
        """SELECT telegram_id, month_key, notified_place, notified_total, notified_at,
                  pending_place, pending_total, pending_rival, pending_since,
                  sent_day, sent_today
           FROM standings_notify_state WHERE month_key = ?""",
        (month_key,),
    )
    rows = await cursor.fetchall()
    columns = [d[0] for d in cursor.description]
    await cursor.close()
    await db.close()
    return {row[0]: dict(zip(columns, row)) for row in rows}


async def set_standings_baseline(month_key: str, places: dict[int, tuple[int | None, float]]) -> None:
    """Записывает состояние как уже оповещённое, БЕЗ отправки сообщений.

    Нужно при первом расчёте в новом месяце и при первом запуске после
    обновления бота: иначе весь текущий топ-5 разом получил бы «вы вошли в
    топ-5», хотя ничего только что не изменилось.
    """
    if not places:
        return
    db = await get_db()
    try:
        for telegram_id, (place, total) in places.items():
            await db.execute(
                """INSERT INTO standings_notify_state
                       (telegram_id, month_key, notified_place, notified_total, notified_at)
                   VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                   ON CONFLICT(telegram_id) DO UPDATE SET
                       month_key = excluded.month_key,
                       notified_place = excluded.notified_place,
                       notified_total = excluded.notified_total,
                       notified_at = CURRENT_TIMESTAMP,
                       pending_place = NULL,
                       pending_total = NULL,
                       pending_rival = NULL,
                       pending_since = NULL""",
                (telegram_id, month_key, place, total),
            )
        await db.commit()
    finally:
        await db.close()


async def queue_standings_change(
    telegram_id: int,
    month_key: str,
    place: int | None,
    total: float,
    rival: str | None,
) -> None:
    """Ставит изменение в очередь на отправку (дебаунс).

    pending_since НЕ обновляется, если ожидание уже идёт: иначе поток заявок
    подряд бесконечно отодвигал бы момент отправки, и пилот не узнал бы ничего
    до самого затишья.
    """
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO standings_notify_state
                   (telegram_id, month_key, pending_place, pending_total, pending_rival, pending_since)
               VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(telegram_id) DO UPDATE SET
                   month_key = excluded.month_key,
                   pending_place = excluded.pending_place,
                   pending_total = excluded.pending_total,
                   pending_rival = excluded.pending_rival,
                   pending_since = COALESCE(standings_notify_state.pending_since, CURRENT_TIMESTAMP)""",
            (telegram_id, month_key, place, total, rival),
        )
        await db.commit()
    finally:
        await db.close()


async def get_due_standings_changes(month_key: str) -> list[dict]:
    """Все строки с ожидающим отправки изменением за текущий месяц."""
    db = await get_db()
    cursor = await db.execute(
        """SELECT telegram_id, month_key, notified_place, notified_total, notified_at,
                  pending_place, pending_total, pending_rival, pending_since,
                  sent_day, sent_today
           FROM standings_notify_state
           WHERE month_key = ? AND pending_since IS NOT NULL""",
        (month_key,),
    )
    rows = await cursor.fetchall()
    columns = [d[0] for d in cursor.description]
    await cursor.close()
    await db.close()
    return [dict(zip(columns, row)) for row in rows]


async def clear_standings_pending(telegram_id: int) -> None:
    """Снимает ожидание без отправки — состояние откатилось к уже известному."""
    db = await get_db()
    await db.execute(
        """UPDATE standings_notify_state
           SET pending_place = NULL, pending_total = NULL,
               pending_rival = NULL, pending_since = NULL
           WHERE telegram_id = ?""",
        (telegram_id,),
    )
    await db.commit()
    await db.close()


async def mark_standings_notified(
    telegram_id: int,
    place: int | None,
    total: float,
    day_key: str,
) -> None:
    """Фиксирует факт отправки: новое "оповещённое" место + суточный счётчик."""
    db = await get_db()
    await db.execute(
        """UPDATE standings_notify_state
           SET notified_place = ?, notified_total = ?, notified_at = CURRENT_TIMESTAMP,
               pending_place = NULL, pending_total = NULL,
               pending_rival = NULL, pending_since = NULL,
               sent_today = CASE WHEN sent_day = ? THEN sent_today + 1 ELSE 1 END,
               sent_day = ?
           WHERE telegram_id = ?""",
        (place, total, day_key, day_key, telegram_id),
    )
    await db.commit()
    await db.close()


async def reset_standings_state_for_new_month(month_key: str) -> None:
    """Чистит состояние прошлых месяцев.

    Без этого на старте нового месяца все обнулённые пилоты выглядели бы как
    «выпавшие из топ-5» и получили бы уведомление о смещении, которого не было.
    """
    db = await get_db()
    await db.execute("DELETE FROM standings_notify_state WHERE month_key != ?", (month_key,))
    await db.commit()
    await db.close()


async def get_standings_notify_enabled(telegram_id: int) -> bool:
    db = await get_db()
    cursor = await db.execute(
        "SELECT COALESCE(notify_standings, 1) FROM pilots WHERE telegram_id = ?",
        (telegram_id,),
    )
    row = await cursor.fetchone()
    await cursor.close()
    await db.close()
    return bool(row[0]) if row else True


async def set_standings_notify_enabled(telegram_id: int, enabled: bool) -> None:
    db = await get_db()
    await db.execute(
        "UPDATE pilots SET notify_standings = ? WHERE telegram_id = ?",
        (1 if enabled else 0, telegram_id),
    )
    await db.commit()
    await db.close()


async def restore_time_request_pending(request_id: int):
    """
    Возвращает заявку на рассмотрение, если во время принятия
    произошла техническая ошибка.
    """
    db = await get_db()

    await db.execute(
        """
        UPDATE time_requests
        SET status = 'pending',
            admin_id = NULL,
            decided_at = NULL
        WHERE id = ?
          AND status = 'processing'
        """,
        (request_id,)
    )

    await db.commit()
    await db.close()