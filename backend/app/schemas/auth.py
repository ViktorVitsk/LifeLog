from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=256)
    timezone: str | None = Field(default=None, max_length=64)

    @field_validator("password")
    @classmethod
    def password_fits_bcrypt(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("password_too_long_utf8")
        return value


class RegisterResponse(BaseModel):
    """
    Returned to the client so it can immediately derive KEK = PBKDF2(password, salt).
    `salt` is a hex-encoded 32-byte random value stored in `users.password_salt`.
    """
    salt: str
    kdf_version: int = 1


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    # Historical registration allowed up to 256 Unicode characters.
    password: str = Field(min_length=1, max_length=256)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    salt: str
    kdf_version: int = 1


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
