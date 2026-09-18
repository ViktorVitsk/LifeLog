"""Encrypted goals, memory, and actions. Server never reads ciphertext."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
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
    ActionSyncItem,
    ActionSyncRequest,
    FeedbackRead,
    FeedbackSyncItem,
    FeedbackSyncRequest,
    GoalRead,
    GoalSyncItem,
    GoalSyncRequest,
    LifeBundle,
    LifeSyncResponse,
    LifeSyncResult,
    MemoryRead,
    MemorySyncItem,
    MemorySyncRequest,
)
from app.services.life_sync import decide_life_item

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
            extra_existing = (existing.review_at,)
        status, reason = decide_life_item(
            item.model_dump(),
            existing_data,
            extra_incoming=(item.review_at,),
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
            existing.state = item.state
            existing.review_at = item.review_at
            _apply_blob(existing, item)
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
            extra_ex = (existing.kind, existing.origin)
        status, reason = decide_life_item(
            item.model_dump(),
            existing_data,
            extra_incoming=(item.kind, item.origin),
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
            existing.kind = item.kind
            existing.state = item.state
            existing.origin = item.origin
            existing.reviewed_at = item.reviewed_at
            _apply_blob(existing, item)
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
            extra_ex = (existing.goal_id, existing.result_metric)
        status, reason = decide_life_item(
            item.model_dump(),
            existing_data,
            extra_incoming=(item.goal_id, item.result_metric),
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
            existing.goal_id = item.goal_id
            existing.state = item.state
            existing.result_metric = item.result_metric
            existing.period_start = item.period_start
            existing.period_end = item.period_end
            existing.review_at = item.review_at
            _apply_blob(existing, item)
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
            existing.action_id = item.action_id
            existing.outcome_kind = item.outcome_kind
            _apply_blob(existing, item)
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
