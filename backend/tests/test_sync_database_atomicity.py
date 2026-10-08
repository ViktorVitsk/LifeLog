"""Exercise the production endpoint and PostgreSQL transaction/CAS behavior."""

import os
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.api import entries
from app.api.deps import get_current_user
from app.core.database import get_db
from app.main import app
from app.models import Entry, User

pytestmark = pytest.mark.skipif(
    os.environ.get("LIFELOG_LIVE_API") != "1", reason="requires disposable PostgreSQL"
)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "operation", ["update", "delete", "constraint_failure", "insert_race", "insert_duplicate"]
)
async def test_cas_and_savepoint_keep_other_items_and_concurrent_writes(monkeypatch, operation):
    engine = create_async_engine(os.environ["DATABASE_URL"], poolclass=NullPool)
    uid, eid, sibling_id = uuid4(), uuid4(), uuid4()
    now = datetime.now(UTC)
    user = SimpleNamespace(id=uid, timezone="UTC")
    async with AsyncSession(engine) as setup:
        setup.add(
            User(
                id=uid,
                username=f"fictional_atomic_{uid.hex[:12]}",
                password_hash="fictional-unused",
                password_salt="ab" * 32,
                timezone="UTC",
            )
        )
        await setup.flush()
        initial = Entry(
            id=eid,
            user_id=uid,
            timestamp=now,
            recorded_at=now,
            event_timezone="UTC",
            entry_type="THOUGHT",
            tags=[],
            encrypted_dek="fictional-dek",
            encrypted_content="fictional-old",
            version=1,
        )
        if not operation.startswith("insert_"):
            setup.add(initial)
        await setup.commit()

    injected = False

    class RacingSession(AsyncSession):
        async def flush(self, *args, **kwargs):
            nonlocal injected
            if (
                operation.startswith("insert_")
                and not injected
                and any(isinstance(row, Entry) and row.id == eid for row in self.new)
            ):
                injected = True
                async with AsyncSession(engine) as competitor:
                    competitor.add(
                        Entry(
                            id=eid,
                            user_id=uid,
                            timestamp=now,
                            recorded_at=now,
                            event_timezone="UTC",
                            entry_type="THOUGHT",
                            tags=[],
                            encrypted_dek="fictional-dek",
                            encrypted_content="fictional-client"
                            if operation == "insert_duplicate"
                            else "fictional-concurrent",
                            version=1,
                        )
                    )
                    await competitor.commit()
            return await super().flush(*args, **kwargs)

        async def execute(self, statement, *args, **kwargs):
            nonlocal injected
            if getattr(statement, "is_update", False) and not injected:
                injected = True
                if operation != "constraint_failure":
                    async with AsyncSession(engine) as competitor:
                        await competitor.execute(
                            update(Entry)
                            .where(Entry.id == eid)
                            .values(version=2, encrypted_content="fictional-concurrent")
                        )
                        await competitor.commit()
            return await super().execute(statement, *args, **kwargs)

    async def scoped_db():
        async with RacingSession(engine, expire_on_commit=False, autoflush=False) as session:
            yield session

    async def scoped_user():
        return user

    if operation == "constraint_failure":
        original = entries.decide_sync_item

        def bypass_one_validation(incoming, **kwargs):
            # Simulate a constraint violation reaching storage despite validation,
            # e.g. a concurrent FK change. PostgreSQL must roll back only this item.
            if incoming["id"] == eid:
                return "updated", None
            return original(incoming, **kwargs)

        monkeypatch.setattr(entries, "decide_sync_item", bypass_one_validation)

    app.dependency_overrides[get_db] = scoped_db
    app.dependency_overrides[get_current_user] = scoped_user
    row = dict(
        id=str(eid),
        timestamp=now.isoformat(),
        entry_type="THOUGHT",
        tags=[],
        encrypted_dek="fictional-dek",
        encrypted_content="fictional-client",
        version=1,
    )
    if operation == "delete":
        row["deleted"] = True
    if operation == "constraint_failure":
        row["mood_score"] = 99
    sibling = {**row, "id": str(sibling_id), "deleted": False, "mood_score": 7}
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post("/api/entries/sync", json={"entries": [row, sibling]})
        assert response.status_code == 200
        first, second = response.json()["results"]
        assert first["status"] == (
            "rejected"
            if operation == "constraint_failure"
            else "duplicate"
            if operation == "insert_duplicate"
            else "conflict"
        )
        assert first["reason"] == (
            "persist_failed"
            if operation == "constraint_failure"
            else "id_exists"
            if operation == "insert_race"
            else None
            if operation == "insert_duplicate"
            else "version_mismatch"
        )
        if operation == "insert_duplicate":
            assert first["version"] == 1
        assert second["status"] == "created"
        async with AsyncSession(engine) as check:
            stored = (await check.execute(select(Entry).where(Entry.id == eid))).scalar_one()
            assert stored.deleted_at is None
            assert stored.version == (
                1 if operation == "constraint_failure" or operation.startswith("insert_") else 2
            )
            assert stored.encrypted_content == (
                "fictional-old"
                if operation == "constraint_failure"
                else "fictional-client"
                if operation == "insert_duplicate"
                else "fictional-concurrent"
            )
            assert (
                await check.execute(select(Entry).where(Entry.id == sibling_id))
            ).scalar_one().mood_score == 7
    finally:
        app.dependency_overrides.clear()
        async with AsyncSession(engine) as cleanup:
            await cleanup.execute(delete(User).where(User.id == uid))
            await cleanup.commit()
        await engine.dispose()
