"""Database setup and session management."""

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import event
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./worldbuilder.db")

engine = create_async_engine(DATABASE_URL, echo=False)


# SQLite disables foreign key enforcement by default, so ON DELETE CASCADE
# never fires. Enable it on every connection so deleting an entity also
# removes its relations instead of leaving orphaned rows.
if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine.sync_engine, "connect")
    def _enable_sqlite_fk(dbapi_conn, _connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    async with async_session() as session:
        yield session
