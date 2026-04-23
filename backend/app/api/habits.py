import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import Habit, User
from app.schemas.habit import HabitCreate, HabitRead, HabitUpdate

router = APIRouter(prefix="/api/habits", tags=["habits"])
logger = logging.getLogger(__name__)


@router.get("", response_model=list[HabitRead])
async def list_habits(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Habit]:
    result = await db.execute(
        select(Habit)
        .where(Habit.user_id == current_user.id)
        .order_by(Habit.created_at.desc())
    )
    return list(result.scalars().all())


@router.post("", response_model=HabitRead, status_code=status.HTTP_201_CREATED)
async def create_habit(
    payload: HabitCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Habit:
    habit = Habit(
        user_id=current_user.id,
        name=payload.name,
        frequency=payload.frequency,
        target_value=payload.target_value,
        unit=payload.unit,
        color=payload.color,
    )
    db.add(habit)
    await db.commit()
    await db.refresh(habit)
    logger.info("habit created user=%s habit_id=%s", current_user.id, habit.id)
    return habit


@router.put("/{habit_id}", response_model=HabitRead)
async def update_habit(
    habit_id: UUID,
    payload: HabitUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Habit:
    result = await db.execute(
        select(Habit).where(Habit.id == habit_id, Habit.user_id == current_user.id)
    )
    habit = result.scalar_one_or_none()
    if habit is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Habit not found")

    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(habit, k, v)

    await db.commit()
    await db.refresh(habit)
    logger.info("habit updated user=%s habit_id=%s", current_user.id, habit_id)
    return habit
