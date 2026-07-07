import logging
import logging.config
import time
import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.api.routers import connectors, schema, agent, query, askdata, mapper, pipelines
from app.api.routers import tasks as tasks_router
from app.api.routers import audit as audit_router
from app.api.routers import auth as auth_router
from app.api.routers import autopilot as autopilot_router
from app.api.routers import mappings as mappings_router
from app.api.routers import schema_catalog as schema_catalog_router
from app.api.routers import dashboard as dashboard_router
from app.core.celery_app import celery_app  # noqa: F401  (registers tasks on import)
from app.core.config import settings
from app.core.database import Base, engine, SessionLocal
from app.models.connection import DBConnection  # ensure models loaded
from app.models.audit import AuditLog  # noqa: F401
from app.models.query_history import QueryHistory  # noqa: F401
from app.models.chat_session import ChatMessage  # noqa: F401
from app.models.schema_snapshot import SchemaSnapshot  # noqa: F401
from app.models.drift_event import DriftEvent  # noqa: F401  (Task #6: persisted column-level drift)
from app.models.schema_catalog import CatalogTable, CatalogColumn, CatalogForeignKey  # noqa: F401  (Task #1: persisted schema catalog)
from app.models.user import User  # noqa: F401
from app.models.autopilot import AutopilotRun, AutopilotLog  # noqa: F401
from app.models.mapping import (  # noqa: F401  (ensure mapping tables are created)
    Mapping, MappingVersion, FieldMapping, AISuggestion,
)

