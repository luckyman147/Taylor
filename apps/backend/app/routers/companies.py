"""Company-tracker endpoints."""

import logging
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
    CompanyActionResponse,
    CompanyBulkDelete,
    CompanyCreate,
    CompanyImportError,
    CompanyImportResponse,
    CompanyListResponse,
    CompanyResponse,
    CompanySize,
    CompanyStatus,
    CompanyType,
    CompanyUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/companies", tags=["Company Tracker"])

# Header aliases — normalized (lowercased, stripped of spaces/underscores/
# dashes/apostrophes) so CSV/Excel columns can vary between files.
_FIELD_ALIASES: dict[str, set[str]] = {
    "name": {"name", "company", "companyname", "company_name"},
    "email": {"email", "e-mail", "mail"},
    "phone": {"phone", "phonenumber", "phone_number", "contact", "tel", "telephone", "mobile", "cell"},
    "address": {"address", "streetaddress", "street", "location"},
    "website": {"website", "websiteurl", "website_url", "site", "url", "web", "homepage"},
    "company_size": {"companysize", "size", "employees", "headcount", "employeescount"},
    "company_type": {"companytype", "type", "category"},
    "linkedin_url": {"linkedin", "linkedinurl", "linkedin_url", "linkedinlink", "linkedinlinkurl"},
    "industry": {"industry", "sector", "industries"},
    "status": {"status", "state", "phase", "stage"},
    "year_founded": {"yearfounded", "founded", "foundingyear", "year", "foundedyear"},
}

# Order used for the auto-detected mapping payload and the mapping UI.
_IMPORT_FIELDS: list[str] = [
    "name",
    "email",
    "phone",
    "address",
    "website",
    "company_size",
    "company_type",
    "linkedin_url",
    "industry",
    "status",
    "year_founded",
]

_SIZE_VALUES = {s.value for s in CompanySize}
_TYPE_VALUES = {t.value for t in CompanyType}
_STATUS_VALUES = {s.value for s in CompanyStatus}


def _parse_size(raw: Any) -> str | None:
    """Accept enum values plus friendly forms like '51-200 employees'."""
    if raw is None:
        return None
    value = str(raw).strip()
    if not value:
        return None
    lowered = normalize_header(value)
    if lowered in _SIZE_VALUES:
        return lowered
    # Friendly suffix: "1-10 employees" / "1000+ employees"
    for candidate in _SIZE_VALUES:
        if lowered.startswith(normalize_header(candidate)):
            return candidate
    return None


def _parse_type(raw: Any) -> str | None:
    if raw is None:
        return None
    value = str(raw).strip()
    if not value:
        return None
    lowered = normalize_header(value)
    return lowered if lowered in _TYPE_VALUES else None


def _parse_status(raw: Any) -> str | None:
    if raw is None:
        return None
    value = str(raw).strip()
    if not value:
        return None
    lowered = normalize_header(value)
    return lowered if lowered in _STATUS_VALUES else None


def _parse_year(raw: Any) -> int | None:
    if raw is None:
        return None
    if isinstance(raw, int) and not isinstance(raw, bool):
        return raw
    value = str(raw).strip()
    if not value:
        return None
    if not value.isdigit():
        return None
    year = int(value)
    return year if 1600 <= year <= 2100 else None


@router.post("/import/headers")
async def import_headers(file: UploadFile) -> dict[str, Any]:
    """Return the detected column headers of a CSV/Excel file plus which
    company fields already match them (no rows are read or written)."""
    rows, _ = await read_upload(file)
    headers = [str(header) for header in (rows[0].keys() if rows else [])]
    detected = detect_mapped_headers(headers, _FIELD_ALIASES, _IMPORT_FIELDS)
    return {"headers": headers, "detected": detected}


