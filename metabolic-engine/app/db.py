"""Read access to the platform database.

The engine is a *consumer* of the schema owned by the NestJS service. It reads
timeline and measurement data and writes only into `ai.*` (model versions,
predictions, outcomes). It never migrates or reshapes clinical tables.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.config import get_settings

_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        settings = get_settings()
        _pool = ConnectionPool(
            settings.database_url,
            min_size=1,
            max_size=10,
            kwargs={"row_factory": dict_row, "application_name": "metabolic-engine"},
            open=True,
        )
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def connection() -> Iterator[psycopg.Connection[Any]]:
    with get_pool().connection() as conn:
        yield conn


def fetch_all(sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()  # type: ignore[return-value]


def ping() -> bool:
    try:
        with connection() as conn, conn.cursor() as cur:
            cur.execute("select 1 as ok")
            row = cur.fetchone()
            return bool(row and row["ok"] == 1)
    except Exception:
        return False
