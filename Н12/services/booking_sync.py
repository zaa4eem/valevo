import asyncio

from services.yclients_service import (
    get_records,
    # другие функции, которые вам нужны
)

from services.yclients_service import get_records

# =========================
# SYNC BOOKINGS
# =========================

async def sync_bookings():

    while True:

        try:

            records = await get_records()

            print(
                "YCLIENTS SYNC:",
                records
            )

        except Exception as e:

            print(
                "SYNC ERROR:",
                e
            )

        await asyncio.sleep(300)