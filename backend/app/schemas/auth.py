from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=256)


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
