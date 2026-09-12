"""Gmail IMAP integration for fetching and searching emails."""

from app.services.gmail.client import (
    EmailMessage,
    get_inbox_summary,
    get_unread_emails,
    is_available,
    search_emails,
)

__all__ = [
    "EmailMessage",
    "get_inbox_summary",
    "get_unread_emails",
    "is_available",
    "search_emails",
]
