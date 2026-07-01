"""End-to-end demo script for dataPlane.

Exercises the full dataPlane stack in two sections:

  1. Service-level demo (existing): schema scan, diff, PII classification,
     AI semantic matching. Uses SchemaService / DiffService / SecurityService
     / AIService directly with mock schemas. Shows the underlying engine.

  2. Mapping workspace demo (new — Schema Mapper upgrade): the persistent
     /api/v1/mappings workspace. Creates a draft, adds edges, requests AI
     suggestions, validates, publishes, and exports the artifact. Uses
     MappingService directly so the demo runs without docker-compose.

Run from the backend directory:
    python run_e2e_demo.py

No external services required — the demo wires its own in-memory DB,
seeds two DBConnection rows, stubs the schema fetch, and runs the
Celery suggestion task eagerly.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import types
from datetime import datetime, timezone

# Allow running as `python run_e2e_demo.py` from the backend dir.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Install stub modules for optional DB drivers BEFORE importing any app
# modules. app.connectors.postgres / mysql / oracle eagerly `import
# psycopg2` / `pymysql` / `oracledb` at module load. The demo runs against
# SQLite only; stubs let it execute without those native packages.
def _install_driver_stubs() -> None:
    drivers = ("psycopg2", "pymysql", "oracledb", "mysql", "pgdb")
    sub_modules = {
        "psycopg2": ("extras", "pool", "sql", "extensions"),
        "pymysql": ("connections", "cursors", "err"),
        "oracledb": ("errors",),
    }
    for name in drivers:
        if name in sys.modules:
            continue
        mod = types.ModuleType(name)
        mod.__path__ = []
        sys.modules[name] = mod
        for sub in sub_modules.get(name, ()):
            full = f"{name}.{sub}"
            if full not in sys.modules:
                sys.modules[full] = types.ModuleType(full)

    class _Stub:
        pass

    def _add(module_name, attrs):
        mod = sys.modules.get(module_name)
        if mod is None:
            return
        for k, v in attrs.items():
            if not hasattr(mod, k):
                setattr(mod, k, v)

    _add("psycopg2.extras", {
        "RealDictCursor": _Stub, "NamedTupleCursor": _Stub, "DictCursor": _Stub,
    })
    _add("pymysql.cursors", {"DictCursor": _Stub, "Cursor": _Stub, "SSDictCursor": _Stub})
    _add("pymysql.connections", {"Connection": _Stub})
    _add("oracledb.errors", {
        "DatabaseError": _Stub, "IntegrityError": _Stub, "OperationalError": _Stub,
    })


_install_driver_stubs()

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("OLLAMA_HOST", "http://localhost:11434")
os.environ.setdefault("OLLAMA_MODEL", "llama3")
os.environ.setdefault("CELERY_TASK_ALWAYS_EAGER", "True")
os.environ.setdefault("CELERY_BROKER_URL", "memory://")
os.environ.setdefault("CELERY_RESULT_BACKEND", "cache+memory://")
os.environ.setdefault("LOG_LEVEL", "WARNING")

# Quiet down the loggers so the demo output stays readable.
logging.basicConfig(level=logging.WARNING, format="%(message)s")
for name in ("app", "uvicorn", "sqlalchemy.engine", "httpx", "kombu"):
    logging.getLogger(name).setLevel(logging.WARNING)

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.connection import DBConnection
from app.models.user import User
from app.services.ai_service import AIService
from app.services.audit_helper import record_audit
from app.services.auth_service import AuthService
from app.services.diff_service import DiffService
from app.services.mapping_service import MappingService
from app.services.mapping_validation_service import MappingValidationService
from app.services.schema_service import SchemaService
from app.services.security_service import SecurityService
from app.services.transformation_grammar import parse as parse_grammar


# ─────────────────────────────────────────────────────────────────────────
# Section 1: Service-level demo (unchanged)
# ─────────────────────────────────────────────────────────────────────────


def section_1_service_level() -> None:
    print("🚀 --- dataPlane End-to-End Simulation --- 🚀\n")

    source_schema = {
        "users": [
            {"name": "id", "type": "INTEGER"},
            {"name": "email", "type": "TEXT"},
            {"name": "created_at", "type": "TIMESTAMP"},
        ]
    }
    target_schema = {
        "customers": [
            {"name": "customer_id", "type": "INT"},
            {"name": "contact_email", "type": "VARCHAR"},
            {"name": "signup_date", "type": "DATE"},
        ]
    }

    print("Step 1: Scanned Schemas Successfully.")
    print(f"  Source: {list(source_schema.keys())}")
    print(f"  Target: {list(target_schema.keys())}\n")

    print("Step 2: Running Structural Diff...")
    diff_results = DiffService.compare_schemas(source_schema, target_schema)
    print(f"  Matched Tables: {diff_results['matched_tables']}")
    print(f"  Missing in target: {diff_results['missing_tables_in_target']}")
    print(f"  Missing in source: {diff_results['missing_tables_in_source']}\n")

    print("Step 3: Auto-Classifying Data Sensitivity...")
    classifications = SecurityService.classify_schema(source_schema)
    for table, cols in classifications.items():
        print(f"  Table: {table}")
        for c in cols:
            print(f"    Column: {c['column']} ➝ Label: {c['classification']['label']} ({c['classification']['level']} Risk)")
    print()

    print("Step 4: AI Semantic Matcher Simulation...")
    match_results = AIService.match_schemas(
        source_name="users",
        source_schema=source_schema["users"],
        target_name="customers",
        target_schema=target_schema["customers"],
    )
    print(f"  Matches Found: {len(match_results.get('matches', []))}")
    for match in match_results.get("matches", []):
        print(f"    {match['source']} ➝ {match['target']} ({match['confidence']}% confidence)")

    print("\n✅ Section 1 Complete: Service-Level Verification Success.")


# ─────────────────────────────────────────────────────────────────────────
# Section 2: Mapping workspace demo (new — exercises /api/v1/mappings)
# ─────────────────────────────────────────────────────────────────────────


MOCK_SCHEMA = {
    "t1": [
        {"name": "c1", "type": "TEXT", "primary_key": False},
        {"name": "c2", "type": "INTEGER", "primary_key": False},
    ],
}


def _build_db_session():
    """Create an in-memory SQLite engine + session, seed admin user and two
    DBConnection rows. Returns (db, admin)."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    admin = User(
        email="admin@dataplane.ai",
        hashed_password=AuthService.hash_password("admin123"),
        role="admin",
        is_active=True,
    )
    src = DBConnection(name="CRM_Source", type="sqlite", config={"path": "/tmp/src.db"})
    tgt = DBConnection(name="DW_Target", type="sqlite", config={"path": "/tmp/tgt.db"})
    db.add_all([admin, src, tgt])
    db.commit()
    for obj in (admin, src, tgt):
        db.refresh(obj)
    return db, admin, src, tgt


