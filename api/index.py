"""Vercel entry point: the FastAPI app from backend/app, serving the API and the two views."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.main import app  # noqa: E402,F401
