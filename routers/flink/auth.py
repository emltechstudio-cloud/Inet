"""Flink identity, recovery, groups, and Web Push registration."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import threading
from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import Any

import jwt
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from fastapi import APIRouter, Header, HTTPException
from huggingface_hub import HfApi, hf_hub_download
from huggingface_hub.utils import EntryNotFoundError
from passlib.context import CryptContext
from pydantic import BaseModel, Field

router = APIRouter()
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
_store_lock = threading.RLock()
_store: dict[str, Any] | None = None
_store_dirty = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _b64decode(value: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(value + ("=" * (-len(value) % 4)))
    except (ValueError, UnicodeEncodeError) as exc:
        raise HTTPException(status_code=503, detail="Flink signing keys are invalid") from exc


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _private_key() -> Ed25519PrivateKey:
    encoded = os.getenv("FLINK_SIM_PRIVATE_KEY_B64", "").strip()
    if not encoded:
        raise HTTPException(status_code=503, detail="Flink SIM signing is not configured")
    raw = _b64decode(encoded)
    if len(raw) != 32:
        raise HTTPException(status_code=503, detail="Flink private key must be 32 bytes")
    return Ed25519PrivateKey.from_private_bytes(raw)


def _public_key() -> Ed25519PublicKey:
    encoded = os.getenv("FLINK_SIM_PUBLIC_KEY_B64", "").strip()
    if encoded:
        raw = _b64decode(encoded)
        if len(raw) != 32:
            raise HTTPException(status_code=503, detail="Flink public key must be 32 bytes")
        return Ed25519PublicKey.from_public_bytes(raw)
    return _private_key().public_key()


def _canonical(value: dict[str, Any]) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _dataset_name() -> str:
    return os.getenv("FLINK_DATASET_NAME", os.getenv("DATASET_NAME", "emltechstudio/myshop-db"))


def _load_store() -> dict[str, Any]:
    global _store
    if _store is not None:
        return _store
    try:
        path = hf_hub_download(repo_id=_dataset_name(), filename="flink.json", repo_type="dataset", token=os.getenv("HF_TOKEN"))
        with open(path, encoding="utf-8") as file:
            _store = json.load(file)
    except EntryNotFoundError:
        _store = {"users": [], "groups": [], "push_subscriptions": []}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Flink dataset unavailable: {exc}") from exc
    return _store


def _flush_store() -> None:
    global _store_dirty
    if not _store_dirty or _store is None:
        return
    token = os.getenv("HF_TOKEN")
    if not token:
        raise HTTPException(status_code=503, detail="HF_TOKEN is not configured for Flink persistence")
    data = json.dumps(_store, sort_keys=True, separators=(",", ":")).encode()
    HfApi(token=token).upload_file(
        path_or_fileobj=BytesIO(data),
        path_in_repo="flink.json",
        repo_id=_dataset_name(),
        repo_type="dataset",
        token=token,
        commit_message="Update Flink state"
    )
    _store_dirty = False


def _mutate(callback):
    global _store_dirty
    with _store_lock:
        result = callback(_load_store())
        _store_dirty = True
        _flush_store()
        return result


def _read(callback):
    with _store_lock:
        return callback(_load_store())


def _token(user: dict[str, Any]) -> str:
    secret = os.getenv("FLINK_JWT_SECRET", "").strip()
    if not secret:
        raise HTTPException(status_code=503, detail="FLINK_JWT_SECRET is not configured")
    now = datetime.now(timezone.utc)
    return jwt.encode({
        "iss": "flink",
        "sub": user["flink_number"],
        "iat": now,
        "exp": now + timedelta(days=30),
        "jti": secrets.token_urlsafe(12)
    }, secret, algorithm="HS256")


def _current(authorization: str) -> dict[str, Any]:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Bearer token required")
    try:
        claims = jwt.decode(
            authorization[7:].strip(),
            os.environ["FLINK_JWT_SECRET"],
            algorithms=["HS256"],
            issuer="flink"
        )
    except (KeyError, jwt.PyJWTError):
        raise HTTPException(status_code=401, detail="Invalid or expired Flink token")
    user = _read(lambda db: next((u for u in db["users"] if u["flink_number"] == claims["sub"]), None))
    if not user:
        raise HTTPException(status_code=401, detail="Flink account not found")
    return user


def _next_number(db: dict[str, Any]) -> str:
    used = {u["flink_number"] for u in db["users"]}
    for _ in range(100):
        number = f"{secrets.randbelow(1_000_000):06d}"
        if number not in used:
            return number
    raise HTTPException(status_code=503, detail="Unable to allocate Flink number")


class AccountCreate(BaseModel):
    password: str = Field(min_length=8, max_length=256)
    device_id: str = Field(min_length=8, max_length=200)
    sim_id: str = Field(min_length=8, max_length=200)


class ContinueRequest(BaseModel):
    flink_number: str = Field(pattern=r"^\d{6}$")
    password: str = Field(min_length=1, max_length=256)


class DeviceContinue(BaseModel):
    device_id: str = Field(min_length=8, max_length=200)


class SimContinue(BaseModel):
    payload: dict[str, Any]
    signature: str = Field(min_length=20)


class SimSignRequest(BaseModel):
    flink_number: str = Field(pattern=r"^\d{6}$")
    sim_id: str = Field(min_length=8, max_length=200)
    metadata: dict[str, str] = Field(default_factory=dict)


class PushSubscription(BaseModel):
    endpoint: str = Field(min_length=10, max_length=2000)
    keys: dict[str, str] = Field(default_factory=dict)
    expirationTime: int | None = None


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    member_numbers: list[str] = Field(default_factory=list, max_length=200)


class GroupMembers(BaseModel):
    member_numbers: list[str] = Field(max_length=200)


@router.post("/account")
def create_account(req: AccountCreate):
    def create(db):
        number = _next_number(db)
        user = {
            "flink_number": number,
            "password_hash": pwd.hash(req.password),
            "device_hash": hashlib.sha256(req.device_id.encode()).hexdigest(),
            "sim_id": req.sim_id,
            "created_at": _now()
        }
        db["users"].append(user)
        return user
    user = _mutate(create)
    return {"success": True, "flink_number": user["flink_number"], "access_token": _token(user), "token_type": "Bearer"}


@router.post("/continue/password")
def continue_password(req: ContinueRequest):
    user = _read(lambda db: next((u for u in db["users"] if u["flink_number"] == req.flink_number), None))
    if not user or not pwd.verify(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid Flink credentials")
    return {"success": True, "access_token": _token(user), "token_type": "Bearer"}


@router.post("/continue/device")
def continue_device(req: DeviceContinue):
    digest = hashlib.sha256(req.device_id.encode()).hexdigest()
    user = _read(lambda db: next((u for u in db["users"] if u.get("device_hash") == digest), None))
    if not user:
        raise HTTPException(status_code=401, detail="Device is not registered")
    return {"success": True, "flink_number": user["flink_number"], "access_token": _token(user), "token_type": "Bearer"}


@router.get("/sim/public-key")
def sim_public_key():
    return {"success": True, "algorithm": "Ed25519", "ecosystem": "flink", "public_key": _b64encode(_public_key().public_bytes_raw())}


@router.post("/sim/sign")
def sign_sim(req: SimSignRequest):
    exists = _read(lambda db: any(
        u["flink_number"] == req.flink_number and u.get("sim_id") == req.sim_id
        for u in db["users"]
    ))
    if not exists:
        raise HTTPException(status_code=404, detail="Flink account/SIM is not registered")
    payload = {
        "ecosystem": "flink",
        "version": 1,
        "flink_number": req.flink_number,
        "sim_id": req.sim_id,
        "issued_at": _now(),
        "metadata": req.metadata
    }
    signature = _b64encode(_private_key().sign(_canonical(payload)))
    return {
        "success": True,
        "payload": payload,
        "signature": signature,
        "algorithm": "Ed25519",
        "public_key": _b64encode(_public_key().public_bytes_raw())
    }


@router.post("/continue/sim")
def continue_sim(req: SimContinue):
    if req.payload.get("ecosystem") != "flink":
        raise HTTPException(status_code=401, detail="Invalid Flink SIM")
    try:
        _public_key().verify(_b64decode(req.signature), _canonical(req.payload))
    except (InvalidSignature, ValueError):
        raise HTTPException(status_code=401, detail="Invalid Flink SIM signature")
    user = _read(lambda db: next(
        (u for u in db["users"] if u["flink_number"] == req.payload.get("flink_number") and u.get("sim_id") == req.payload.get("sim_id")),
        None
    ))
    if not user:
        raise HTTPException(status_code=401, detail="Flink SIM is not registered")
    return {"success": True, "flink_number": user["flink_number"], "access_token": _token(user), "token_type": "Bearer"}


@router.get("/me")
def me(authorization: str = Header(default="")):
    user = _current(authorization)
    return {"success": True, "flink_number": user["flink_number"], "created_at": user["created_at"]}


@router.post("/push/subscribe")
def register_push(subscription: PushSubscription, authorization: str = Header(default="")):
    user = _current(authorization)
    def save(db):
        db["push_subscriptions"] = [
            s for s in db["push_subscriptions"]
            if not (s["flink_number"] == user["flink_number"] and s["subscription"].get("endpoint") == subscription.endpoint)
        ]
        db["push_subscriptions"].append({
            "flink_number": user["flink_number"],
            "subscription": subscription.model_dump(),
            "updated_at": _now()
        })
    _mutate(save)
    return {"success": True}


@router.get("/push/public-key")
def push_public_key():
    """Return the VAPID public key used by browsers when subscribing."""
    public_key = os.getenv("VAPID_PUBLIC_KEY", "").strip()
    if not public_key:
        raise HTTPException(status_code=503, detail="VAPID public key is not configured")
    return {"success": True, "public_key": public_key}


@router.post("/groups")
def create_group(req: GroupCreate, authorization: str = Header(default="")):
    user = _current(authorization)
    members = set(req.member_numbers) | {user["flink_number"]}
    if any(not isinstance(n, str) or len(n) != 6 or not n.isdigit() for n in members):
        raise HTTPException(status_code=422, detail="Group members must be six-digit Flink numbers")
    group = {
        "group_id": secrets.token_urlsafe(16),
        "name": req.name,
        "owner": user["flink_number"],
        "members": sorted(members),
        "created_at": _now(),
        "updated_at": _now()
    }
    _mutate(lambda db: db["groups"].append(group) or group)
    return {"success": True, "group": group}


@router.get("/groups")
def list_groups(authorization: str = Header(default="")):
    user = _current(authorization)
    return {"success": True, "groups": _read(lambda db: [g for g in db["groups"] if user["flink_number"] in g["members"]])}


@router.post("/groups/{group_id}/members")
def add_group_members(group_id: str, req: GroupMembers, authorization: str = Header(default="")):
    user = _current(authorization)
    def update(db):
        group = next((g for g in db["groups"] if g["group_id"] == group_id), None)
        if not group or group["owner"] != user["flink_number"]:
            raise HTTPException(status_code=404, detail="Group not found or not owned by caller")
        if any(not isinstance(n, str) or len(n) != 6 or not n.isdigit() for n in req.member_numbers):
            raise HTTPException(status_code=422, detail="Group members must be six-digit Flink numbers")
        group["members"] = sorted(set(group["members"]) | set(req.member_numbers))
        group["updated_at"] = _now()
        return group
    return {"success": True, "group": _mutate(update)}


@router.delete("/groups/{group_id}/members/{flink_number}")
def remove_group_member(group_id: str, flink_number: str, authorization: str = Header(default="")):
    user = _current(authorization)
    def update(db):
        group = next((g for g in db["groups"] if g["group_id"] == group_id), None)
        if not group or group["owner"] != user["flink_number"]:
            raise HTTPException(status_code=404, detail="Group not found or not owned by caller")
        if flink_number == group["owner"]:
            raise HTTPException(status_code=400, detail="Owner cannot be removed")
        group["members"] = [n for n in group["members"] if n != flink_number]
        group["updated_at"] = _now()
        return group
    return {"success": True, "group": _mutate(update)}
