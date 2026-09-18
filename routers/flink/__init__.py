"""Flink backend router package."""
from fastapi import APIRouter

from .auth import router as auth_router
from .signaling import router as signaling_router

router = APIRouter()
router.include_router(auth_router, prefix="/auth")
router.include_router(signaling_router, prefix="/signaling")
