"""AuthZ-check contract (DP-SEC-001, SEC-T2, FR6) — the endpoint other
modules (or the frontend, for UI gating) call to ask "can this user do
this?" Deny-by-default (AC1): unknown module/action or no matching grant
returns allowed=False.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.routers.auth import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.schemas.security import AuthzCheckRequest, AuthzCheckResponse
from app.services.rbac_service import AuthzService

router = APIRouter()


@router.post("/check", response_model=AuthzCheckResponse)
def check(
    req: AuthzCheckRequest, db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    allowed, reason = AuthzService.check(db, user.id, req.module, req.action)
    return AuthzCheckResponse(allowed=allowed, reason=reason, module=req.module, action=req.action)
