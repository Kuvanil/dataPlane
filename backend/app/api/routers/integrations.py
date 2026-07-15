"""Integrations API (aci_integration_tasks #5/#8).

Thin, deliberately: linked-account listing proxies ACI (degrading
gracefully when it's down/unconfigured — this page must never 500 because
an optional integration is offline), notification settings expose the
per-event-type notify-out opt-in flags, and the status endpoint tells the
frontend where ACI's own dev portal lives (OAuth-connect happens THERE,
never rebuilt in dataPlane).
"""
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.api.routers.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.user import User
from app.services import notification_service
from app.services.aci_client_service import (
    AciNotConfigured,
    CircuitBreakerOpen,
    aci_client,
)
from app.services.audit_helper import emit_audit_event
from app.services.autopilot_registry import ACTION_REGISTRY

logger = logging.getLogger(__name__)
router = APIRouter()

EXTERNAL_ACTION_TYPES = (
    "notify_slack_internal", "external_message_send",
    "external_ticket_create", "external_email_send",
)


class NotificationSettingUpdate(BaseModel):
    enabled: bool


class NotificationSettingEntry(BaseModel):
    event_key: str
    enabled: bool
    updated_by: Optional[str] = None


@router.get("/status")
def integration_status(_user: User = Depends(get_current_user)) -> Dict[str, Any]:
    """Whether ACI is configured + where its portal lives + which governed
    external action types exist (from the registry — single source of truth)."""
    return {
        "configured": bool(settings.ACI_API_KEY),
        "portal_url": settings.ACI_PORTAL_URL,
        "external_actions": [
            {
                "action_type": t,
                "description": ACTION_REGISTRY[t].description,
                "risk": ACTION_REGISTRY[t].risk,
                "auto_capable": ACTION_REGISTRY[t].auto_capable,
            }
            for t in EXTERNAL_ACTION_TYPES if t in ACTION_REGISTRY
        ],
    }


@router.get("/linked-accounts")
def linked_accounts(_user: User = Depends(get_current_user)) -> Dict[str, Any]:
    try:
        accounts: List[Dict[str, Any]] = aci_client.list_linked_accounts()
        return {"accounts": accounts, "error": None}
    except AciNotConfigured:
        return {"accounts": [],
                "error": "ACI integration is not configured (ACI_API_KEY unset)."}
    except CircuitBreakerOpen:
        return {"accounts": [],
                "error": "ACI service unreachable (circuit open) — try again shortly."}
    except Exception as exc:
        logger.warning("[aci] linked-accounts listing failed: %s", exc)
        return {"accounts": [], "error": f"Could not reach ACI: {exc}"}


@router.get("/notification-settings")
def get_notification_settings(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    rows = notification_service.list_notification_settings(db)
    return {"settings": [
        NotificationSettingEntry(event_key=r.event_key, enabled=r.enabled,
                                 updated_by=r.updated_by).model_dump()
        for r in rows
    ]}


@router.put("/notification-settings/{event_key}")
def put_notification_setting(
    event_key: str,
    body: NotificationSettingUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
) -> Dict[str, Any]:
    row = notification_service.set_notify_enabled(
        db, event_key, body.enabled, actor=user.email)
    emit_audit_event(
        db, event_type="aci.notify_setting_changed", actor=user.email,
        module="aci_integration", target_type="notification_setting",
        target_name=event_key,
        summary=f"notify-out {'enabled' if body.enabled else 'disabled'} for {event_key}",
        outcome="success",
        metadata={"event_key": event_key, "enabled": body.enabled},
    )
    db.commit()
    return {"event_key": row.event_key, "enabled": row.enabled}
