"""API routers."""

from app.routers.applications import router as applications_router
from app.routers.companies import router as companies_router
from app.routers.config import router as config_router
from app.routers.contacts import router as contacts_router
from app.routers.enrichment import router as enrichment_router
from app.routers.github import router as github_router
from app.routers.health import router as health_router
from app.routers.jobs import router as jobs_router
from app.routers.job_scraper import router as job_scraper_router
from app.routers.mcp import router as mcp_router
from app.routers.resume_wizard import router as resume_wizard_router
from app.routers.resumes import router as resumes_router

__all__ = [
    "resumes_router",
    "jobs_router",
    "config_router",
    "health_router",
    "enrichment_router",
    "applications_router",
    "companies_router",
    "contacts_router",
    "resume_wizard_router",
    "mcp_router",
    "job_scraper_router",
    "github_router",
]
