"""Celery application instance for async task processing."""

from celery import Celery
from celery.schedules import crontab
from app.core.config import settings

celery_app = Celery(
    "dataplane",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["app.tasks.ai_tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    broker_connection_retry_on_startup=True,
    beat_schedule={
        "check-schema-drift": {
            "task": "app.tasks.ai_tasks.check_schema_drift_task",
            "schedule": crontab(minute=f"*/{settings.SCHEMA_DRIFT_INTERVAL_MINUTES}"),
        },
    },
    timezone="UTC",
)
