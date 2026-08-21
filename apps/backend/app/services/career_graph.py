"""Career graph: seeding the profile from a resume and skill↔entry edges.

The single source of truth for "import a resume → fulfill the career graph":
the manual ``POST /profile/seed-from-master`` endpoint and the automatic
fulfillment after a master-resume upload both call
``fulfill_profile_from_resume`` here, so the semantics can't drift apart.
"""

import logging
from typing import Any

from app.database import db
from app.schemas.models import _split_list_entries
from app.services.career_profile import (
    _SKILL_CATALOG,
    _matches_description,
    _skill_search_terms,
)

logger = logging.getLogger(__name__)

# Personal-info keys seedable from the resume's personalInfo.
_SEEDABLE_FIELDS = (
    "name",
    "title",
    "email",
    "phone",
    "location",
    "website",
    "linkedin",
    "github",
)


def _work_experience_from_resume(processed: dict[str, Any]) -> list[dict[str, Any]]:
    """Map the resume's ``workExperience`` section to profile work entries."""
    items: list[dict[str, Any]] = []
    for entry in processed.get("workExperience") or []:
        if not isinstance(entry, dict):
            continue
        role = str(entry.get("title") or "").strip()
        company = str(entry.get("company") or "").strip()
        if not role and not company:
            continue
        items.append(
            {
                "role": role,
                "company": company or None,
                "location": str(entry.get("location") or "").strip() or None,
                "years": str(entry.get("years") or "").strip() or None,
                "description": [
                    bullet.strip()
                    for bullet in (entry.get("description") or [])
                    if str(bullet).strip()
                ],
            }
        )
    return items


def _string_list_from_resume(processed: dict[str, Any], key: str) -> list[str]:
    """Pull a free-text list (languages/awards) from the resume's additional block.

    Entries are split on commas/semicolons so merged strings like
    "English, French" become separate items (defense for resumes parsed
    before comma-splitting was normalized at parse time).
    """
    additional = processed.get("additional") or {}
    raw = additional.get(key) or []
    items = [str(item).strip() for item in raw if str(item).strip()]
    entries: list[str] = []
    for item in items:
        entries.extend(_split_list_entries(item))
    return entries


def _technical_skills_from_resume(processed: dict[str, Any]) -> list[str]:
    """The resume's technical skills, comma-split and deduped."""
    additional = processed.get("additional") or {}
    names = [str(name).strip() for name in additional.get("technicalSkills") or []]
    return list(
        dict.fromkeys(
            split
            for name in names
            for split in _split_list_entries(name)
            if split
        )
    )


def _education_from_resume(processed: dict[str, Any]) -> list[dict[str, Any]]:
    """Map the resume's ``education`` section to graph entries."""
    items: list[dict[str, Any]] = []
    for entry in processed.get("education") or []:
        if not isinstance(entry, dict):
            continue
        institution = str(entry.get("institution") or "").strip()
        degree = str(entry.get("degree") or "").strip()
        if not institution and not degree:
            continue
        items.append(
            {
                "institution": institution,
                "degree": degree or None,
                "years": str(entry.get("years") or "").strip() or None,
                "description": str(entry.get("description") or "").strip() or None,
            }
        )
    return items


def _projects_from_resume(processed: dict[str, Any]) -> list[dict[str, Any]]:
    """Map the resume's ``personalProjects`` section to graph entries."""
    items: list[dict[str, Any]] = []
    for entry in processed.get("personalProjects") or []:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "").strip()
        if not name:
            continue
        items.append(
            {
                "name": name,
                "role": str(entry.get("role") or "").strip() or None,
                "years": str(entry.get("years") or "").strip() or None,
                "github": str(entry.get("github") or "").strip() or None,
                "website": str(entry.get("website") or "").strip() or None,
                "description": [
                    bullet.strip()
                    for bullet in (entry.get("description") or [])
                    if str(bullet).strip()
                ],
            }
        )
    return items


def _certifications_from_resume(processed: dict[str, Any]) -> list[dict[str, Any]]:
    """Map the resume's ``additional.certificationsTraining`` to graph entries."""
    items: list[dict[str, Any]] = []
    for name in _string_list_from_resume(processed, "certificationsTraining"):
        items.append({"name": name, "issuer": None, "date_obtained": None, "url": None})
    return items


def extract_entry_skills(entry_text: str, known_skills: list[str]) -> list[str]:
    """Extract skills mentioned in an entry's text, restricted to known skills.

    A skill is linked only when the user actually listed it (in the resume's
    ``technicalSkills``), which keeps prose false positives out of the graph:
    the word "go" in a sentence never creates a "Go" edge. Catalog aliases are
    matched too, so a description saying "k8s" links the user's "Kubernetes"
    skill (stored under the canonical catalog name).
    """
    lowered = entry_text.lower()
    known = {name.lower() for name in known_skills}
    found: list[str] = []
    seen: set[str] = set()

    for skill in known_skills:
        if skill.lower() in seen:
            continue
        if _matches_description(lowered, _skill_search_terms(skill)):
            found.append(skill)
            seen.add(skill.lower())

    for canonical, meta in _SKILL_CATALOG.items():
        key = canonical.lower()
        aliases = meta.get("aliases", [])
        if key in seen:
            continue
        # Link the canonical name only when the user actually knows the skill
        # — either by canonical name or by one of its aliases ("React.js").
        if key not in known and not any(
            alias.lower() in known for alias in aliases
        ):
            continue
        if _matches_description(lowered, [canonical] + aliases):
            found.append(canonical)
            seen.add(key)

    return found


