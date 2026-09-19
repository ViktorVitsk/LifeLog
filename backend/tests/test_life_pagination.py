from app.schemas.life import LifeBundle


def test_life_bundle_exposes_page_cursor():
    bundle = LifeBundle(
        goals=[],
        memory=[],
        actions=[],
        feedback=[],
        offset=20,
        limit=10,
        next_offset=30,
    )

    assert bundle.offset == 20
    assert bundle.limit == 10
    assert bundle.next_offset == 30