@router.post("/import", response_model=CompanyImportResponse)
async def import_companies(
    file: UploadFile, mapping: str | None = Form(default=None)
) -> CompanyImportResponse:
    """Import companies from a CSV or Excel (.xlsx) upload.

    Headers are matched flexibly (see ``_FIELD_ALIASES``) unless a JSON
    ``mapping`` form field ({field: exact header}) pins columns to fields;
    rows whose name already exists are skipped (case-insensitive dedupe);
    rows with invalid values are reported per-row without failing the import.
    """
    rows, _ = await read_upload(file)
    mapping_by_field = parse_mapping(mapping, _FIELD_ALIASES)

    created = 0
    skipped = 0
    errors: list[CompanyImportError] = []
    for row_index, record in enumerate(rows, start=2):
        if not any(value.strip() for value in record.values()):
            continue  # blank line
        normalized = normalize_record(record, _FIELD_ALIASES, mapping_by_field)
        name = normalized.get("name", "").strip()
        if not name:
            errors.append(CompanyImportError(row=row_index, error="Missing company name."))
            continue

        company_size = _parse_size(normalized.get("company_size"))
        company_type = _parse_type(normalized.get("company_type"))
        status = _parse_status(normalized.get("status"))
        year_founded = _parse_year(normalized.get("year_founded"))
        if company_size is None and normalized.get("company_size", "").strip():
            errors.append(
                CompanyImportError(
                    row=row_index,
                    name=name,
                    error=f"Unknown company size: {normalized['company_size'].strip()}",
                )
            )
            continue
        if company_type is None and normalized.get("company_type", "").strip():
            errors.append(
                CompanyImportError(
                    row=row_index,
                    name=name,
                    error=f"Unknown company type: {normalized['company_type'].strip()}",
                )
            )
            continue
        if status is None and normalized.get("status", "").strip():
            errors.append(
                CompanyImportError(
                    row=row_index,
                    name=name,
                    error=f"Unknown company status: {normalized['status'].strip()}",
                )
            )
            continue
        if year_founded is None and normalized.get("year_founded", "").strip():
            errors.append(
                CompanyImportError(
                    row=row_index,
                    name=name,
                    error=f"Invalid year founded: {normalized['year_founded'].strip()}",
                )
            )
            continue

        try:
            existing = await db.get_company_by_name(name)
            if existing is not None:
                skipped += 1
                continue
            await db.create_company(
                name=name,
                email=normalized.get("email", "").strip() or None,
                phone=normalized.get("phone", "").strip() or None,
                address=normalized.get("address", "").strip() or None,
                website=normalized.get("website", "").strip() or None,
                company_size=company_size,
                company_type=company_type,
                linkedin_url=normalized.get("linkedin_url", "").strip() or None,
                industry=normalized.get("industry", "").strip() or None,
                status=status,
                year_founded=year_founded,
            )
            created += 1
        except Exception as e:
            logger.warning("Failed to import company %r (row %d): %s", name, row_index, e)
            errors.append(CompanyImportError(row=row_index, name=name, error="Import failed."))

    logger.info("Company import: %d created, %d skipped, %d errors", created, skipped, len(errors))
    return CompanyImportResponse(created=created, skipped=skipped, errors=errors)


@router.get("", response_model=CompanyListResponse)
async def list_companies() -> CompanyListResponse:
    """List all tracked companies (ordered by name)."""
    try:
        companies = await db.list_companies()
    except Exception as e:
        logger.error("Failed to list companies: %s", e)
        raise HTTPException(status_code=500, detail="Failed to load companies. Please try again.")
    return CompanyListResponse(companies=[CompanyResponse(**c) for c in companies])


@router.post("", response_model=CompanyResponse, status_code=201)
async def create_company(request: CompanyCreate) -> CompanyResponse:
    """Create a company; dedupes (case-insensitively) on name.

    Creating a company whose name already exists returns the existing row so
    double-submits never duplicate entries.
    """
    payload = request.model_dump()
    if "company_size" in payload and payload["company_size"] is not None:
        payload["company_size"] = request.company_size.value
    if "company_type" in payload and payload["company_type"] is not None:
        payload["company_type"] = request.company_type.value
    if "status" in payload and payload["status"] is not None:
        payload["status"] = request.status.value
    try:
        company = await db.create_company(**payload)
    except Exception as e:
        logger.error("Failed to create company: %s", e)
        raise HTTPException(status_code=500, detail="Failed to create company. Please try again.")
    return CompanyResponse(**company)


@router.get("/{company_id}", response_model=CompanyResponse)
async def get_company(company_id: str) -> CompanyResponse:
    """Get a company by ID."""
    company = await db.get_company(company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    return CompanyResponse(**company)


@router.patch("/{company_id}", response_model=CompanyResponse)
async def update_company(company_id: str, request: CompanyUpdate) -> CompanyResponse:
    """Update a company's fields (partial)."""
    updates = request.model_dump(exclude_unset=True)
    for key in ("company_size", "company_type", "status"):
        if key in updates and updates[key] is not None:
            updates[key] = getattr(request, key).value
    try:
        updated = await db.update_company(company_id, updates)
    except ValueError as e:
        logger.warning("Company update conflict for %s: %s", company_id, e)
        raise HTTPException(status_code=409, detail="A company with this name already exists.")
    except Exception as e:
        logger.error("Failed to update company %s: %s", company_id, e)
        raise HTTPException(status_code=500, detail="Failed to update company. Please try again.")
    if updated is None:
        raise HTTPException(status_code=404, detail="Company not found")
    return CompanyResponse(**updated)


@router.post("/bulk-delete", response_model=CompanyActionResponse)
async def bulk_delete_companies(request: CompanyBulkDelete) -> CompanyActionResponse:
    """Delete many companies at once (missing ids are skipped)."""
    try:
        deleted = await db.bulk_delete_companies(request.company_ids)
    except Exception as e:
        logger.error("Failed to bulk-delete companies: %s", e)
        raise HTTPException(
            status_code=500, detail="Failed to delete companies. Please try again."
        )
    return CompanyActionResponse(message=f"Deleted {deleted} company(s)", affected=deleted)


@router.delete("/{company_id}", response_model=CompanyActionResponse)
async def delete_company(company_id: str) -> CompanyActionResponse:
    """Delete a company."""
    try:
        deleted = await db.delete_company(company_id)
    except Exception as e:
        logger.error("Failed to delete company %s: %s", company_id, e)
        raise HTTPException(status_code=500, detail="Failed to delete company. Please try again.")
    if not deleted:
        raise HTTPException(status_code=404, detail="Company not found")
    return CompanyActionResponse(message="Company deleted", affected=1)