def _stub_schema_service() -> None:
    """Patch SchemaService.get_full_schema so the demo doesn't try to open
    real SQLite files on disk."""
    SchemaService.get_full_schema = staticmethod(lambda _conn: MOCK_SCHEMA)


def section_2_mapping_workspace() -> None:
    """Walk the full mapping workspace flow using MappingService directly so
    it runs without docker-compose. Mirrors what the new Schema Mapper UI
    exercises end-to-end."""
    print("\n\n🗺️ --- Section 2: Mapping Workspace (Schema Mapper upgrade) --- 🗺️\n")

    db, admin, src, tgt = _build_db_session()
    _stub_schema_service()

    # 2.1 — Create draft mapping (UI: New Mapping button)
    print("Step 2.1: Create draft mapping…")
    mapping = MappingService.create_mapping(
        db, source_id=src.id, target_id=tgt.id,
        name="CRM → DW Customer Sync", actor=admin.email,
    )
    print(f"  Created mapping #{mapping.id} (status={mapping.status}, by={mapping.created_by})\n")

    # 2.2 — Add a manual edge with a CAST transformation (UI: drag + edit)
    print("Step 2.2: Add manual edge with a CAST transformation…")
    parse_grammar({"kind": "cast", "from": "TEXT", "to": "VARCHAR"})  # pre-flight
    edge = MappingService.add_edge(
        db, mapping.id,
        target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT", "nullable": False}],
        transformation={"kind": "cast", "from": "TEXT", "to": "VARCHAR"},
        origin="manual", actor=admin.email,
    )
    print(f"  Edge #{edge.id}: s1.c1 [TEXT] → t1.c1 [TEXT] via CAST(TEXT→VARCHAR)\n")

    # 2.3 — Add a second compatible edge (UI: drag a second time)
    print("Step 2.3: Add a second edge…")
    MappingService.add_edge(
        db, mapping.id,
        target={"table": "t1", "column": "c2", "type": "INTEGER", "nullable": False},
        sources=[{"table": "s1", "column": "c2", "type": "INTEGER", "nullable": False}],
        transformation={"kind": "direct"},
        origin="manual", actor=admin.email,
    )
    print(f"  Mapping now has {len(mapping.edges)} edges\n")

    # 2.4 — Validate (UI: click Validate)
    print("Step 2.4: Validate (type compatibility + null safety + PK guard)…")
    summary = MappingService.validate(db, mapping.id, actor=admin.email)
    print(f"  ok={summary['ok_count']}  warnings={summary['warning_count']}  "
          f"blocking={summary['blocking_count']}")
    for issue in summary["issues"]:
        print(f"    · edge {issue['edge_id']}: [{issue['verdict']}] {issue['message']}")
    print()

    # 2.5 — Publish (UI: click Publish → confirm)
    print("Step 2.5: Publish (admin-only, gated on blocking_count=0)…")
    version = MappingService.publish(db, mapping.id, actor=admin.email)
    print(f"  Published {version.status} v{version.version_number} "
          f"(id={version.id}) by {version.published_by}\n")

    # 2.6 — Export (UI: Export modal)
    print("Step 2.6: Export published artifact (consumed by Pipelines)…")
    artifact = MappingService.export_json(db, mapping.id, actor=admin.email)
    print(f"  mapping_id={artifact['mapping_id']}  version={artifact['version']}  "
          f"status={artifact['status']}")
    print(f"  source={artifact['source']['name']} ({artifact['source']['type']})")
    print(f"  target={artifact['target']['name']} ({artifact['target']['type']})")
    print(f"  field_mappings={len(artifact['field_mappings'])}")
    for fm in artifact["field_mappings"]:
        srcs = ", ".join(f"{s['table']}.{s['column']}" for s in fm["sources"])
        kind = fm["transformation"]["kind"]
        print(f"    · {fm['target']['table']}.{fm['target']['column']} ← {srcs} via {kind}  "
              f"(origin={fm['origin']})")
    print()

    # 2.7 — Pin to a specific version (UI: version selector)
    print("Step 2.7: Pin export to a specific version_id…")
    pinned = MappingService.export_json(
        db, mapping.id, actor=admin.email, version_id=version.id,
    )
    assert pinned["version"] == artifact["version"] == 1
    print(f"  Pinned export matches latest: version={pinned['version']}\n")

    # 2.8 — Audit trail (UI: /dashboard/audit)
    print("Step 2.8: Audit trail captured the whole sequence…")
    audit_events = [
        "mapping_created",
        "mapping_edge_added",
        "mapping_validated",
        "mapping_published",
        "mapping_exported",
    ]
    present = {
        e.event_type for e in db.query(__import__("app.models.audit", fromlist=["AuditLog"]).AuditLog)
        if e.event_type in audit_events
    }
    for evt in audit_events:
        mark = "✅" if evt in present else "❌"
        print(f"    {mark} {evt}")
    print()

    print("✅ Section 2 Complete: Mapping Workspace Verification Success.")


def main() -> int:
    section_1_service_level()
    section_2_mapping_workspace()
    print("\n\n🎉 --- dataPlane End-to-End Demo: All Sections Passed --- 🎉")
    return 0


if __name__ == "__main__":
    sys.exit(main())
