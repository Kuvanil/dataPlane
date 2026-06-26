import sys
import os

# No need to append /Users/... paths inside container! Imports are relative to /app !
from app.services.schema_service import SchemaService
from app.services.diff_service import DiffService
from app.services.security_service import SecurityService
from app.services.ai_service import AIService

def run_e2e_demo():
    print("🚀 --- dataPlane End-to-End Simulation --- 🚀\n")

    # 1. Mock Schemas (Simulating Connected DBs)
    source_schema = {
        "users": [
            {"name": "id", "type": "INTEGER"},
            {"name": "email", "type": "TEXT"},
            {"name": "created_at", "type": "TIMESTAMP"}
        ]
    }

    target_schema = {
        "customers": [
            {"name": "customer_id", "type": "INT"},
            {"name": "contact_email", "type": "VARCHAR"},
            {"name": "signup_date", "type": "DATE"}
        ]
    }

    print("Step 1: Scanned Schemas Successfully.")
    print(f"  Source: {list(source_schema.keys())}")
    print(f"  Target: {list(target_schema.keys())}\n")

    # 2. Schema Diff
    print("Step 2: Running Structural Diff...")
    diff_results = DiffService.compare_schemas(source_schema, target_schema)
    print(f"  Matched Tables: {diff_results['matched_tables']}")
    print(f"  Missing in target: {diff_results['missing_tables_in_target']}")
    print(f"  Missing in source: {diff_results['missing_tables_in_source']}\n")

    # 3. Security Tagging
    print("Step 3: Auto-Classifying Data Sensitivity...")
    classifications = SecurityService.classify_schema(source_schema)
    for table, cols in classifications.items():
        print(f"  Table: {table}")
        for c in cols:
            print(f"    Column: {c['column']} ➝ Label: {c['classification']['label']} ({c['classification']['level']} Risk)")
    print()

    # 4. AI Matching Sub-Flow
    print("Step 4: AI Semantic Matcher Simulation...")
    match_results = AIService.match_schemas(
        source_name="users",
        source_schema=source_schema["users"],
        target_name="customers",
        target_schema=target_schema["customers"]
    )
    print(f"  Matches Found: {len(match_results.get('matches', []))}")
    for match in match_results.get("matches", []):
         print(f"    {match['source']} ➝ {match['target']} ({match['confidence']}% confidence)")

    print("\n✅ Simulation Complete: Verification Success.")

if __name__ == "__main__":
    run_e2e_demo()
