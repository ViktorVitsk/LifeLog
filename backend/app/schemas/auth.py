from uuid import UUID

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=256)
    timezone: str | None = Field(default=None, max_length=64)


class RegisterResponse(BaseModel):
    """
    Returned to the client so it can immediately derive KEK = PBKDF2(password, salt).
    `salt` is a hex-encoded 32-byte random value stored in `users.password_salt`.
    """
    salt: str


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    salt: str


class RefreshResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeResponse(BaseModel):
    id: UUID
    username: str
    timezone: str = "UTC"
    encrypted_kek_verifier_content: str | None = None
    encrypted_kek_verifier_dek: str | None = None


class TimezonePut(BaseModel):
    timezone: str = Field(min_length=1, max_length=64)


class KekVerifierPut(BaseModel):
    encrypted_content: str = Field(min_length=16, max_length=16_384)
    encrypted_dek: str = Field(min_length=16, max_length=16_384)
