"""Session-only WebRTC signaling and push-backed connection requests."""
from __future__ import annotations

import asyncio
import json
import os
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Header, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from pywebpush import WebPushException, webpush

from .auth import _current, _read

router = APIRouter()
_sessions: dict[str, set[WebSocket]] = defaultdict(set)
_lock = asyncio.Lock()


@router.get("/health")
def signaling_health():
    return {"success": True, "service": "flink-signaling", "transport": "websocket"}


class PingRequest(BaseModel):
    target_flink_number: str = Field(pattern=r"^\d{6}$")
    mode: str = Field(default="ping", pattern=r"^(ping|voice|video)$")
    session_id: str = Field(min_length=8, max_length=200)


class GroupPingRequest(BaseModel):
    group_id: str = Field(min_length=8, max_length=200)
    mode: str = Field(default="ping", pattern=r"^(ping|voice|video)$")
    session_id: str = Field(min_length=8, max_length=200)


def _send_push(target: str, payload: dict[str, Any]) -> int:
    private_key = os.getenv("VAPID_PRIVATE_KEY", "").strip()
    subject = os.getenv("VAPID_SUBJECT", "mailto:admin@example.com").strip()
    if not private_key:
        raise HTTPException(status_code=503, detail="VAPID private key is not configured")
    subscriptions = _read(lambda db: [s["subscription"] for s in db["push_subscriptions"] if s["flink_number"] == target])
    delivered = 0
    for subscription in subscriptions:
        try:
            webpush(
                subscription_info=subscription,
                data=json.dumps(payload),
                vapid_private_key=private_key,
                vapid_claims={"sub": subject}
            )
            delivered += 1
        except WebPushException:
            continue
    return delivered


@router.post("/ping")
def ping(req: PingRequest, authorization: str = Header(default="")):
    sender = _current(authorization)
    if sender["flink_number"] == req.target_flink_number:
        raise HTTPException(status_code=400, detail="Cannot ping yourself")
    delivered = _send_push(
        req.target_flink_number,
        {
            "type": "flink_request",
            "mode": req.mode,
            "session_id": req.session_id,
            "from": sender["flink_number"]
        }
    )
    return {
        "success": True,
        "target_flink_number": req.target_flink_number,
        "mode": req.mode,
        "session_id": req.session_id,
        "notifications_sent": delivered
    }


@router.post("/group-ping")
def group_ping(req: GroupPingRequest, authorization: str = Header(default="")):
    sender = _current(authorization)
    group = _read(lambda db: next((g for g in db["groups"] if g["group_id"] == req.group_id), None))
    if not group or sender["flink_number"] not in group["members"]:
        raise HTTPException(status_code=404, detail="Group not found or caller is not a member")
    sent = 0
    for target in group["members"]:
        if target != sender["flink_number"]:
            sent += _send_push(
                target,
                {
                    "type": "flink_group_request",
                    "mode": req.mode,
                    "session_id": req.session_id,
                    "group_id": req.group_id,
                    "from": sender["flink_number"]
                }
            )
    return {
        "success": True,
        "group_id": req.group_id,
        "mode": req.mode,
        "session_id": req.session_id,
        "notifications_sent": sent
    }


async def _broadcast(session_id: str, sender: WebSocket, event: dict[str, Any]) -> None:
    async with _lock:
        peers = tuple(_sessions.get(session_id, ()))
    stale: list[WebSocket] = []
    for peer in peers:
        if peer is sender:
            continue
        try:
            await peer.send_json(event)
        except Exception:
            stale.append(peer)
    if stale:
        async with _lock:
            for peer in stale:
                _sessions[session_id].discard(peer)


@router.websocket("/ws/{session_id}")
async def signaling_socket(websocket: WebSocket, session_id: str, token: str | None = None):
    await websocket.accept()
    if token:
        try:
            _current(f"Bearer {token}")
        except HTTPException:
            await websocket.close(code=1008)
            return
    async with _lock:
        _sessions[session_id].add(websocket)
    try:
        await websocket.send_json({"type": "ready", "session_id": session_id})
        while True:
            message = await websocket.receive_json()
            if not isinstance(message, dict) or not isinstance(message.get("type"), str):
                continue
            await _broadcast(session_id, websocket, message)
    except WebSocketDisconnect:
        pass
    finally:
        async with _lock:
            _sessions[session_id].discard(websocket)
            if not _sessions[session_id]:
                _sessions.pop(session_id, None)
