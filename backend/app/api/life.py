"""Encrypted goals, memory, and actions. Server never reads ciphertext."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.enums import ActionState, FeedbackOutcome, GoalState, MemoryKind, MemoryOrigin, MemoryState
from app.models import Entry, Habit, Skill, User
from app.models.life import (
    ActionFeedback,
    Goal,
    GoalEntryLink,
    GoalHabitLink,
    GoalSkillLink,
    MemoryEntryLink,
    MemoryItem,
    PlannedAction,
)
from app.schemas.life import (
    ActionRead,
    ActionSyncRequest,
    FeedbackRead,
    FeedbackSyncRequest,
    GoalRead,
    GoalSyncItem,
    GoalSyncRequest,
    LifeBundle,
    LifeSyncResponse,
    LifeSyncResult,
    MemoryRead,
    MemorySyncRequest,
)
from app.services.life_sync import decide_life_item, id_tuple, iso_key

router = APIRouter(prefix="/api/life", tags=["life"])


async def _owned_ids(db: AsyncSession, model, user_id: UUID) -> set[UUID]:
    stmt = select(model.id).where(model.user_id == user_id)
    if hasattr(model, "deleted_at"):
        stmt = stmt.where(model.deleted_at.is_(None))
    rows = (await db.execute(stmt)).scalars().all()
    return set(rows)


def _now() -> datetime:
    return datetime.now(UTC)


def _apply_blob(row, item, *, extra: dict | None = None) -> None:
    row.encrypted_dek = item.encrypted_dek
    row.encrypted_content = item.encrypted_content
    row.version = (row.version or 1) + 1
    row.updated_at = _now()
    if extra:
        for key, value in extra.items():
            setattr(row, key, value)


async def _cas_update(db: AsyncSession, model, row, expected: int, values: dict) -> bool:
    stmt = (
        update(model)
        .where(model.id == row.id, model.user_id == row.user_id, model.version == expected)
        .values(**values, version=expected + 1, updated_at=_now())
    )
    result = await db.execute(stmt)
    if (result.rowcount or 0) != 1:
        return False
    await db.refresh(row)
    return True


async def _goal_extra(db: AsyncSession, goal_id: UUID, review_at, habit_ids, skill_ids, entry_ids) -> tuple:
    if habit_ids is None:
        habit_ids = (await db.execute(select(GoalHabitLink.habit_id).where(GoalHabitLink.goal_id == goal_id))).scalars().all()
    if skill_ids is None:
        skill_ids = (await db.execute(select(GoalSkillLink.skill_id).where(GoalSkillLink.goal_id == goal_id))).scalars().all()
    if entry_ids is None:
        entry_ids = (await db.execute(select(GoalEntryLink.entry_id).where(GoalEntryLink.goal_id == goal_id))).scalars().all()
    return (iso_key(review_at), id_tuple(habit_ids), id_tuple(skill_ids), id_tuple(entry_ids))


async def _memory_extra(db: AsyncSession, memory_id: UUID, kind, origin, reviewed_at, entry_ids) -> tuple:
    if entry_ids is None:
        entry_ids = (
            await db.execute(select(MemoryEntryLink.entry_id).where(MemoryEntryLink.memory_id == memory_id))
        ).scalars().all()
    return (kind, origin, iso_key(reviewed_at), id_tuple(entry_ids))


@router.get("", response_model=LifeBundle)
async def list_life(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LifeBundle:
    uid = current_user.id
    goals = list(
        (await db.execute(select(Goal).where(Goal.user_id == uid, Goal.deleted_at.is_(None)))).scalars().all()
    )
    memory = list(
        (
            await db.execute(select(MemoryItem).where(MemoryItem.user_id == uid, MemoryItem.deleted_at.is_(None)))
        ).scalars().all()
    )
    actions = list(
        (
            await db.execute(
                select(PlannedAction).where(PlannedAction.user_id == uid, PlannedAction.deleted_at.is_(None))
            )
        ).scalars().all()
    )
    feedback = list(
        (
            await db.execute(
                select(ActionFeedback).where(ActionFeedback.user_id == uid, ActionFeedback.deleted_at.is_(None))
            )
        ).scalars().all()
    )
    habit_links = list((await db.execute(select(GoalHabitLink).where(GoalHabitLink.user_id == uid))).scalars().all())
    skill_links = list((await db.execute(select(GoalSkillLink).where(GoalSkillLink.user_id == uid))).scalars().all())
    entry_links = list((await db.execute(select(GoalEntryLink).where(GoalEntryLink.user_id == uid))).scalars().all())
    mem_links = list((await db.execute(select(MemoryEntryLink).where(MemoryEntryLink.user_id == uid))).scalars().all())

    habits_by_goal: dict[UUID, list[UUID]] = {}
    for link in habit_links:
        habits_by_goal.setdefault(link.goal_id, []).append(link.habit_id)
    skills_by_goal: dict[UUID, list[UUID]] = {}
    for link in skill_links:
        skills_by_goal.setdefault(link.goal_id, []).append(link.skill_id)
    entries_by_goal: dict[UUID, list[UUID]] = {}
    for link in entry_links:
        entries_by_goal.setdefault(link.goal_id, []).append(link.entry_id)
    entries_by_mem: dict[UUID, list[UUID]] = {}
    for link in mem_links:
        entries_by_mem.setdefault(link.memory_id, []).append(link.entry_id)

    now = _now()
    due = [
        row.id
        for row in actions
        if row.review_at is not None
        and row.review_at <= now
        and row.state in {ActionState.ACCEPTED, ActionState.ACTIVE}
    ]
    return LifeBundle(
        goals=[
            GoalRead(
                id=row.id,
                state=row.state,
                version=row.version,
                review_at=row.review_at,
                encrypted_dek=row.encrypted_dek,
                encrypted_content=row.encrypted_content,
                created_at=row.created_at,
                updated_at=row.updated_at,
                habit_ids=habits_by_goal.get(row.id, []),
                skill_ids=skills_by_goal.get(row.id, []),
                entry_ids=entries_by_goal.get(row.id, []),
            )
            for row in goals
        ],
        memory=[
            MemoryRead(
                id=row.id,
                kind=row.kind,
                state=row.state,
                origin=row.origin,
                version=row.version,
                reviewed_at=row.reviewed_at,
                encrypted_dek=row.encrypted_dek,
                encrypted_content=row.encrypted_content,
                created_at=row.created_at,
                updated_at=row.updated_at,
                entry_ids=entries_by_mem.get(row.id, []),
            )
            for row in memory
        ],
        actions=[ActionRead.model_validate(row) for row in actions],
        feedback=[FeedbackRead.model_validate(row) for row in feedback],
        due_action_ids=due,
    )


@router.get("/tombstones")
async def list_life_tombstones(
    since: datetime | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    uid = current_user.id

    async def collect(model, kind: str) -> list[dict]:
        stmt = select(model.id, model.deleted_at, model.version).where(
            model.user_id == uid, model.deleted_at.is_not(None)
        )
        if since is not None:
            stmt = stmt.where(model.deleted_at >= since)
        rows = (await db.execute(stmt)).all()
        return [{"id": row[0], "kind": kind, "deleted_at": row[1], "version": row[2]} for row in rows]

    items = [
        *(await collect(Goal, "goal")),
        *(await collect(MemoryItem, "memory")),
        *(await collect(PlannedAction, "action")),
        *(await collect(ActionFeedback, "feedback")),
    ]
    return {"items": items}


def _state_ok(value: str, allowed: set[str]) -> bool:
    return value in allowed


async def _sync_goals(
    items: list[GoalSyncItem],
    user: User,
    db: AsyncSession,
) -> LifeSyncResponse:
    uid = user.id
    owned_habits = await _owned_ids(db, Habit, uid)
    owned_skills = await _owned_ids(db, Skill, uid)
    owned_entries = await _owned_ids(db, Entry, uid)
    allowed = {item.value for item in GoalState}
    results: list[LifeSyncResult] = []
    saved: list[UUID] = []

    for item in items:
        existing = await db.get(Goal, item.id)
        if existing is not None and existing.user_id != uid:
            results.append(LifeSyncResult(id=item.id, status="rejected", reason="id_unavailable"))
            continue
        if item.habit_ids and not set(item.habit_ids) <= owned_habits:
            results.append(LifeSyncResult(id=item.id, status="rejected", reason="unknown_habit"))
            continue
        if item.skill_ids and not set(item.skill_ids) <= owned_skills:
            results.append(LifeSyncResult(id=item.id, status="rejected", reason="unknown_skill"))
            continue
        if item.entry_ids and not set(item.entry_ids) <= owned_entries:
            results.append(LifeSyncResult(id=item.id, status="rejected", reason="unknown_entry"))
            continue
        if not item.deleted and not _state_ok(item.state, allowed):
            results.append(LifeSyncResult(id=item.id, status="rejected", reason="invalid_state"))
            continue

        existing_data = None
        extra_existing: tuple = ()
        if existing is not None:
            existing_data = {
                "encrypted_dek": existing.encrypted_dek,
                "encrypted_content": existing.encrypted_content,
                "state": existing.state,
                "version": existing.version,
                "deleted_at": existing.deleted_at,
            }
            extra_existing = await _goal_extra(db, existing.id, existing.review_at, None, None, None)
        status, reason = decide_life_item(
            item.model_dump(),
            existing_data,
            extra_incoming=await _goal_extra(db, item.id, item.review_at, item.habit_ids, item.skill_ids, item.entry_ids),
            extra_existing=extra_existing,
        )
        if status == "created":
            row = Goal(
                id=item.id,
                user_id=uid,
                state=item.state,
                review_at=item.review_at,
                encrypted_dek=item.encrypted_dek,
                encrypted_content=item.encrypted_content,
                version=1,
            )
            db.add(row)
            await _write_goal_links(db, uid, item)
            results.append(LifeSyncResult(id=item.id, status=status, version=1))
            saved.append(item.id)
        elif status == "updated" and existing is not None:
            expected = existing.version or 1
            ok = await _cas_update(
                db,
                Goal,
                existing,
                expected,
                {
                    "state": item.state,
                    "review_at": item.review_at,
                    "encrypted_dek": item.encrypted_dek,
                    "encrypted_content": item.encrypted_content,
                },
            )
            if not ok:
                results.append(LifeSyncResult(id=item.id, status="conflict", reason="version_mismatch", version=expected))
                continue
            await _write_goal_links(db, uid, item)
            results.append(LifeSyncResult(id=item.id, status=status, version=existing.version))
            saved.append(item.id)
        elif status == "deleted" and existing is not None and existing.deleted_at is None:
            existing.deleted_at = _now()
            existing.version = (existing.version or 1) + 1
            results.append(LifeSyncResult(id=item.id, status=status, version=existing.version))
        else:
            version = existing.version if existing is not None else None
            results.append(LifeSyncResult(id=item.id, status=status, reason=reason, version=version))
            if status == "duplicate":
                saved.append(item.id)
    await db.commit()
    return LifeSyncResponse(results=results, saved=saved)


async def _write_goal_links(db: AsyncSession, uid: UUID, item: GoalSyncItem) -> None:
    await db.execute(delete(GoalHabitLink).where(GoalHabitLink.goal_id == item.id))
    await db.execute(delete(GoalSkillLink).where(GoalSkillLink.goal_id == item.id))
    await db.execute(delete(GoalEntryLink).where(GoalEntryLink.goal_id == item.id))
    db.add_all([GoalHabitLink(goal_id=item.id, habit_id=hid, user_id=uid) for hid in item.habit_ids])
    db.add_all([GoalSkillLink(goal_id=item.id, skill_id=sid, user_id=uid) for sid in item.skill_ids])
    db.add_all([GoalEntryLink(goal_id=item.id, entry_id=eid, user_id=uid) for eid in item.entry_ids])


@router.post("/goals/sync", response_model=LifeSyncResponse)
async def sync_goals(
    payload: GoalSyncRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LifeSyncResponse:
    return await _sync_goals(payload.items, current_user, db)


@router.post("/memory/sync", response_model=LifeSyncResponse)
async def sync_memory(
    payload: MemorySyncRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LifeSyncResponse:
    uid = current_user.id
    owned_entries = await _owned_ids(db, Entry, uid)
    kinds = {item.value for item in MemoryKind}
    states = {item.value for item in MemoryState}
    origins = {item.value for item in MemoryOrigin}
    results: list[LifeSyncResult] = []
    saved: list[UUID] = []
    for item in payload.items:
        existing = await db.get(MemoryItem, item.id)
        if existing is not None and existing.user_id != uid:
            results.append(LifeSyncResult(id=item.id, status="rejected", reason="id_unavailable"))
            continue
        if item.entry_ids and not set(item.entry_ids) <= owned_entries:
            results.append(LifeSyncResult(id=item.id, status="rejected", reason="unknown_entry"))
            continue
        if not item.deleted and (
            item.kind not in kinds or item.state not in states or item.origin not in origins
        ):
            results.append(LifeSyncResult(id=item.id, status="rejected", reason="invalid_state"))
            continue
        existing_data = None
        extra_ex: tuple = ()
        if existing is not None:
            existing_data = {
                "encrypted_dek": existing.encrypted_dek,
                "encrypted_content": existing.encrypted_content,
                "state": existing.state,
                "version": existing.version,
                "deleted_at": existing.deleted_at,
            }
            extra_ex = await _memory_extra(
                db, existing.id, existing.kind, existing.origin, existing.reviewed_at, None
            )
        status, reason = decide_life_item(
            item.model_dump(),
            existing_data,
            extra_incoming=await _memory_extra(
                db, item.id, item.kind, item.origin, item.reviewed_at, item.entry_ids
            ),
            extra_existing=extra_ex,
        )
        if status == "created":
            row = MemoryItem(
                id=item.id,
                user_id=uid,
                kind=item.kind,
                state=item.state,
                origin=item.origin,
                reviewed_at=item.reviewed_at,
                encrypted_dek=item.encrypted_dek,
                encrypted_content=item.encrypted_content,
                version=1,
            )
            db.add(row)
            await db.execute(delete(MemoryEntryLink).where(MemoryEntryLink.memory_id == item.id))
            db.add_all(
                [MemoryEntryLink(memory_id=item.id, entry_id=eid, user_id=uid) for eid in item.entry_ids]
            )
            results.append(LifeSyncResult(id=item.id, status=status, version=1))
            saved.append(item.id)
        elif status == "updated" and existing is not None:
            expected = existing.version or 1
            ok = await _cas_update(
                db,
                MemoryItem,
                existing,
                expected,
                {
                    "kind": item.kind,
                    "state": item.state,
                    "origin": item.origin,
                    "reviewed_at": item.reviewed_at,
                    "encrypted_dek": item.encrypted_dek,
                    "encrypted_content": item.encrypted_content,
                },
            )
            if not ok:
                results.append(LifeSyncResult(id=item.id, status="conflict", reason="version_mismatch", version=expected))
                continue
            await db.execute(delete(MemoryEntryLink).where(MemoryEntryLink.memory_id == item.id))
            db.add_all(
                [MemoryEntryLink(memory_id=item.id, entry_id=eid, user_id=uid) for eid in item.entry_ids]
            )
            results.append(LifeSyncResult(id=item.id, status=status, version=existing.version))
            saved.append(item.id)
        elif status == "deleted" and existing is not None and existing.deleted_at is None:
            existing.deleted_at = _now()
            existing.version = (existing.version or 1) + 1
            results.append(LifeSyncResult(id=item.id, status=status, version=existing.version))
        else:
            version = existing.version if existing is not None else None
            results.append(LifeSyncResult(id=item.id, status=status, reason=reason, version=version))
            if status == "duplicate":
                saved.append(item.id)
    await db.commit()
    return LifeSyncResponse(results=results, saved=saved)


@router.post("/actions/sync", response_model=LifeSyncResponse)
async def sync_actions(
    payload: ActionSyncRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LifeSyncResponse:
    uid = current_user.id
    owned_goals = await _owned_ids(db, Goal, uid)
    states = {item.value for item in ActionState}
    results: list[LifeSyncResult] = []
    saved: list[UUID] = []
    for item in payload.items:
        existing = await db.get(PlannedAction, item.id)
        if existing is not None and existing.user_id != uid:
            results.append(LifeSyncResult(id=item.id, status="rejected", reason="id_unavailable"))
            continue
        if item.goal_id not in owned_goals and not item.deleted:
            results.append(LifeSyncResult(id=item.id, status="rejected", reason="unknown_goal"))
            continue
        if not item.deleted and item.state not in states:
            results.append(LifeSyncResult(id=item.id, status="rejected", reason="invalid_state"))
            continue
        existing_data = None
        extra_ex: tuple = ()
        if existing is not None:
            existing_data = {
                "encrypted_dek": existing.encrypted_dek,
                "encrypted_content": existing.encrypted_content,
                "state": existing.state,
                "version": existing.version,
                "deleted_at": existing.deleted_at,
            }
            extra_ex = (
                existing.goal_id,
                existing.result_metric,
                iso_key(existing.period_start),
                iso_key(existing.period_end),
                iso_key(existing.review_at),
            )
        status, reason = decide_life_item(
            item.model_dump(),
            existing_data,
            extra_incoming=(
                item.goal_id,
                item.result_metric,
                iso_key(item.period_start),
                iso_key(item.period_end),
                iso_key(item.review_at),
            ),
            extra_existing=extra_ex,
        )
        if status == "created":
            row = PlannedAction(
                id=item.id,
                user_id=uid,
                goal_id=item.goal_id,
                state=item.state,
                result_metric=item.result_metric,
                period_start=item.period_start,
                period_end=item.period_end,
                review_at=item.review_at,
                encrypted_dek=item.encrypted_dek,
                encrypted_content=item.encrypted_content,
                version=1,
            )
            db.add(row)
            results.append(LifeSyncResult(id=item.id, status=status, version=1))
            saved.append(item.id)
        elif status == "updated" and existing is not None:
            expected = existing.version or 1
            ok = await _cas_update(
                db,
                PlannedAction,
                existing,
                expected,
                {
                    "goal_id": item.goal_id,
                    "state": item.state,
                    "result_metric": item.result_metric,
                    "period_start": item.period_start,
                    "period_end": item.period_end,
                    "review_at": item.review_at,
                    "encrypted_dek": item.encrypted_dek,
                    "encrypted_content": item.encrypted_content,
                },
            )
            if not ok:
                results.append(LifeSyncResult(id=item.id, status="conflict", reason="version_mismatch", version=expected))
                continue
            results.append(LifeSyncResult(id=item.id, status=status, version=existing.version))
            saved.append(item.id)
        elif status == "deleted" and existing is not None and existing.deleted_at is None:
            existing.deleted_at = _now()
            existing.version = (existing.version or 1) + 1
            results.append(LifeSyncResult(id=item.id, status=status, version=existing.version))
        else:
            version = existing.version if existing is not None else None
            results.append(LifeSyncResult(id=item.id, status=status, reason=reason, version=version))
            if status == "duplicate":
                saved.append(item.id)
    await db.commit()
    return LifeSyncResponse(results=results, saved=saved)


@router.post("/feedback/sync", response_model=LifeSyncResponse)
async def sync_feedback(
    payload: FeedbackSyncRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LifeSyncResponse:
    uid = current_user.id
    owned_actions = await _owned_ids(db, PlannedAction, uid)
    outcomes = {item.value for item in FeedbackOutcome}
    results: list[LifeSyncResult] = []
    saved: list[UUID] = []
    for item in payload.items:
        existing = await db.get(ActionFeedback, item.id)
        if existing is not None and existing.user_id != uid:
            results.append(LifeSyncResult(id=item.id, status="rejected", reason="id_unavailable"))
            continue
        if item.action_id not in owned_actions and not item.deleted:
            results.append(LifeSyncResult(id=item.id, status="rejected", reason="unknown_action"))
            continue
        if not item.deleted and item.outcome_kind not in outcomes:
            results.append(LifeSyncResult(id=item.id, status="rejected", reason="invalid_state"))
            continue
        existing_data = None
        extra_ex: tuple = ()
        if existing is not None:
            existing_data = {
                "encrypted_dek": existing.encrypted_dek,
                "encrypted_content": existing.encrypted_content,
                "state": existing.outcome_kind,
                "version": existing.version,
                "deleted_at": existing.deleted_at,
            }
            extra_ex = (existing.action_id,)
        incoming = {**item.model_dump(), "state": item.outcome_kind}
        status, reason = decide_life_item(
            incoming,
            existing_data,
            extra_incoming=(item.action_id,),
            extra_existing=extra_ex,
        )
        if status == "created":
            row = ActionFeedback(
                id=item.id,
                user_id=uid,
                action_id=item.action_id,
                outcome_kind=item.outcome_kind,
                encrypted_dek=item.encrypted_dek,
                encrypted_content=item.encrypted_content,
                version=1,
            )
            db.add(row)
            results.append(LifeSyncResult(id=item.id, status=status, version=1))
            saved.append(item.id)
        elif status == "updated" and existing is not None:
            expected = existing.version or 1
            ok = await _cas_update(
                db,
                ActionFeedback,
                existing,
                expected,
                {
                    "action_id": item.action_id,
                    "outcome_kind": item.outcome_kind,
                    "encrypted_dek": item.encrypted_dek,
                    "encrypted_content": item.encrypted_content,
                },
            )
            if not ok:
                results.append(LifeSyncResult(id=item.id, status="conflict", reason="version_mismatch", version=expected))
                continue
            results.append(LifeSyncResult(id=item.id, status=status, version=existing.version))
            saved.append(item.id)
        elif status == "deleted" and existing is not None and existing.deleted_at is None:
            existing.deleted_at = _now()
            existing.version = (existing.version or 1) + 1
            results.append(LifeSyncResult(id=item.id, status=status, version=existing.version))
        else:
            version = existing.version if existing is not None else None
            results.append(LifeSyncResult(id=item.id, status=status, reason=reason, version=version))
            if status == "duplicate":
                saved.append(item.id)
    await db.commit()
    return LifeSyncResponse(results=results, saved=saved)
