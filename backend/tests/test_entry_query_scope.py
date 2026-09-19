from uuid import uuid4

from app.api.entries import _existing_entries_query


def test_existing_entry_lookup_is_scoped_to_current_owner():
    user_id = uuid4()
    statement = _existing_entries_query([uuid4()], user_id)
    compiled = statement.compile()

    assert "entries.user_id" in str(compiled)
    assert user_id in compiled.params.values()