# ── Structured logging setup ──────────────────────────────────────────────────
logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "format": "%(asctime)s %(levelname)s %(name)s %(message)s",
        }
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json",
        }
    },
    "root": {
        "level": settings.LOG_LEVEL,
        "handlers": ["console"],
    },
})
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Create tables
    Base.metadata.create_all(bind=engine)

    # 2. Seed physical dummy databases on filesystem for demo
    import sqlite3
    import os
    os.makedirs("/shared/data", exist_ok=True)
    try:
        os.chmod("/shared/data", 0o777)
    except OSError:
        pass

    # ── Source DB: CRM ────────────────────────────────────────
    src_path = "/shared/data/dataplane_crm_source.db"
    if not os.path.exists(src_path):
        conn = sqlite3.connect(src_path)
        c = conn.cursor()
        c.execute("CREATE TABLE crm_users (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, email_address TEXT, phone_number TEXT, created_at TIMESTAMP)")
        c.execute("CREATE TABLE crm_leads (id INTEGER PRIMARY KEY, email TEXT, company TEXT, status VARCHAR(20), score INTEGER, source TEXT)")
        c.execute("CREATE TABLE crm_activities (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, timestamp TIMESTAMP, ip_address TEXT)")
        # Insert synthetic data
        users = [
            (1, 'Alice', 'Johnson', 'alice.johnson@acme.com', '+1-555-0101', '2025-01-15 09:30:00'),
            (2, 'Bob', 'Smith', 'bob.smith@globex.com', '+1-555-0102', '2025-02-20 14:15:00'),
            (3, 'Carol', 'Williams', 'carol.w@initech.com', '+1-555-0103', '2025-03-10 11:45:00'),
            (4, 'David', 'Brown', 'david.brown@umbrella.co', '+1-555-0104', '2025-03-22 16:00:00'),
            (5, 'Eve', 'Davis', 'eve.davis@wayne.ent', '+1-555-0105', '2025-04-01 08:30:00'),
            (6, 'Frank', 'Miller', 'frank.m@stark.ind', '+1-555-0106', '2025-04-15 10:20:00'),
            (7, 'Grace', 'Wilson', 'grace.wilson@oscorp.com', '+1-555-0107', '2025-05-02 13:00:00'),
            (8, 'Hank', 'Moore', 'hank.moore@lexcorp.com', '+1-555-0108', '2025-05-18 09:45:00'),
        ]
        c.executemany("INSERT INTO crm_users VALUES (?,?,?,?,?,?)", users)
        leads = [
            (1, 'lead1@acme.com', 'Acme Corp', 'qualified', 85, 'website'),
            (2, 'lead2@globex.com', 'Globex Inc', 'new', 45, 'referral'),
            (3, 'lead3@initech.com', 'Initech LLC', 'contacted', 72, 'campaign'),
            (4, 'lead4@umbrella.co', 'Umbrella Co', 'qualified', 91, 'website'),
            (5, 'lead5@wayne.ent', 'Wayne Enterprises', 'new', 30, 'cold_call'),
        ]
        c.executemany("INSERT INTO crm_leads VALUES (?,?,?,?,?,?)", leads)
        activities = [
            (1, 1, 'login', '2025-06-01 08:00:00', '192.168.1.10'),
            (2, 2, 'page_view', '2025-06-01 08:15:00', '10.0.0.25'),
            (3, 1, 'export_data', '2025-06-01 09:00:00', '192.168.1.10'),
            (4, 3, 'login', '2025-06-01 10:30:00', '172.16.0.5'),
            (5, 4, 'update_profile', '2025-06-01 11:00:00', '192.168.1.44'),
        ]
        c.executemany("INSERT INTO crm_activities VALUES (?,?,?,?,?)", activities)
        conn.commit()
        conn.close()

    # ── Target DB: Data Warehouse ─────────────────────────────
    tgt_path = "/shared/data/dataplane_dw_target.db"
    if not os.path.exists(tgt_path):
        conn = sqlite3.connect(tgt_path)
        c = conn.cursor()
        c.execute("CREATE TABLE dw_customers (customer_id INTEGER PRIMARY KEY, given_name TEXT, family_name TEXT, contact_email TEXT, contact_phone TEXT, signup_date DATE)")
        c.execute("CREATE TABLE dw_opportunities (opp_id INTEGER PRIMARY KEY, customer_email TEXT, organization TEXT, stage VARCHAR(30), probability INTEGER)")
        c.execute("CREATE TABLE dw_events (event_id INTEGER PRIMARY KEY, customer_id INTEGER, event_type TEXT, event_date DATE)")
        # Insert synthetic target data
        customers = [
            (101, 'Alice', 'Johnson', 'alice.j@warehouse.com', '+1-555-1001', '2025-01-20'),
            (102, 'Robert', 'Smith', 'r.smith@warehouse.com', '+1-555-1002', '2025-02-25'),
            (103, 'Caroline', 'Williams', 'c.williams@warehouse.com', '+1-555-1003', '2025-03-15'),
        ]
        c.executemany("INSERT INTO dw_customers VALUES (?,?,?,?,?,?)", customers)
        conn.commit()
        conn.close()

    # ── E-Commerce DB (simulating MySQL) ──────────────────────
    ecom_path = "/shared/data/dataplane_ecommerce.db"
    if not os.path.exists(ecom_path):
        conn = sqlite3.connect(ecom_path)
        c = conn.cursor()
        c.execute("CREATE TABLE products (product_id INTEGER PRIMARY KEY, name TEXT, category TEXT, price DECIMAL(10,2), stock_qty INTEGER, sku TEXT)")
        c.execute("CREATE TABLE orders (order_id INTEGER PRIMARY KEY, customer_email TEXT, product_id INTEGER, quantity INTEGER, total_amount DECIMAL(10,2), order_date TIMESTAMP, shipping_address TEXT)")
        c.execute("CREATE TABLE customers (customer_id INTEGER PRIMARY KEY, full_name TEXT, email TEXT, phone TEXT, address TEXT, city TEXT, state TEXT, zip_code TEXT, credit_card_last4 TEXT)")
        products = [
            (1, 'Wireless Mouse', 'Electronics', 29.99, 150, 'WM-001'),
            (2, 'USB-C Hub', 'Electronics', 49.99, 80, 'UC-002'),
            (3, 'Standing Desk', 'Furniture', 399.99, 25, 'SD-003'),
            (4, 'Monitor Arm', 'Accessories', 89.99, 60, 'MA-004'),
            (5, 'Mechanical Keyboard', 'Electronics', 129.99, 45, 'MK-005'),
        ]
        c.executemany("INSERT INTO products VALUES (?,?,?,?,?,?)", products)
        orders = [
            (1, 'alice@shop.com', 1, 2, 59.98, '2025-06-01 10:30:00', '123 Main St, NY'),
            (2, 'bob@shop.com', 3, 1, 399.99, '2025-06-02 14:00:00', '456 Oak Ave, CA'),
            (3, 'carol@shop.com', 2, 3, 149.97, '2025-06-03 09:15:00', '789 Pine Rd, TX'),
            (4, 'alice@shop.com', 5, 1, 129.99, '2025-06-04 16:45:00', '123 Main St, NY'),
        ]
        c.executemany("INSERT INTO orders VALUES (?,?,?,?,?,?,?)", orders)
        customers_data = [
            (1, 'Alice Thompson', 'alice@shop.com', '+1-555-2001', '123 Main St', 'New York', 'NY', '10001', '4242'),
            (2, 'Bob Martinez', 'bob@shop.com', '+1-555-2002', '456 Oak Ave', 'Los Angeles', 'CA', '90001', '1234'),
            (3, 'Carol Chen', 'carol@shop.com', '+1-555-2003', '789 Pine Rd', 'Houston', 'TX', '77001', '5678'),
        ]
        c.executemany("INSERT INTO customers VALUES (?,?,?,?,?,?,?,?,?)", customers_data)
        conn.commit()
        conn.close()

    # ── Finance DB (simulating Oracle) ────────────────────────
    fin_path = "/shared/data/dataplane_oracle_sim_FINDB.db"
    if not os.path.exists(fin_path):
        conn = sqlite3.connect(fin_path)
        c = conn.cursor()
        c.execute("CREATE TABLE GL_ACCOUNTS (ACCOUNT_ID INTEGER PRIMARY KEY, ACCOUNT_NUMBER TEXT, ACCOUNT_NAME TEXT, ACCOUNT_TYPE TEXT, BALANCE DECIMAL(15,2), CURRENCY TEXT)")
        c.execute("CREATE TABLE GL_TRANSACTIONS (TXN_ID INTEGER PRIMARY KEY, ACCOUNT_ID INTEGER, TXN_DATE DATE, AMOUNT DECIMAL(15,2), TXN_TYPE TEXT, DESCRIPTION TEXT, REFERENCE_NO TEXT)")
        c.execute("CREATE TABLE GL_LEDGER (LEDGER_ID INTEGER PRIMARY KEY, PERIOD TEXT, DEBIT_TOTAL DECIMAL(15,2), CREDIT_TOTAL DECIMAL(15,2), NET_BALANCE DECIMAL(15,2), STATUS TEXT)")
        accounts = [
            (1, '1001-00', 'Cash & Equivalents', 'ASSET', 1250000.00, 'USD'),
            (2, '2001-00', 'Accounts Payable', 'LIABILITY', 340000.00, 'USD'),
            (3, '3001-00', 'Retained Earnings', 'EQUITY', 890000.00, 'USD'),
            (4, '4001-00', 'Revenue - Services', 'REVENUE', 2100000.00, 'USD'),
            (5, '5001-00', 'Operating Expenses', 'EXPENSE', 780000.00, 'USD'),
        ]
        c.executemany("INSERT INTO GL_ACCOUNTS VALUES (?,?,?,?,?,?)", accounts)
        transactions = [
            (1, 1, '2025-06-01', 50000.00, 'CREDIT', 'Client payment - Acme Corp', 'INV-2025-001'),
            (2, 5, '2025-06-02', 12500.00, 'DEBIT', 'Cloud infrastructure', 'PO-2025-042'),
            (3, 4, '2025-06-03', 75000.00, 'CREDIT', 'Consulting engagement', 'INV-2025-002'),
            (4, 2, '2025-06-04', 8900.00, 'DEBIT', 'Vendor payment - supplies', 'PO-2025-043'),
            (5, 1, '2025-06-05', 125000.00, 'CREDIT', 'Client payment - Globex', 'INV-2025-003'),
        ]
        c.executemany("INSERT INTO GL_TRANSACTIONS VALUES (?,?,?,?,?,?,?)", transactions)
        ledger = [
            (1, '2025-Q1', 450000.00, 890000.00, 440000.00, 'CLOSED'),
            (2, '2025-Q2', 520000.00, 1050000.00, 530000.00, 'OPEN'),
        ]
        c.executemany("INSERT INTO GL_LEDGER VALUES (?,?,?,?,?,?)", ledger)
        conn.commit()
        conn.close()

    # 3. Seed DBConnection rows
    from sqlalchemy.orm import Session
    db = Session(bind=engine)
    try:
        if not db.query(DBConnection).filter(DBConnection.name == "CRM_Source_Analytics").first():
            db.add(DBConnection(name="CRM_Source_Analytics", type="sqlite", config={"path": src_path}))
            db.add(DBConnection(name="Data_Warehouse_Target", type="sqlite", config={"path": tgt_path}))
            db.add(DBConnection(
                name="ECommerce_MySQL",
                type="sqlite",
                config={"path": ecom_path}
            ))
            db.add(DBConnection(
                name="Finance_Oracle",
                type="oracle",
                config={
                    "host": "localhost-sim",
                    "port": 1521,
                    "service_name": "FINDB",
                    "user": "finance_user",
                    "password": "****"
                }
            ))
            db.add(DBConnection(
                name="HR_Postgres",
                type="postgres",
                config={
                    "host": "postgres",
                    "port": 5432,
                    "dbname": "dataplane",
                    "user": "postgres",
                    "password": "postgres"
                }
            ))
            db.commit()
    finally:
        db.close()

    # 4. Seed default admin user if none exists
    from app.services.auth_service import AuthService
    db = SessionLocal()
    try:
        if not db.query(User).first():
            db.add(User(
                email="admin@dataplane.ai",
                hashed_password=AuthService.hash_password(settings.ADMIN_DEFAULT_PASSWORD),
                role="admin",
                is_active=True,
            ))
            db.commit()
    finally:
        db.close()

    yield

