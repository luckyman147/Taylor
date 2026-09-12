"""Sandbox Workspace — isolated execution environment for workflows."""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


class Workspace:
    """Isolated execution environment for a single workflow."""

    def __init__(self, workflow_id: str) -> None:
        self.workflow_id = workflow_id
        self._dir: Path | None = None

    async def __aenter__(self) -> "Workspace":
        self._dir = Path(tempfile.mkdtemp(prefix=f"taylor_{self.workflow_id}_"))
        logger.debug("Created workspace: %s", self._dir)
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.cleanup()

    async def cleanup(self) -> None:
        """Remove the workspace directory."""
        if self._dir and self._dir.exists():
            import shutil
            shutil.rmtree(self._dir, ignore_errors=True)
            logger.debug("Cleaned up workspace: %s", self._dir)
            self._dir = None

    @property
    def path(self) -> Path:
        if self._dir is None:
            raise RuntimeError("Workspace not initialized")
        return self._dir