async def _replace_education(items: list[dict[str, Any]]) -> None:
    """Replace the stored education entries with the resume's (deduped)."""
    existing = await db.list_career_education()
    for entry in existing:
        await db.delete_career_education(entry["education_id"])
    seen: set[str] = set()
    for item in items:
        key = f"{item['institution'].lower()}|{(item['degree'] or '').lower()}"
        if key in seen:
            continue
        seen.add(key)
        await db.create_career_education(
            institution=item["institution"],
            degree=item["degree"],
            years=item["years"],
            description=item["description"],
        )


async def _replace_projects(items: list[dict[str, Any]]) -> None:
    """Replace the stored project nodes with the resume's (deduped)."""
    existing = await db.list_career_projects()
    for project in existing:
        await db.delete_career_project(project["project_id"])
    seen: set[str] = set()
    for item in items:
        key = f"{item['name'].lower()}|{(item['role'] or '').lower()}"
        if key in seen:
            continue
        seen.add(key)
        await db.create_career_project(
            name=item["name"],
            role=item["role"],
            years=item["years"],
            github=item["github"],
            website=item["website"],
            description=item["description"],
        )


async def _replace_certifications(items: list[dict[str, Any]]) -> None:
    """Replace the stored certifications with the resume's (deduped)."""
    existing = await db.list_career_certifications()
    for certification in existing:
        await db.delete_career_certification(certification["certification_id"])
    seen: set[str] = set()
    for item in items:
        key = f"{item['name'].lower()}|{(item['issuer'] or '').lower()}"
        if key in seen:
            continue
        seen.add(key)
        await db.create_career_certification(
            name=item["name"],
            issuer=item["issuer"],
            date_obtained=item["date_obtained"],
            url=item["url"],
        )


async def fulfill_profile_from_resume(resume: dict[str, Any]) -> dict[str, Any]:
    """Seed/refresh the profile and career graph from a processed resume.

    Semantics:
    - personal info / summary / work experience replace when the resume has them;
    - languages / awards replace the profile lists when the resume has them;
    - technical skills **merge** into the skill list (never replace);
    - education / projects / certifications **replace** their tables when the
      resume has them (nothing is removed when the resume lacks a section);
    - skill↔entry edges are rebuilt for every experience/project entry and
      orphaned experience edges are pruned.

    Returns the updated profile dict. Callers must wrap this in try/except —
    seeding must never fail the upload that triggered it.
    """
    processed = resume.get("processed_data") or {}
    personal_info = processed.get("personalInfo") or {}
    updates: dict[str, Any] = {
        key: value
        for key, value in personal_info.items()
        if key in _SEEDABLE_FIELDS and isinstance(value, str) and value.strip()
    }
    summary = str(processed.get("summary") or "").strip()
    if summary:
        updates["summary"] = summary

    experience = _work_experience_from_resume(processed)
    if experience:
        updates["work_experience"] = experience
    languages = _string_list_from_resume(processed, "languages")
    if languages:
        updates["languages"] = languages
    awards = _string_list_from_resume(processed, "awards")
    if awards:
        updates["awards"] = awards
    updates["source_resume_id"] = resume["resume_id"]
    updates["source_resume_title"] = resume.get("title") or resume.get("filename") or "Resume"

    updated = await db.update_career_profile(updates)
    await _merge_resume_skills(processed)

    education = _education_from_resume(processed)
    if education:
        await _replace_education(education)
    projects = _projects_from_resume(processed)
    if projects:
        await _replace_projects(projects)
    certifications = _certifications_from_resume(processed)
    if certifications:
        await _replace_certifications(certifications)

    # Rebuild skill edges from the resume's own skills + text (deterministic).
    known_skills = _technical_skills_from_resume(processed)
    if experience:
        for index, entry in enumerate(experience):
            entry_text = " ".join(
                [
                    entry.get("role") or "",
                    entry.get("company") or "",
                    *[bullet for bullet in entry.get("description") or []],
                ]
            )
            linked = extract_entry_skills(entry_text, known_skills)
            await db.set_career_entry_skills("experience", str(index), linked)
        await db.prune_career_experience_edges(set(range(len(experience))))
    for project in await db.list_career_projects():
        entry_text = " ".join(
            [
                project.get("name") or "",
                project.get("role") or "",
                *[bullet for bullet in project.get("description") or []],
            ]
        )
        linked = extract_entry_skills(entry_text, known_skills)
        await db.set_career_entry_skills(
            "project", project["project_id"], linked
        )

    return updated


async def import_education_from_master() -> bool:
    """Sync the education entries from the master resume (replace-when-present).

    Used by the Education tab on load so the tab always reflects the latest
    CV. Returns ``False`` when there is no master resume or it has no
    education section (nothing is removed in that case).
    """
    resume = await db.get_master_resume()
    if resume is None:
        return False
    education = _education_from_resume(resume.get("processed_data") or {})
    if not education:
        return False
    await _replace_education(education)
    return True


async def _merge_resume_skills(processed: dict[str, Any]) -> None:
    """Add the resume's technical skills to the profile (merge, never replace)."""
    names = _technical_skills_from_resume(processed)
    if not names:
        return
    existing = {skill["name"].lower() for skill in await db.list_career_skills()}
    for name in names:
        if name.lower() not in existing:
            await db.create_career_skill(name=name)
            existing.add(name.lower())
