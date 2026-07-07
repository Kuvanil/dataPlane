from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "dataPlane"
    DATABASE_URL: str = "postgresql://postgres:postgres@postgres:5432/dataplane"
    OLLAMA_HOST: str = "http://host.docker.internal:11434"
    OLLAMA_MODEL: str = "llama3"
    OLLAMA_TIMEOUT: int = 15
    OLLAMA_MAX_RETRIES: int = 2
    CELERY_BROKER_URL: str = "redis://broker:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://broker:6379/0"
    LOG_LEVEL: str = "INFO"
    SCHEMA_DRIFT_INTERVAL_MINUTES: int = 60
    SECRET_KEY: str = "change-me-in-production-use-a-long-random-string"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    ADMIN_DEFAULT_PASSWORD: str = "admin123"
    # Dashboard aggregation cache (dashboard_tasks #2). TTL <= 0 disables caching.
    DASHBOARD_CACHE_TTL: int = 30
    DASHBOARD_CACHE_MAXSIZE: int = 256
    # Connectors (connector_tasks #4/#5): hard cap on test-connection time
    # (TRD perf NFR: ≤5s or clear timeout) and health-check cadence/throttle.
    CONNECTOR_TEST_TIMEOUT_SECONDS: int = 5
    HEALTH_CHECK_INTERVAL_MINUTES: int = 5
    HEALTH_CHECK_RATE_LIMIT: str = "10/m"

    class Config:
        env_file = ".env"

settings = Settings()
