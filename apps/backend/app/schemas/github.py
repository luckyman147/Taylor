"""Pydantic schemas for GitHub integration."""

from __future__ import annotations

from pydantic import BaseModel, Field


class GitHubStatusResponse(BaseModel):
    """Response with GitHub CLI status."""

    installed: bool = Field(description="Whether gh CLI is installed")
    authenticated: bool = Field(description="Whether gh CLI is authenticated")
    user: str | None = Field(default=None, description="Authenticated GitHub username")
    message: str = Field(description="Status message")


class GitHubRepo(BaseModel):
    """A single GitHub repository."""

    name: str = Field(description="Repository name")
    description: str | None = Field(default=None, description="Repository description")
    visibility: str = Field(description="PUBLIC or PRIVATE")
    url: str = Field(description="Repository URL")
    pushed_at: str | None = Field(default=None, description="Last push timestamp")
    stargazer_count: int = Field(default=0, description="Number of stars")
    is_fork: bool = Field(default=False, description="Whether repo is a fork")
    is_archived: bool = Field(default=False, description="Whether repo is archived")
    languages: list[str] = Field(default_factory=list, description="Programming languages used")
    topics: list[str] = Field(default_factory=list, description="Repository topics/frameworks")
    readme: str = Field(default="", description="README content (first 500 chars)")


class GitHubReposResponse(BaseModel):
    """Response with GitHub repositories."""

    repos: list[GitHubRepo] = Field(description="List of repositories")
    total: int = Field(description="Total number of repos")
