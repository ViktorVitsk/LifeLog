import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.security import (
    create_access_token,
    generate_pbkdf2_salt,
    hash_password,
    verify_password,
)
from app.models import User
from app.schemas.auth import (
    KekVerifierPut,
    LoginRequest,
    LoginResponse,
    MeResponse,
    RefreshResponse,
    RegisterRequest,
    RegisterResponse,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger(__name__)


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)) -> RegisterResponse:
    salt = generate_pbkdf2_salt()
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        password_salt=salt,
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already taken",
        ) from None
    logger.info("user registered id=%s", user.id)
    return RegisterResponse(salt=salt)


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> LoginResponse:
    result = await db.execute(select(User).where(User.username == payload.username))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )
    token = create_access_token(subject=user.id)
    logger.info("user login id=%s", user.id)
    return LoginResponse(access_token=token, salt=user.password_salt)


@router.post("/refresh", response_model=RefreshResponse)
async def refresh(current_user: User = Depends(get_current_user)) -> RefreshResponse:
    token = create_access_token(subject=current_user.id)
    return RefreshResponse(access_token=token)


@router.get("/me", response_model=MeResponse)
async def me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeResponse:
    content: str | None = None
    dek: str | None = None
    try:
        result = await db.execute(
            text(
                "SELECT encrypted_kek_verifier_content, encrypted_kek_verifier_dek "
                "FROM users WHERE id = :id"
            ),
            {"id": current_user.id},
        )
        row = result.first()
        if row is not None:
            content, dek = row[0], row[1]
    except ProgrammingError:
        await db.rollback()
    return MeResponse(
        id=current_user.id,
        username=current_user.username,
        encrypted_kek_verifier_content=content,
        encrypted_kek_verifier_dek=dek,
    )


@router.put("/kek-verifier", status_code=status.HTTP_204_NO_CONTENT)
async def put_kek_verifier(
    payload: KekVerifierPut,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Store an encrypted KEK check blob. Server never decrypts it. First write only."""
    try:
        result = await db.execute(
            text(
                "UPDATE users SET encrypted_kek_verifier_content = :c, "
                "encrypted_kek_verifier_dek = :d "
                "WHERE id = :id AND encrypted_kek_verifier_dek IS NULL"
            ),
            {
                "c": payload.encrypted_content,
                "d": payload.encrypted_dek,
                "id": current_user.id,
            },
        )
        await db.commit()
    except ProgrammingError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Migration 0004 required for server KEK verifier",
        ) from exc
    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Verifier already set")
    logger.info("kek verifier stored user=%s", current_user.id)
