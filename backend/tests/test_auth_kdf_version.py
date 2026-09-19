from app.schemas.auth import LoginResponse, RegisterResponse


def test_auth_responses_default_to_current_kdf_version():
    registered = RegisterResponse(salt="00")
    logged_in = LoginResponse(access_token="token", salt="00")

    assert registered.kdf_version == 1
    assert logged_in.kdf_version == 1
