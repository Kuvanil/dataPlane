"""Celery application instance for async task processing."""

from celery import Celery
from celery.schedules import crontab
from app.core.config import settings

celery_app = Celery(
    "dataplane",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    # include lists every module that defines @celery_app.task. Both must be
    # registered or the worker silently drops incoming tasks ("Received
    # unregistered task of name ..."). Schema Mapper requires BOTH:
    # - app.tasks.ai_tasks: schema drift + NL2SQL helpers
    # - app.workers.mapping_tasks: the AI suggestion task (added after the
    #   §11.1 review caught the original omission that made "Get AI
    #   Suggestions" a silent no-op in production).
    include=[
        "app.tasks.ai_tasks",
        "app.tasks.connector_tasks",
        "app.workers.mapping_tasks",
    ],
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
        "health-check-all-connections": {
            "task": "app.tasks.connector_tasks.run_all_health_checks",
            "schedule": crontab(minute=f"*/{settings.HEALTH_CHECK_INTERVAL_MINUTES}"),
        },
    },
    timezone="UTC",
)
