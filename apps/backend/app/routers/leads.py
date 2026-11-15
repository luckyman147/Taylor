"""Lead scraper endpoints — search, triage, save as contact/company."""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.database import db
from app.schemas.leads import (
    LeadActionResponse,
    LeadBulkDeleteRequest,
    LeadBulkSaveRequest,
    LeadCriteriaRequest,
    LeadCriteriaResponse,
    LeadListResponse,
    LeadOut,
    LeadSaveRequest,
    LeadSearchDraftListResponse,
    LeadSearchDraftOut,
    LeadSearchDraftUpsert,
    LeadSearchRequest,
    LeadSearchResponse,
    LeadUpdateRequest,
)
from app.services.lead_scraper import (
    recommend_criteria,
    save_lead,
    save_leads_bulk,
    search_leads,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/leads", tags=["Leads"])


def _to_out(row: dict) -> LeadOut:
    data = dict(row)
    data.setdefault("sources", [row.get("source")] if row.get("source") else [])
    return LeadOut(**data)


@router.post("/recommend-criteria", response_model=LeadCriteriaResponse)
async def post_recommend_criteria(request: LeadCriteriaRequest) -> LeadCriteriaResponse:
    """AI-proposed search criteria — the user reviews before any scraping."""
    try:
        return await recommend_criteria(request)
    except Exception as exc:
        logger.error(f"Recommend criteria failed: {exc}")
        raise HTTPException(
            status_code=500, detail="Could not recommend criteria. Please try again."
        ) from exc


@router.post("/search", response_model=LeadSearchResponse)
async def post_search_leads(request: LeadSearchRequest, stream: bool = False) -> LeadSearchResponse | StreamingResponse:
    """Scrape leads, categorize, dedupe, and persist them.

    ``stream=true`` returns ``text/event-stream``: one ``data:`` JSON line per
    progress event, the last carrying ``phase=done`` with the full
    LeadSearchResponse as ``result``. The search keeps running (and persists)
    even if the client disconnects.
    """
    if not stream:
        try:
            return await search_leads(request)
        except Exception as exc:
            logger.error(f"Lead search failed: {exc}")
            raise HTTPException(
                status_code=500, detail="Lead search failed. Please try again."
            ) from exc

    async def _event_stream():
        queue: asyncio.Queue[dict | None] = asyncio.Queue()

        def emit(event: dict) -> None:
            queue.put_nowait(event)

        async def _run() -> None:
            try:
                result = await search_leads(request, emit=emit)
                queue.put_nowait(
                    {"phase": "done", "result": result.model_dump(mode="json")}
                )
            except Exception as exc:
                logger.error(f"Lead search failed: {exc}")
                queue.put_nowait(
                    {
                        "phase": "error",
                        "detail": "Lead search failed. Please try again.",
                    }
                )
            finally:
                queue.put_nowait(None)

        # Deliberately not cancelled on client disconnect — the search still
        # finishes and persists so the leads appear on the next list load.
        task = asyncio.create_task(_run())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            # Keep a reference until the stream ends so the task isn't GC'd.
            del task

    return StreamingResponse(_event_stream(), media_type="text/event-stream")


@router.get("", response_model=LeadListResponse)
async def list_leads(
    search_id: str | None = None, status: str | None = None, lead_type: str | None = None
) -> LeadListResponse:
    """List stored leads with optional filters."""
    rows = await db.list_leads(search_id=search_id, status=status, lead_type=lead_type)
    return LeadListResponse(leads=[_to_out(r) for r in rows])


# Draft routes must be declared before GET /{lead_id} so "drafts" is not
# captured as a lead id.
@router.get("/drafts", response_model=LeadSearchDraftListResponse)
async def list_lead_drafts() -> LeadSearchDraftListResponse:
    """All saved search-param drafts, most recently updated first."""
    rows = await db.list_lead_search_drafts()
    return LeadSearchDraftListResponse(drafts=[LeadSearchDraftOut(**r) for r in rows])


@router.put("/drafts", response_model=LeadSearchDraftOut)
async def put_lead_draft(request: LeadSearchDraftUpsert) -> LeadSearchDraftOut:
    """Create or replace a draft (same name overwrites in place)."""
    try:
        row = await db.upsert_lead_search_draft(
            request.name,
            keywords=request.keywords,
            target=request.target,
            purpose=request.purpose,
            locations=request.locations,
            lead_types=request.lead_types,
            sources=request.sources,
            enrich_contacts=request.enrich_contacts,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return LeadSearchDraftOut(**row)


@router.delete("/drafts/{draft_id}", response_model=LeadActionResponse)
async def delete_lead_draft(draft_id: str) -> LeadActionResponse:
    """Delete one saved draft."""
    deleted = await db.delete_lead_search_draft(draft_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Draft not found")
    return LeadActionResponse(message="Draft deleted", affected=1)


@router.get("/{lead_id}", response_model=LeadOut)
async def get_lead(lead_id: str) -> LeadOut:
    """Get one lead."""
    row = await db.get_lead(lead_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return _to_out(row)


@router.patch("/{lead_id}", response_model=LeadOut)
async def patch_lead(lead_id: str, request: LeadUpdateRequest) -> LeadOut:
    """Update status and/or override the suggested category (user decision)."""
    updates: dict = {}
    if request.status is not None:
        updates["status"] = request.status.value
    if request.suggested_type is not None:
        updates["suggested_type"] = request.suggested_type.value
        updates["category_source"] = "user"
        updates["category_confidence"] = 1.0
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")
    row = await db.update_lead(lead_id, updates)
    if row is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return _to_out(row)


@router.post("/{lead_id}/save", response_model=LeadOut)
async def post_save_lead(lead_id: str, request: LeadSaveRequest) -> LeadOut:
    """Save a lead as a Contact (optionally creating its Company too) or Company."""
    lead, error = await save_lead(lead_id, request)
    if error == "Lead not found":
        raise HTTPException(status_code=404, detail=error)
    if error or lead is None:
        raise HTTPException(status_code=500, detail="Could not save lead.")
    return _to_out(lead)


@router.post("/bulk-save", response_model=LeadActionResponse)
async def post_bulk_save(request: LeadBulkSaveRequest) -> LeadActionResponse:
    """Save many leads with a shared target (contact or company)."""
    affected, details = await save_leads_bulk(request.lead_ids, request)
    return LeadActionResponse(
        message=f"Saved {affected} lead(s)",
        affected=affected,
        details=details,
    )


@router.post("/bulk-delete", response_model=LeadActionResponse)
async def post_bulk_delete(request: LeadBulkDeleteRequest) -> LeadActionResponse:
    """Delete many leads (missing ids are skipped)."""
    deleted = await db.delete_leads(request.lead_ids)
    return LeadActionResponse(message=f"Deleted {deleted} lead(s)", affected=deleted)


@router.delete("/{lead_id}", response_model=LeadActionResponse)
async def delete_lead(lead_id: str) -> LeadActionResponse:
    """Delete one lead."""
    deleted = await db.delete_lead(lead_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Lead not found")
    return LeadActionResponse(message="Lead deleted", affected=1)