app = FastAPI(
    title="dataPlane API",
    description="Agentic DBA & Data Transformation Platform",
    version="1.0.0",
    lifespan=lifespan
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Request logging middleware ────────────────────────────────────────────────
@app.middleware("http")
async def log_requests(request: Request, call_next):
    request_id = str(uuid.uuid4())[:8]
    start = time.monotonic()
    response = await call_next(request)
    duration_ms = round((time.monotonic() - start) * 1000)
    logger.info(
        "request completed",
        extra={
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "duration_ms": duration_ms,
        },
    )
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Response-Time"] = f"{duration_ms}ms"
    return response

# Include Routers
app.include_router(connectors.router, prefix="/api/v1/connectors", tags=["Connectors"])
app.include_router(schema.router, prefix="/api/v1/schema", tags=["Schema Intelligence"])
app.include_router(agent.router, prefix="/api/v1/agent", tags=["AI Agent"])
app.include_router(query.router, prefix="/api/v1/query", tags=["Query Studio"])
app.include_router(askdata.router, prefix="/api/v1/askdata", tags=["AskData Bot"])
app.include_router(mapper.router, prefix="/api/v1/mapper", tags=["Schema Mapper"])
app.include_router(mappings_router.router, prefix="/api/v1/mappings", tags=["Schema Mapper — Mappings"])
app.include_router(schema_catalog_router.router, prefix="/api/v1/catalog", tags=["Schema Catalog"])
app.include_router(tasks_router.router, prefix="/api/v1/tasks", tags=["Tasks"])
app.include_router(pipelines.router, prefix="/api/v1/pipelines", tags=["Pipelines"])
app.include_router(audit_router.router, prefix="/api/v1/audit", tags=["Audit Trail"])
app.include_router(auth_router.router, prefix="/api/v1/auth", tags=["Auth"])
app.include_router(autopilot_router.router, prefix="/api/v1/autopilot", tags=["AI Autopilot"])
app.include_router(dashboard_router.router, prefix="/api/v1/dashboard", tags=["Dashboard"])

@app.get("/health")
def health_check():
    """Deep health check: verifies DB and Redis connectivity."""
    checks: dict = {}
    overall = "healthy"

    # Database probe
    try:
        db = SessionLocal()
        db.execute(__import__("sqlalchemy").text("SELECT 1"))
        db.close()
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {exc}"
        overall = "degraded"

    # Redis probe
    try:
        import redis as _redis
        broker_url = settings.CELERY_BROKER_URL
        r = _redis.from_url(broker_url, socket_connect_timeout=2)
        r.ping()
        checks["redis"] = "ok"
    except Exception as exc:
        checks["redis"] = f"error: {exc}"
        overall = "degraded"

    status_code = 200 if overall == "healthy" else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "status": overall,
            "service": "dataPlane API",
            "version": "1.0.0",
            "checks": checks,
        },
    )
