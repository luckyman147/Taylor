"""Company discovery router — profile-driven company search and actions."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from app.database import db
from app.schemas.applications import ApplicationStatus
from app.schemas.discovery import (
    ApplyDiscoveredRequest,
    DiscoverRequest,
    DiscoveryStatus,
    DiscoveredCompanyListResponse,
    DiscoveredCompanyResponse,
    DiscoverResponse,
    SaveDiscoveredRequest,
)
from app.services.company_discovery import discover_companies

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/discovery", tags=["Company Discovery"])


@router.post("/search", response_model=DiscoverResponse)
async def search_companies(request: DiscoverRequest) -> DiscoverResponse:
    """Run the full multi-source discovery pipeline and return scored companies."""
    try:
        result = await discover_companies(
            resume_id=request.resume_id,
            keywords=request.keywords,
            locations=request.locations,
            sources=request.sources,
        )
        companies = [
            DiscoveredCompanyResponse(**c, status=DiscoveryStatus(c.get("status", "new")))
            for c in result["companies"]
        ]
        return DiscoverResponse(search_id=result["search_id"], companies=companies)
    except Exception as exc:
        logger.error("Discovery search failed: %s", exc)
        raise HTTPException(status_code=500, detail="Company discovery failed. Please try again.")


@router.get("", response_model=DiscoveredCompanyListResponse)
async def list_discovered(search_id: str | None = None, status: str | None = None) -> DiscoveredCompanyListResponse:
    """List previously discovered companies, optionally filtered by search_id and/or status."""
    try:
        companies_data = await db.list_discovered_companies(search_id=search_id, status=status)
        companies = [DiscoveredCompanyResponse(**c, status=DiscoveryStatus(c.get("status", "new"))) for c in companies_data]
        return DiscoveredCompanyListResponse(companies=companies)
    except Exception as exc:
        logger.error("List discovered companies failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to list discovered companies.")


@router.post("/{discovered_id}/save", response_model=DiscoveredCompanyResponse)
async def save_discovered(discovered_id: str, request: SaveDiscoveredRequest) -> DiscoveredCompanyResponse:
    """Save a discovered company to the tracker (creates/updates Company with status=watching)."""
    try:
        discovered = await db.get_discovered_company(discovered_id)
        if not discovered:
            raise HTTPException(status_code=404, detail="Discovered company not found")

        company = await db.get_company_by_name(discovered["name"])
        if company:
            await db.update_company(company["company_id"], {"status": "watching"})
            company_id = company["company_id"]
        else:
            created = await db.create_company(
                name=discovered["name"],
                website=discovered.get("website"),
                industry=discovered.get("industry"),
                description=discovered.get("description"),
                status="watching",
            )
            company_id = created["company_id"]

        updated = await db.update_discovered_company(discovered_id, {"status": "saved", "company_id": company_id})
        if not updated:
            raise HTTPException(status_code=404, detail="Discovered company not found")

        return DiscoveredCompanyResponse(**updated, status=DiscoveryStatus.saved)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Save discovered company failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to save company.")


@router.post("/{discovered_id}/apply", response_model=dict[str, Any])
async def apply_to_discovered(discovered_id: str, request: ApplyDiscoveredRequest) -> dict[str, Any]:
    """Apply to a discovered company: creates Job + Application card, links/creates Company with status=applied."""
    try:
        discovered = await db.get_discovered_company(discovered_id)
        if not discovered:
            raise HTTPException(status_code=404, detail="Discovered company not found")

        resume = await db.get_resume(request.resume_id)
        if not resume:
            raise HTTPException(status_code=404, detail="Resume not found")

        job_description = request.job_description or f"Application to {discovered['name']}"
        from app.services.improver import extract_job_keywords

        keywords_result = await extract_job_keywords(job_description)
        company_name = keywords_result.get("company") or discovered["name"]
        role = keywords_result.get("role") or "Position"

        from app.database import _now
        from uuid import uuid4
        from app.models import Job

        now = _now()
        job_id = str(uuid4())
        async with db._session() as session:
            job_row = Job(
                job_id=job_id,
                content=job_description,
                resume_id=request.resume_id,
                created_at=now,
            )
            session.add(job_row)
            await session.flush()

            from app.models import Application
            app_id = str(uuid4())
            app_row = Application(
                application_id=app_id,
                job_id=job_id,
                resume_id=request.resume_id,
                master_resume_id=resume.get("parent_id") or request.resume_id,
                status=ApplicationStatus.applied.value,
                company=company_name,
                role=role,
                applied_at=now,
                position=0,
                created_at=now,
                updated_at=now,
            )
            session.add(app_row)
            await session.commit()

        company = await db.get_company_by_name(company_name)
        if company:
            await db.update_company(company["company_id"], {"status": "applied"})
            final_company_id = company["company_id"]
        else:
            created = await db.create_company(
                name=company_name,
                website=discovered.get("website"),
                industry=discovered.get("industry"),
                description=discovered.get("description"),
                status="applied",
            )
            final_company_id = created["company_id"]

        await db.update_discovered_company(discovered_id, {"status": "applied", "company_id": final_company_id})

        return {
            "success": True,
            "message": "Application created successfully",
            "application_id": app_id,
            "company_id": final_company_id,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Apply to discovered company failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to create application.")


@router.post("/{discovered_id}/dismiss", response_model=DiscoveredCompanyResponse)
async def dismiss_discovered(discovered_id: str) -> DiscoveredCompanyResponse:
    """Dismiss a discovered company (hide from future results)."""
    try:
        updated = await db.update_discovered_company(discovered_id, {"status": "dismissed"})
        if not updated:
            raise HTTPException(status_code=404, detail="Discovered company not found")
        return DiscoveredCompanyResponse(**updated, status=DiscoveryStatus.dismissed)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Dismiss discovered company failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to dismiss company.")