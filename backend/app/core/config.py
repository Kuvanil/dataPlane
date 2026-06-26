from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "dataPlane"
    DATABASE_URL: str = "postgresql://postgres:postgres@postgres:5432/dataplane"
    OLLAMA_HOST: str = "http://ollama:11434"
    CELERY_BROKER_URL: str = "redis://broker:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://broker:6379/0"

    class Config:
        env_file = ".env"

settings = Settings()
