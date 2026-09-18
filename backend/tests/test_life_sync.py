from app.services.life_sync import decide_life_item


def test_create_update_and_owner_links_are_separate():
    incoming = {
        "encrypted_dek": "dek",
        "encrypted_content": "ct",
        "state": "draft",
        "version": 1,
    }
    assert decide_life_item(incoming, None) == ("created", None)

    existing = {**incoming, "version": 1, "deleted_at": None}
    assert decide_life_item(incoming, existing) == ("duplicate", None)

    changed = {**incoming, "encrypted_content": "ct-2", "version": 1}
    assert decide_life_item(changed, existing) == ("updated", None)

    stale = {**changed, "version": 0}
    assert decide_life_item(stale, existing) == ("conflict", "version_mismatch")


def test_accept_is_an_update_not_a_new_row():
    existing = {
        "encrypted_dek": "dek",
        "encrypted_content": "ct",
        "state": "proposed",
        "version": 1,
        "deleted_at": None,
    }
    incoming = {**existing, "state": "accepted", "version": 1}
    assert decide_life_item(incoming, existing)[0] == "updated"
