"""Cookie authentication and company authorization. No anonymous write mode."""
import hashlib
import hmac
import os
import secrets
import time
import threading
from collections import OrderedDict, deque
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, Integer, String, select, delete
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, Session
from starlette.concurrency import run_in_threadpool


class AuthBase(DeclarativeBase):
    pass


class User(AuthBase):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String, unique=True)
    password_hash: Mapped[str]
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Membership(AuthBase):
    __tablename__ = "memberships"
    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role: Mapped[str]


class LoginSession(AuthBase):
    __tablename__ = "login_sessions"
    token_hash: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[int]
    csrf: Mapped[str]
    expires: Mapped[int]


def password_hash(value: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(value.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return f"{salt}:{digest}"


def verify(value: str, stored: str) -> bool:
    salt, expected = stored.split(":")
    actual = hashlib.scrypt(value.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return hmac.compare_digest(actual, expected)


def token_hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=512)


class Grant(BaseModel):
    company_id: int = Field(gt=0)
    role: str = Field(pattern="^(viewer|editor)$")


class UserIn(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str | None = Field(default=None, min_length=12, max_length=512)
    is_admin: bool = False
    is_active: bool = True
    memberships: list[Grant] = Field(default_factory=list, max_length=1000)


def principal(engine, cookie):
    if not cookie or len(cookie) > 256:
        return None
    with Session(engine) as s:
        session = s.get(LoginSession, token_hash(cookie))
        if not session or session.expires <= time.time():
            return None
        user = s.get(User, session.user_id)
        if not user or not user.is_active:
            return None
        grants = s.scalars(select(Membership).where(Membership.user_id == user.id)).all()
        return {"id": user.id, "username": user.username, "is_admin": user.is_admin,
                "csrf": session.csrf, "memberships": {str(g.company_id): g.role for g in grants}}


def require_admin(request: Request):
    if not request.state.user["is_admin"]:
        raise HTTPException(403, "Administrator access required")


class BodyLimit:
    """Reject streamed/chunked bodies before multipart spooling or JSON parsing."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] in {"GET", "HEAD"}:
            return await self.app(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > 6_000_000:
                return await JSONResponse({"detail": "Request body exceeds 6 MB"}, status_code=413)(scope, receive, send)
            if not message.get("more_body", False):
                break
        delivered = False
        async def bounded_receive():
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}
        await self.app(scope, bounded_receive, send)


def install(app, engine, companies):
    AuthBase.metadata.create_all(engine)
    limits = OrderedDict()
    limit_lock = threading.Lock()
    def allow(key, maximum):
        now = time.monotonic()
        with limit_lock:
            queue = limits.setdefault(key, deque())
            while queue and queue[0] < now - 60:
                queue.popleft()
            limits.move_to_end(key)
            while len(limits) > 4096:
                limits.popitem(last=False)
            if len(queue) >= maximum:
                return False
            queue.append(now)
            return True

    @app.middleware("http")
    async def authenticate(request, call_next):
        path = request.url.path
        user = None
        if path.startswith(("/api/", "/uploads/")):
            user = await run_in_threadpool(principal, engine, request.cookies.get("org_session"))
            # The landing page is public and read-only: the slim chart data and the photos it shows.
            public = path in {"/api/auth/login", "/api/auth/status"} or (
                request.method in {"GET", "HEAD"} and path.startswith(("/api/public/", "/uploads/")))
            if not user and not public:
                return JSONResponse({"detail": "Sign in required"}, status_code=401)
            request.state.user = user
            if request.method not in {"GET", "HEAD", "OPTIONS"}:
                # Never trust a proxy header unless Uvicorn is explicitly configured for that proxy.
                origin = request.headers.get("origin")
                if origin and origin != str(request.base_url).rstrip("/"):
                    return JSONResponse({"detail": "Cross-origin writes are blocked"}, status_code=403)
                if user and not hmac.compare_digest(request.headers.get("x-csrf-token", ""), user["csrf"]):
                    return JSONResponse({"detail": "Refresh your session and try again"}, status_code=403)
                category = "login" if path == "/api/auth/login" else "upload" if "/upload/" in path else "export" if "/export/" in path else "write"
                maximum = {"login": 10, "upload": 20, "export": 10, "write": 120}[category] * int(os.environ.get("ORG_RATE_MULTIPLIER", "1"))
                identity = str(user["id"]) if user else (request.client.host if request.client else "unknown")
                if not allow((identity, category), maximum):
                    return JSONResponse({"detail": "Too many requests. Try again in a minute."}, status_code=429, headers={"Retry-After": "60"})
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'"
        if path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        elif path.startswith("/uploads/"):
            response.headers["Cache-Control"] = "public, max-age=3600"  # filenames are unique UUIDs
        return response

    app.add_middleware(BodyLimit)

    @app.get("/api/auth/status")
    def status():
        with Session(engine) as s:
            return {"configured": s.scalar(select(User.id).where(User.is_admin, User.is_active).limit(1)) is not None}

    @app.post("/api/auth/login")
    def login(body: LoginIn):
        with Session(engine) as s:
            user = s.scalar(select(User).where(User.username == body.username.strip().casefold()))
            # A fixed dummy hash still performs expensive verification for unknown accounts.
            dummy = "00" * 16 + ":" + "00" * 64
            correct = verify(body.password, user.password_hash if user else dummy)
            if not correct or not user or not user.is_active:
                raise HTTPException(401, "Incorrect username or password")
            token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            s.execute(delete(LoginSession).where(LoginSession.expires < int(time.time())))
            s.add(LoginSession(token_hash=token_hash(token), user_id=user.id, csrf=csrf, expires=int(time.time()) + 28800))
            s.commit()
        response = JSONResponse(principal(engine, token))
        response.set_cookie("org_session", token, httponly=True, secure=os.environ.get("ORG_COOKIE_SECURE", "0") == "1", samesite="strict", max_age=28800, path="/")
        return response

    @app.get("/api/auth/me")
    def me(request: Request):
        return request.state.user

    @app.post("/api/auth/logout")
    def logout(request: Request):
        with Session(engine) as s:
            s.execute(delete(LoginSession).where(LoginSession.token_hash == token_hash(request.cookies.get("org_session", ""))))
            s.commit()
        response = JSONResponse({"ok": True})
        response.delete_cookie("org_session", path="/")
        return response

    @app.get("/api/users")
    def users(request: Request):
        require_admin(request)
        with Session(engine) as s:
            return [{"id": u.id, "username": u.username, "is_admin": u.is_admin, "is_active": u.is_active,
                     "memberships": [{"company_id": m.company_id, "role": m.role} for m in s.scalars(select(Membership).where(Membership.user_id == u.id))]}
                    for u in s.scalars(select(User).order_by(User.username))]

    def save_user(request, body, user_id=None):
        require_admin(request)
        username = body.username.strip().casefold()
        if not username:
            raise HTTPException(422, "Enter a username")
        with Session(engine) as s:
            s.connection().exec_driver_sql("BEGIN IMMEDIATE")
            if len({g.company_id for g in body.memberships}) != len(body.memberships):
                raise HTTPException(422, "Duplicate company membership")
            if any(g.company_id not in companies() for g in body.memberships):
                raise HTTPException(400, "Unknown company membership")
            duplicate = s.scalar(select(User).where(User.username == username))
            if duplicate and duplicate.id != user_id:
                raise HTTPException(409, "Username already exists")
            user = s.get(User, user_id) if user_id else None
            if user_id and not user:
                raise HTTPException(404, "User not found")
            if user_id == request.state.user["id"] and (not body.is_admin or not body.is_active):
                raise HTTPException(409, "You cannot disable your own administrator account")
            if not user:
                if not body.password:
                    raise HTTPException(422, "A password of at least 12 characters is required")
                user = User(username=username, password_hash=password_hash(body.password))
                s.add(user)
                s.flush()
            elif body.password:
                user.password_hash = password_hash(body.password)
            user.username, user.is_admin, user.is_active = username, body.is_admin, body.is_active
            s.execute(delete(Membership).where(Membership.user_id == user.id))
            for grant in body.memberships:
                s.add(Membership(user_id=user.id, company_id=grant.company_id, role=grant.role))
            # Permission/password changes invalidate existing sessions.
            s.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
            s.commit()
            return {"id": user.id, "username": user.username}

    @app.post("/api/users", status_code=201)
    def create_user(body: UserIn, request: Request):
        return save_user(request, body)

    @app.put("/api/users/{user_id}")
    def update_user(user_id: int, body: UserIn, request: Request):
        return save_user(request, body, user_id)


def bootstrap_admin(engine, username, password):
    """Offline CLI only: no remotely accessible first-admin registration."""
    if len(password) < 12 or len(password) > 512:
        raise ValueError("Use a password between 12 and 512 characters")
    AuthBase.metadata.create_all(engine)
    with Session(engine) as s:
        s.connection().exec_driver_sql("BEGIN IMMEDIATE")
        if s.scalar(select(User.id).where(User.is_admin).limit(1)) is not None:
            raise ValueError("An administrator already exists; use the Users page")
        s.add(User(username=username.strip().casefold(), password_hash=password_hash(password), is_admin=True))
        s.commit()


def reset_password(engine, username, password):
    """Offline CLI only: recover access when a password is lost."""
    if len(password) < 12 or len(password) > 512:
        raise ValueError("Use a password between 12 and 512 characters")
    with Session(engine) as s:
        user = s.scalar(select(User).where(User.username == username.strip().casefold()))
        if not user:
            raise ValueError("No such user")
        user.password_hash, user.is_active = password_hash(password), True
        s.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
        s.commit()
