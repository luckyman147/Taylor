"""Pydantic models for Job Intelligence (Job DNA, Red Flags, Should I Apply)."""

from typing import Any, Literal

from pydantic import BaseModel


class RedFlag(BaseModel):
    flag: str
    severity: Literal["info", "warning", "danger"]
    concern: str


class RedFlagsResponse(BaseModel):
    red_flags: list[RedFlag]
    ghost_risk_percent: int


class DnaSkill(BaseModel):
    skill: str
    weight: int | None = None
    level: str | None = None


class DnaDomain(BaseModel):
    domain: str
    level: str


class JobDnaResponse(BaseModel):
    job_dna: dict[str, Any]
    career_dna: dict[str, Any]
    comparison: dict[str, Any]


class ShouldApplyResponse(BaseModel):
    match_percent: float
    career_relevance: float
    salary_potential: float | None = None
    competition: Literal["Low", "Medium", "High"]
    company_quality: float | None = None
    ghost_risk_percent: int
    verdict: Literal["yes", "no", "conditional"]
    verdict_reason: str
    main_weakness: str
    recommendation: str
    red_flags: list[RedFlag]
    job_dna: dict[str, Any]
    career_dna: dict[str, Any]
    comparison: dict[str, Any]


class HiringFactor(BaseModel):
    score: float
    detail: str


class HiringProbabilityResponse(BaseModel):
    skills: HiringFactor
    experience: HiringFactor
    seniority: HiringFactor
    hiring_probability: float
    assessment: str
    summary: str
    gaps: list[str]
