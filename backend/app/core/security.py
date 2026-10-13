"""
Authentication and role-based access control.

The demo uses static bearer tokens from settings so the system runs without an identity provider.
The rest of the code only depends on :class:`User` and :func:`require_roles`, so swapping in
OIDC/JWT validation means changing :func:`get_current_user` alone.
"""

from dataclasses import dataclass
from enum import StrEnum

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_settings


class Role(StrEnum):
    """Roles from the BRD stakeholder table."""

    ANALYST = "analyst"  # reviews the exception queue and records decisions
    CONTROLLER = "controller"  # oversight: summaries, can also decide
    AUDITOR = "auditor"  # read-only access to everything, including the audit trail
    ADMIN = "admin"  # uploads documents, changes thresholds, manages runs


@dataclass(frozen=True)
class User:
    """Authenticated caller."""

    username: str
    role: Role


# Permission groups used by the routers. Keeping them here makes the access policy reviewable
# in one place instead of being scattered across endpoints.
READ_ROLES = (Role.ANALYST, Role.CONTROLLER, Role.AUDITOR, Role.ADMIN)
REVIEW_ROLES = (Role.ANALYST, Role.CONTROLLER, Role.ADMIN)
RUN_ROLES = (Role.ANALYST, Role.ADMIN)
ADMIN_ROLES = (Role.ADMIN,)

_bearer = HTTPBearer(auto_error=False)


def _token_table() -> dict[str, User]:
    """Parse ``FINQA_AUTH_TOKENS`` ("token:user:role,...") into a lookup table."""
    table: dict[str, User] = {}
    for entry in get_settings().auth_tokens.split(","):
        entry = entry.strip()
        if not entry:
            continue
        token, username, role = entry.split(":")
        table[token] = User(username=username, role=Role(role))
    return table


def configured_users() -> list[User]:
    """Every distinct user the token table knows (tokens themselves are never exposed)."""
    return list({u.username: u for u in _token_table().values()}.values())


def get_current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> User:
    """Resolve the bearer token to a user, or fail with 401."""
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    user = _token_table().get(creds.credentials)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    return user


def require_roles(*roles: Role):
    """Dependency factory: allow the request only if the caller has one of ``roles``."""

    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Role '{user.role}' may not do this")
        return user

    return checker
