"""Contact-tracker endpoints."""

import logging
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Form, HTTPException, UploadFile

from app.database import db
from app.import_utils import (
    detect_mapped_headers,
    normalize_header,
    normalize_record,
    parse_mapping,
    read_upload,
)
from app.schemas import (
    ContactActionResponse,
    ContactBulkDelete,
    ContactCreate,
    ContactGoal,
    ContactImportError,
    ContactImportResponse,
    ContactListResponse,
    ContactRelationship,
    ContactResponse,
    ContactStatus,
    ContactUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/contacts", tags=["Contact Tracker"])

# Header aliases — normalized (lowercased, stripped of spaces/underscores/
# dashes/apostrophes) so CSV/Excel columns can vary between files.
_FIELD_ALIASES: dict[str, set[str]] = {
    "name": {"name", "fullname", "full_name", "contactname", "contact"},
    "email": {"email", "e_mail", "emailaddress", "email_address", "mail", "emailaddr"},
    "company": {"company", "companyname", "company_name", "organization", "organisation", "org"},
    "location": {"location", "city", "citystate", "region", "country"},
    "goal": {"goal", "objective", "purpose", "goaltype"},
    "status": {"status", "state", "phase", "stage"},
    "relationship": {"relationship", "relation", "connection", "howiknow", "how_i_know"},
    "follow_up_date": {
        "followupdate",
        "follow_up_date",
        "followupdate",
        "followup",
        "nextfollowup",
        "date",
    },
    "description": {"description", "desc", "notes", "note", "about", "bio", "biography"},
    "linkedin_url": {"linkedin", "linkedinurl", "linkedin_url", "linkedinprofile", "linkedin_profile", "profileurl"},
    "website_url": {"website", "websiteurl", "website_url", "url", "homepage", "personalwebsite", "portfolio"},
}

# Order used for the auto-detected mapping payload and the mapping UI.
_IMPORT_FIELDS: list[str] = [
    "name",
    "email",
    "company",
    "location",
    "goal",
    "status",
    "relationship",
    "follow_up_date",
    "description",
    "linkedin_url",
    "website_url",
]

_GOAL_VALUES = {g.value for g in ContactGoal}
_STATUS_VALUES = {s.value for s in ContactStatus}
_RELATIONSHIP_VALUES = {r.value for r in ContactRelationship}
_GOAL_BY_NORMALIZED = {normalize_header(value): value for value in _GOAL_VALUES}
_STATUS_BY_NORMALIZED = {normalize_header(value): value for value in _STATUS_VALUES}
_RELATIONSHIP_ALIASES: dict[str, str] = {
    "self": "self",
    "coworker": "coworker",
    "co-worker": "coworker",
    "friend": "friend",
    "family": "family",
    "other": "other",
    "recruiter": "recruiter",
    "mentor": "mentor",
    "hiringmanager": "hiring_manager",
    "hiring_manager": "hiring_manager",
    "hiring manager": "hiring_manager",
    "alumni": "alumni",
    "alumnus": "alumni",
    "alumna": "alumni",
}


def _parse_goal(raw: Any) -> str | None:
    if raw is None:
        return None
    value = str(raw).strip()
    if not value:
        return None
    return _GOAL_BY_NORMALIZED.get(normalize_header(value))


def _parse_status(raw: Any) -> str | None:
    if raw is None:
        return None
    value = str(raw).strip()
    if not value:
        return None
    return _STATUS_BY_NORMALIZED.get(normalize_header(value))


def _parse_relationship(raw: Any) -> str | None:
    if raw is None:
        return None
    value = str(raw).strip()
    if not value:
        return None
    lowered = normalize_header(value)
    return _RELATIONSHIP_ALIASES.get(lowered)


def _parse_follow_up_date(raw: Any) -> str | None:
    """Accept ``YYYY-MM-DD`` (optionally with a time suffix) or ``DD/MM/YYYY``."""
    if raw is None:
        return None
    value = str(raw).strip()
    if not value:
        return None
    if isinstance(raw, datetime):
        return raw.date().isoformat()
    try:
        return date.fromisoformat(value[:10]).isoformat()
    except ValueError:
        parts = value.split("/")
        try:
            if len(parts) == 3 and len(parts[2]) == 4:
                return date(int(parts[2]), int(parts[1]), int(parts[0])).isoformat()
        except ValueError:
            return None
        return None


@router.post("/import/headers")
async def import_headers(file: UploadFile) -> dict[str, Any]:
    """Return the detected column headers of a CSV/Excel file plus which
    contact fields already match them (no rows are read or written)."""
    rows, _ = await read_upload(file)
    headers = [str(header) for header in (rows[0].keys() if rows else [])]
    detected = detect_mapped_headers(headers, _FIELD_ALIASES, _IMPORT_FIELDS)
    return {"headers": headers, "detected": detected}


@router.post("/import", response_model=ContactImportResponse)
async def import_contacts(
    file: UploadFile, mapping: str | None = Form(default=None)
) -> ContactImportResponse:
    """Import contacts from a CSV or Excel (.xlsx) upload.

    Headers are matched flexibly (see ``_FIELD_ALIASES``) unless a JSON
    ``mapping`` form field ({field: exact header}) pins columns to fields;
    rows whose name already exists are skipped (case-insensitive dedupe);
    rows with invalid values are reported per-row without failing the import.
    """
    rows, _ = await read_upload(file)
    mapping_by_field = parse_mapping(mapping, _FIELD_ALIASES)

    created = 0
    skipped = 0
    errors: list[ContactImportError] = []
    for row_index, record in enumerate(rows, start=2):
        if not any(value.strip() for value in record.values()):
            continue  # blank line
        normalized = normalize_record(record, _FIELD_ALIASES, mapping_by_field)
        name = normalized.get("name", "").strip()
        if not name:
            errors.append(ContactImportError(row=row_index, error="Missing contact name."))
            continue

        goal = _parse_goal(normalized.get("goal"))
        status = _parse_status(normalized.get("status"))
        relationship = _parse_relationship(normalized.get("relationship"))
        follow_up_date = _parse_follow_up_date(normalized.get("follow_up_date"))
        invalid_fields: list[str] = []
        if goal is None and normalized.get("goal", "").strip():
            invalid_fields.append(f"Unknown goal: {normalized['goal'].strip()}")
        if status is None and normalized.get("status", "").strip():
            invalid_fields.append(f"Unknown status: {normalized['status'].strip()}")
        if relationship is None and normalized.get("relationship", "").strip():
            invalid_fields.append(f"Unknown relationship: {normalized['relationship'].strip()}")
        if (
            follow_up_date is None
            and normalized.get("follow_up_date", "").strip()
        ):
            invalid_fields.append(
                f"Invalid follow-up date: {normalized['follow_up_date'].strip()}"
            )
        if invalid_fields:
            errors.append(
                ContactImportError(
                    row=row_index, name=name, error="; ".join(invalid_fields)
                )
            )
            continue

        try:
            existing = await db.get_contact_by_name(name)
            if existing is not None:
                skipped += 1
                continue
            await db.create_contact(
                name=name,
                email=normalized.get("email", "").strip() or None,
                company=normalized.get("company", "").strip() or None,
                location=normalized.get("location", "").strip() or None,
                goal=goal,
                status=status,
                relationship=relationship,
                follow_up_date=follow_up_date,
                description=normalized.get("description", "").strip() or None,
                linkedin_url=normalized.get("linkedin_url", "").strip() or None,
                website_url=normalized.get("website_url", "").strip() or None,
            )
            created += 1
        except Exception as e:
            logger.warning("Failed to import contact %r (row %d): %s", name, row_index, e)
            errors.append(ContactImportError(row=row_index, name=name, error="Import failed."))

    logger.info("Contact import: %d created, %d skipped, %d errors", created, skipped, len(errors))
    return ContactImportResponse(created=created, skipped=skipped, errors=errors)


@router.get("", response_model=ContactListResponse)
async def list_contacts() -> ContactListResponse:
    """List all tracked contacts (ordered by name)."""
    try:
        contacts = await db.list_contacts()
    except Exception as e:
        logger.error("Failed to list contacts: %s", e)
        raise HTTPException(status_code=500, detail="Failed to load contacts. Please try again.")
    return ContactListResponse(contacts=[ContactResponse(**c) for c in contacts])


@router.post("", response_model=ContactResponse, status_code=201)
async def create_contact(request: ContactCreate) -> ContactResponse:
    """Create a contact; dedupes (case-insensitively) on name.

    Creating a contact whose name already exists returns the existing row so
    double-submits never duplicate entries.
    """
    payload = request.model_dump()
    if "goal" in payload and payload["goal"] is not None:
        payload["goal"] = request.goal.value
    if "status" in payload and payload["status"] is not None:
        payload["status"] = request.status.value
    if "relationship" in payload and payload["relationship"] is not None:
        payload["relationship"] = request.relationship.value
    try:
        contact = await db.create_contact(**payload)
    except Exception as e:
        logger.error("Failed to create contact: %s", e)
        raise HTTPException(status_code=500, detail="Failed to create contact. Please try again.")
    return ContactResponse(**contact)


@router.get("/{contact_id}", response_model=ContactResponse)
async def get_contact(contact_id: str) -> ContactResponse:
    """Get a contact by ID."""
    contact = await db.get_contact(contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    return ContactResponse(**contact)


@router.patch("/{contact_id}", response_model=ContactResponse)
async def update_contact(contact_id: str, request: ContactUpdate) -> ContactResponse:
    """Update a contact's fields (partial)."""
    updates = request.model_dump(exclude_unset=True)
    for key in ("goal", "status", "relationship"):
        if key in updates and updates[key] is not None:
            updates[key] = getattr(request, key).value
    try:
        updated = await db.update_contact(contact_id, updates)
    except ValueError as e:
        logger.warning("Contact update conflict for %s: %s", contact_id, e)
        raise HTTPException(status_code=409, detail="A contact with this name already exists.")
    except Exception as e:
        logger.error("Failed to update contact %s: %s", contact_id, e)
        raise HTTPException(status_code=500, detail="Failed to update contact. Please try again.")
    if updated is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    return ContactResponse(**updated)


@router.post("/bulk-delete", response_model=ContactActionResponse)
async def bulk_delete_contacts(request: ContactBulkDelete) -> ContactActionResponse:
    """Delete many contacts at once (missing ids are skipped)."""
    try:
        deleted = await db.bulk_delete_contacts(request.contact_ids)
    except Exception as e:
        logger.error("Failed to bulk-delete contacts: %s", e)
        raise HTTPException(
            status_code=500, detail="Failed to delete contacts. Please try again."
        )
    return ContactActionResponse(message=f"Deleted {deleted} contact(s)", affected=deleted)


@router.delete("/{contact_id}", response_model=ContactActionResponse)
async def delete_contact(contact_id: str) -> ContactActionResponse:
    """Delete a contact."""
    try:
        deleted = await db.delete_contact(contact_id)
    except Exception as e:
        logger.error("Failed to delete contact %s: %s", contact_id, e)
        raise HTTPException(status_code=500, detail="Failed to delete contact. Please try again.")
    if not deleted:
        raise HTTPException(status_code=404, detail="Contact not found")
    return ContactActionResponse(message="Contact deleted", affected=1)