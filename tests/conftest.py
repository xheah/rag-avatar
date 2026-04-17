"""
tests/conftest.py
-----------------
Shared pytest fixtures for all test layers.

Key responsibility: patches the FastAPI startup_event so that
initialize_database() and get_embedding_model() are never called
during tests, preventing disk I/O and model loading side effects.
"""

import pytest
from unittest.mock import patch, MagicMock
from httpx import AsyncClient, ASGITransport


# ── Startup mock ──────────────────────────────────────────────────────────────
# Patch the two heavy calls that fire on app startup BEFORE importing src.api,
# so the test session never touches ChromaDB or loads the SentenceTransformer.

_startup_patches = [
    patch("src.vectorstore.database_creation.initialize_database", return_value=None),
    patch("src.config.get_embedding_model", return_value=MagicMock()),
]

def pytest_configure(config):
    """Start startup patches at session start so they are active for all imports."""
    for p in _startup_patches:
        p.start()

def pytest_unconfigure(config):
    for p in _startup_patches:
        try:
            p.stop()
        except RuntimeError:
            pass


# ── FastAPI async client (Layer 2) ───────────────────────────────────────────

@pytest.fixture
async def async_client():
    """
    Returns an httpx.AsyncClient bound to the FastAPI app via ASGITransport.
    No real server is started; requests are handled entirely in-process.
    """
    from src.api import app
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client
