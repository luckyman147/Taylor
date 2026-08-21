"""ResumeData validator guarantees unique entry ids.

Every list entry the LLM/services produce defaults to ``id=0``; the frontend
builder targets entries by ``item.id``, so duplicate ids would make one edit
apply to every entry sharing that id. The validator must renumber zeros and
duplicates while preserving already-unique positive ids.
"""

from app.schemas import ResumeData


def test_no_ids_get_sequential_ids_per_list() -> None:
    data = ResumeData.model_validate(
        {
            "workExperience": [{"title": "A"}, {"title": "B"}],
            "education": [{"institution": "MIT"}, {"institution": "Stanford"}],
            "personalProjects": [{"name": "Alpha"}, {"name": "Beta"}, {"name": "Gamma"}],
        }
    )
    assert [e.id for e in data.workExperience] == [1, 2]
    assert [e.id for e in data.education] == [1, 2]
    assert [p.id for p in data.personalProjects] == [1, 2, 3]


def test_duplicate_ids_are_renumbered() -> None:
    data = ResumeData.model_validate(
        {
            "personalProjects": [
                {"id": 0, "name": "Alpha"},
                {"id": 0, "name": "Beta"},
                {"id": 0, "name": "Gamma"},
            ]
        }
    )
    assert [p.id for p in data.personalProjects] == [1, 2, 3]


def test_valid_unique_ids_are_preserved() -> None:
    data = ResumeData.model_validate(
        {
            "workExperience": [{"id": 5, "title": "A"}, {"id": 9, "title": "B"}],
        }
    )
    assert [e.id for e in data.workExperience] == [5, 9]


def test_mixed_ids_keep_valid_and_fix_duplicates() -> None:
    data = ResumeData.model_validate(
        {
            "workExperience": [
                {"id": 3, "title": "A"},
                {"id": 3, "title": "B"},
                {"title": "C"},
                {"id": 7, "title": "D"},
            ]
        }
    )
    # 3 kept, second 3 -> 1, missing id -> 2, 7 kept.
    assert [e.id for e in data.workExperience] == [3, 1, 2, 7]


def test_custom_section_items_are_renumbered() -> None:
    data = ResumeData.model_validate(
        {
            "customSections": {
                "custom_1": {
                    "sectionType": "itemList",
                    "items": [{"title": "X"}, {"title": "Y"}],
                }
            }
        }
    )
    items = data.customSections["custom_1"].items or []
    assert [i.id for i in items] == [1, 2]