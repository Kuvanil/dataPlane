"""Notify-out fan-out service (aci_integration_tasks #5/#7).

One shared implementation for every trigger point (Autopilot approval
queue, Agentic DBA plans, pipeline runs/drift): check the per-event-type
opt-in flag, then FIRE-AND-FORGET an async Celery dispatch. A notification
failure — broker down, ACI down, channel unconfigured — must NEVER block or
fail the underlying business operation; that guarantee lives here, in one
place, not at each call site.

The notification itself executes through the governance registry's
`notify_slack_internal` action (fixed admin-configured destination), so the
approval decision still happens inside dataPlane — the message only links
back to dataPlane's own UI.
"""
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.models.notification_setting import NotificationSetting

logger = logging.getLogger(__name__)


def is_notify_enabled(db: Session, event_key: str) -> bool:
    row = (
        db.query(NotificationSetting)
        .filter(NotificationSetting.event_key == event_key)
        .first()
    )
    return bool(row and row.enabled)


def set_notify_enabled(db: Session, event_key: str, enabled: bool, *,
                       actor: str) -> NotificationSetting:
    row = (
        db.query(NotificationSetting)
        .filter(NotificationSetting.event_key == event_key)
        .first()
    )
    if row:
        row.enabled = enabled
        row.updated_by = actor
    else:
        row = NotificationSetting(event_key=event_key, enabled=enabled,
                                  updated_by=actor)
        db.add(row)
    db.flush()
    return row


def list_notification_settings(db: Session) -> list[NotificationSetting]:
    return (
        db.query(NotificationSetting)
        .order_by(NotificationSetting.event_key)
        .all()
    )


def dispatch_notify_out(db: Session, *, event_key: str, title: str,
                        body: str = "", link: Optional[str] = None) -> bool:
    """Fire-and-forget notify-out. Returns True if a dispatch was enqueued.

    Never raises: an opt-out, a missing broker, or any other failure logs a
    warning and returns False — the caller's business operation proceeds
    untouched either way.
    """
    try:
        if not is_notify_enabled(db, event_key):
            return False
    except Exception as exc:  # settings table unreadable — fail closed, quietly
        logger.warning("[aci] notify-out settings check failed for %s: %s", event_key, exc)
        return False

    try:
        from app.tasks.aci_tasks import notify_out_task
        notify_out_task.delay(event_key=event_key, title=title, body=body, link=link)
        logger.info("[aci] notify-out dispatched event_key=%s", event_key)
        return True
    except Exception as exc:
        logger.warning("[aci] notify-out dispatch failed for %s (business "
                       "operation unaffected): %s", event_key, exc)
        return False
