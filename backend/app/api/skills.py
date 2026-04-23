import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import Skill, User
from app.schemas.skill import SkillCreate, SkillRead, SkillUpdate

router = APIRouter(prefix="/api/skills", tags=["skills"])
logger = logging.getLogger(__name__)


@router.get("", response_model=list[SkillRead])
async def list_skills(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Skill]:
    result = await db.execute(
        select(Skill)
        .where(Skill.user_id == current_user.id)
        .order_by(Skill.created_at.desc())
    )
    return list(result.scalars().all())


@router.post("", response_model=SkillRead, status_code=status.HTTP_201_CREATED)
async def create_skill(
    payload: SkillCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Skill:
    skill = Skill(
        user_id=current_user.id,
        name=payload.name,
        color=payload.color,
        icon=payload.icon,
        metric_schema=payload.metric_schema or {},
    )
    db.add(skill)
    await db.commit()
    await db.refresh(skill)
    logger.info("skill created user=%s skill_id=%s", current_user.id, skill.id)
    return skill


@router.put("/{skill_id}", response_model=SkillRead)
async def update_skill(
    skill_id: UUID,
    payload: SkillUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Skill:
    result = await db.execute(
        select(Skill).where(Skill.id == skill_id, Skill.user_id == current_user.id)
    )
    skill = result.scalar_one_or_none()
    if skill is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found")

    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(skill, k, v)

    await db.commit()
    await db.refresh(skill)
    logger.info("skill updated user=%s skill_id=%s", current_user.id, skill_id)
    return skill
