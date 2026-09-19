import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, oauth2_scheme
from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import (
    JWTError,
    create_access_token,
    decode_access_token,
    generate_pbkdf2_salt,
    hash_password,
    validate_refresh_session,
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
    TimezonePut,
)
from app.services.calendar_days import DEFAULT_TIMEZONE, validate_timezone
from app.services.login_throttle import LoginThrottle

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger(__name__)
settings = get_settings()
login_throttle = LoginThrottle(
    max_failures=settings.login_max_failures,
    window_seconds=settings.login_failure_window_seconds,
)


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)) -> RegisterResponse:
    salt = generate_pbkdf2_salt()
    zone = DEFAULT_TIMEZONE
    if payload.timezone:
        try:
            zone = validate_timezone(payload.timezone)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_timezone") from None
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        password_salt=salt,
        timezone=zone,
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
    return RegisterResponse(salt=salt, kdf_version=user.kdf_version)


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    client_ip = request.client.host if request.client is not None else "unknown"
    throttle_key = (client_ip, payload.username)
    retry_after = login_throttle.retry_after(throttle_key)
    if retry_after is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts",
            headers={"Retry-After": str(retry_after)},
        )

    result = await db.execute(select(User).where(User.username == payload.username))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        login_throttle.record_failure(throttle_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )
    login_throttle.reset(throttle_key)
    token = create_access_token(subject=user.id)
    logger.info("user login id=%s", user.id)
    return LoginResponse(
        access_token=token,
        salt=user.password_salt,
        kdf_version=user.kdf_version,
    )


@router.post("/refresh", response_model=RefreshResponse)
async def refresh(
    current_user: User = Depends(get_current_user),
    source_token: str = Depends(oauth2_scheme),
) -> RefreshResponse:
    try:
        started_at = validate_refresh_session(
            decode_access_token(source_token),
            max_age=timedelta(minutes=settings.session_absolute_expire_minutes),
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session lifetime exceeded",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None
    token = create_access_token(
        subject=current_user.id,
        session_started_at=started_at,
    )
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
    zone = getattr(current_user, "timezone", None) or DEFAULT_TIMEZONE
    return MeResponse(
        id=current_user.id,
        username=current_user.username,
        timezone=zone,
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


@router.put("/timezone", response_model=MeResponse)
async def put_timezone(
    payload: TimezonePut,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeResponse:
    try:
        zone = validate_timezone(payload.timezone)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_timezone") from None
    current_user.timezone = zone
    await db.commit()
    await db.refresh(current_user)
    return MeResponse(id=current_user.id, username=current_user.username, timezone=zone)
