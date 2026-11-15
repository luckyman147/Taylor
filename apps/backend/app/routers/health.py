"""Health check and status endpoints."""

import logging

from fastapi import APIRouter

from app import llm_cache
from app.database import db
from app.llm import check_llm_health, get_llm_config, get_llm_usage
from app.schemas import HealthResponse, StatusResponse

logger = logging.getLogger(__name__)

# The frontend polls GET /status on mount and every 30 min; each poll used to
# run a live ~64-token completion against the provider. Cache the probe for 10
# min (keyed on the provider config, so key/model changes re-probe immediately).
_LLM_PROBE_TTL = 600.0

router = APIRouter(tags=["Health"])

# Returned for database_stats when the stats query itself fails, so /status can
# still respond (degraded) instead of 500-ing.
_EMPTY_DB_STATS = {
    "total_resumes": 0,
    "total_jobs": 0,
    "total_improvements": 0,
    "has_master_resume": False,
    "master_resume_count": 0,
}


def _llm_usage_summary() -> dict:
    """Aggregate in-process LLM token counters into a status-page payload."""
    by_tag = get_llm_usage()
    return {
        "totals": {
            "calls": sum(v.get("calls", 0) for v in by_tag.values()),
            "prompt_tokens": sum(v.get("prompt_tokens", 0) for v in by_tag.values()),
            "completion_tokens": sum(
                v.get("completion_tokens", 0) for v in by_tag.values()
            ),
        },
        "by_tag": by_tag,
    }


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Lightweight liveness check for Docker HEALTHCHECK.

    Does NOT call the LLM provider. Use GET /status for full LLM health.
    """
    return HealthResponse(status="healthy")


@router.get("/status", response_model=StatusResponse)
async def get_status() -> StatusResponse:
    """Get comprehensive application status.

    Each subsystem check is isolated: a failure in the LLM health probe or the
    database stats query degrades only its own field instead of 500-ing the
    whole endpoint, so the status page can still report partial/degraded state.
    """
    llm_configured = False
    llm_healthy = False
    try:
        config = get_llm_config()
        # ollama / openai_compatible run without a key, matching check_llm_health.
        llm_configured = bool(config.api_key) or config.provider in ("ollama", "openai_compatible")
        probe = await llm_cache.get_or_compute(
            llm_cache.make_key(
                "llm_health", config.provider, config.model, config.api_key
            ),
            lambda: check_llm_health(config),
            ttl=_LLM_PROBE_TTL,
        )
        llm_healthy = bool(probe.get("healthy"))
    except Exception:
        logger.exception("Status: LLM health check failed")

    db_stats: dict = dict(_EMPTY_DB_STATS)
    try:
        db_stats = await db.get_stats()
    except Exception:
        logger.exception("Status: database stats failed")

    has_master_resume = bool(db_stats.get("has_master_resume"))
    master_resume_count = int(db_stats.get("master_resume_count", 1 if has_master_resume else 0))

    return StatusResponse(
        status="ready" if llm_healthy and has_master_resume else "setup_required",
        llm_configured=llm_configured,
        llm_healthy=llm_healthy,
        has_master_resume=has_master_resume,
        master_resume_count=master_resume_count,
        database_stats=db_stats,
        llm_usage=_llm_usage_summary(),
    )
