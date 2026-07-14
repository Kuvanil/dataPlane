# dataPlane — Use Cases & Capabilities

> A tour of what you can do with dataPlane, written for a non-technical audience.
> All examples use the built-in demo data that comes pre-loaded when you start the app.

---

## 🧭 Overview

dataPlane is an **AI-first data engineering platform**. It helps you:

- **Discover** what data you have and where it lives
- **Understand** your data's structure, quality, and sensitivity
- **Query** your data using plain English or SQL
- **Transform** and **move** data between systems
- **Monitor** your data pipelines and schema changes
- **Govern** who can see what

The app comes with **6 pre-loaded demo databases** covering CRM, E-Commerce, Finance, HR, Data Warehousing, and Retail Analytics. Everything below works out of the box.

---

## 1. 🤖 AskData — Ask questions in plain English

**What it does:** Type a question in natural language and AskData generates SQL, runs it against your database, and shows you the answer.

**Realistic scenarios:**

| You ask | What happens |
|---|---|
| "show me all customers from New York" | AskData generates `SELECT * FROM customers WHERE city = 'New York'`, runs it, returns the matching rows |
| "what's the total revenue by product category?" | Generates an aggregation query against the E-Commerce database, returns a summary table |
| "how many employees are in each department?" | Queries the HR database, groups by department, shows headcounts |
| "show me orders that are still pending" | Filters the orders table by status, returns only pending orders |
| "which products have the most reviews?" | Joins products with reviews, counts per product, sorts descending |

**Try it:** Open the sidebar → **Query Workspace** → **Ask** tab. Select a connection from the dropdown, type your question, hit Send.

---

## 2. 💬 Query Studio — Write and run SQL

**What it does:** A full SQL editor with syntax highlighting, autocomplete for table/column names, paginated results, and export to CSV.

**Realistic scenarios:**

| What you can do | Example |
|---|---|
| Write a SELECT query | `SELECT o.order_id, c.first_name, c.last_name, o.total_amount FROM orders o JOIN customers c ON o.customer_id = c.customer_id WHERE o.status = 'delivered' ORDER BY o.total_amount DESC LIMIT 20;` |
| Run aggregations | `SELECT category, COUNT(*) as product_count, ROUND(AVG(price), 2) as avg_price FROM products GROUP BY category ORDER BY avg_price DESC;` |
| Explore a new table | `SELECT * FROM analytics_orders LIMIT 10;` — see the column names and data types |
| Export results | Click **Export CSV** to download query results as a file |
| Save queries | Click **Save** to bookmark a query for later use |
| Browse history | The **History** panel shows every query you've run |

**Try it:** Open the sidebar → **Query Workspace** → **SQL** tab. Type a query, press `⌘+Enter` (Mac) or `Ctrl+Enter` (Windows) to run it.

---

## 3. 🧠 Schema Intel — Understand your data's structure and sensitivity

**What it does:** Scans your databases to discover tables, columns, data types, and automatically classifies sensitive data (PII like emails, phone numbers, SSNs).

**Realistic scenarios:**

| What you can do | Why it matters |
|---|---|
| **Browse the catalog** | See every table and column across all your connected databases in one place |
| **Check classifications** | Schema Intel automatically labels columns as **PII** (personally identifiable info), **Sensitive**, or **Public**. For example, `ssn` in the HR database gets flagged as PII/High risk |
| **Override classifications** | If the AI misclassifies something, an admin can manually correct it |
| **Profile columns** | See statistics: null rate, distinct values, min/max values — helps you understand data quality |
| **Track schema drift** | When someone adds a column, renames a table, or changes a data type, Schema Intel detects it and shows you what changed |
| **Investigate PII** | Click **Investigate →** on a PII-classified column to jump to AskData with a pre-filled question about that column's data |
| **Investigate drift** | Click **Investigate {table} →** on a drift event to jump to Query Studio with a `SELECT *` query pre-loaded for the affected table |

**Try it:** Open the sidebar → **Schema Intel**. Select a connection, click **Scan catalog** to discover tables, then **Profile columns** to analyze them.

---

## 4. 🗺️ Schema Mapper — Map data between systems

**What it does:** Visually design how data flows from a source database to a target database — defining which columns map to which, with transformations.

**Realistic scenarios:**

| What you can do | Example |
|---|---|
| **Create a mapping** | Map `CRM_Source_Analytics` (source) to `Data_Warehouse_Target` (destination) |
| **Drag to connect fields** | Visually connect `crm_users.email_address` → `dw_customers.contact_email` |
| **Add transformations** | Cast a `TEXT` field to `VARCHAR`, concatenate first+last name, apply default values |
| **Get AI suggestions** | Click **Get AI Suggestions** to have the AI propose mappings for unmapped columns |
| **Investigate suggestions** | Click **Investigate →** on a low-confidence suggestion to jump to Query Studio and inspect the actual data before accepting |
| **Validate** | Check for type mismatches, null safety issues, missing required fields |
| **Publish** | Lock in a versioned, audited mapping that pipelines can consume |
| **Export** | Download the mapping as a JSON artifact for use in data pipeline configurations |

**Try it:** Open the sidebar → **Schema Mapper**. Create a new mapping, select source and target connections, then drag fields to connect them.

---

## 5. 🌐 Visualize — Build charts and dashboards

**What it does:** Create visualizations from your data — bar charts, line charts, pie charts, and more.

**Realistic scenarios:**

| What you can do | Example |
|---|---|
| **Revenue by month** | Bar chart showing monthly revenue from the Data Warehouse fact tables |
| **Orders by status** | Pie chart showing the distribution of order statuses (delivered, pending, cancelled) |
| **Employee count by department** | Bar chart of headcount across Engineering, Sales, Marketing, etc. |
| **Product category performance** | Horizontal bar chart comparing average price or total revenue by category |
| **Export charts** | Download visualizations as images or embed them in reports |

**Try it:** Open the sidebar → **Visualize**. Select a connection, pick your metrics and dimensions, choose a chart type.

---

## 6. 🔗 Pipelines — Automate data movement

**What it does:** Schedule and run data pipelines that move and transform data between systems on a recurring basis.

**Realistic scenarios:**

| What you can do | Example |
|---|---|
| **Create a pipeline** | Define a pipeline that reads from `CRM_Source_Analytics`, applies the Schema Mapper's mapping, and writes to `Data_Warehouse_Target` |
| **Schedule it** | Run daily at 2 AM to keep the warehouse in sync |
| **Monitor runs** | See run history: start time, duration, rows processed, success/failure |
| **Handle failures** | Configure retry logic — if a run fails, retry up to 3 times with exponential backoff |
| **View drift impact** | If Schema Intel detects drift in a source table, see which pipelines are affected |

**Try it:** Open the sidebar → **Pipelines**. Create a new pipeline, configure source and target, set a schedule.

---

## 7. 📋 Audit Trail — See who did what

**What it does:** Every action in the platform is logged — who ran what query, when, against which connection, and what the outcome was.

**Realistic scenarios:**

| What you can do | Why it matters |
|---|---|
| **See all queries** | Every AskData question and every SQL execution is recorded with timestamp, user, and connection |
| **Filter by module** | Separate AskData chat queries from Query Studio SQL executions |
| **Filter by outcome** | See only failed queries to troubleshoot issues |
| **Export audit logs** | Download as CSV or JSON for compliance reporting |
| **Correlation tracing** | Follow a single user's actions across the platform in chronological order |

**Try it:** Open the sidebar → **Audit Trail**. Use the filters to narrow down by module, event type, or date range.

---

## 8. 🛡️ Security — Control access

**What it does:** Role-based access control (RBAC), data masking policies, and row-level security.

**Realistic scenarios:**

| What you can do | Example |
|---|---|
| **Assign roles** | Give someone the **Admin** role (full access), **Analyst** role (can query and map), or **Viewer** role (read-only) |
| **Mask sensitive columns** | Configure masking on `ssn` or `credit_card_number` so viewers see `***-**-****` instead of real values |
| **Row-level filters** | Restrict a sales rep to only see data for their own region |
| **View permission matrix** | See exactly which permissions each role has across all features |

**Try it:** Open the sidebar → **Security**. Browse roles, assign users, configure masking policies.

---

## 9. 🔌 Connectors — Manage database connections

**What it does:** Add, test, and monitor connections to your databases.

**Realistic scenarios:**

| What you can do | Example |
|---|---|
| **View all connections** | See the 6 pre-loaded demo connections with their health status |
| **Test a connection** | Click **Test** to verify the connection is working and see diagnostics |
| **Monitor health** | The dashboard shows connection health at a glance — green for healthy, red for down |
| **Soft-delete** | Remove a connection without losing its history (can be restored) |

**Try it:** Open the sidebar → **Connectors**. You'll see all 6 demo connections listed with their types and status.

---

## 10. 📊 Dashboard — At-a-glance overview

**What it does:** A home screen with KPI tiles, activity feed, and quick insights.

**Realistic scenarios:**

| What you can see | Description |
|---|---|
| **Connection health** | How many databases are connected and their status |
| **Recent queries** | Latest AskData questions and SQL executions |
| **Schema changes** | Recent drift events detected by Schema Intel |
| **Pipeline status** | Recent pipeline runs and their outcomes |
| **KPI tiles** | Configurable metrics like total tables discovered, PII columns flagged, mappings published |

**Try it:** Open the sidebar → **Dashboard**.

---

## 11. ⚙️ AI Autopilot — Automated governance

**What it does:** AI-driven recommendations and automated actions for data governance.

**Realistic scenarios:**

| What you can do | Example |
|---|---|
| **View recommendations** | See AI-generated suggestions for improving data quality, security, or mapping coverage |
| **Approve actions** | Review and approve/deny AI-proposed actions before they execute |
| **Set policies** | Define guardrails: "automatically flag any column named 'ssn' as PII" |
| **View action log** | See a history of all AI-suggested actions and their outcomes |

**Try it:** Open the sidebar → **AI Autopilot**.

---

## 12. 📐 Semantic / Metrics — Define business metrics

**What it does:** Define and manage business metrics (revenue, churn, etc.) with consistent definitions across the platform.

**Realistic scenarios:**

| What you can do | Example |
|---|---|
| **Define a metric** | Create a "Monthly Recurring Revenue" metric with a precise SQL definition |
| **Add dimensions** | Define how to slice by region, product category, customer segment |
| **Track lineage** | See which source tables and columns feed into each metric |
| **Reuse across tools** | Metrics defined here are available in AskData, Query Studio, and Visualize |

**Try it:** Open the sidebar → **Semantic / Metrics**.

---

## 🎯 End-to-End Walkthrough: "Investigate a PII Concern"

Here's how the features work together in a real scenario:

1. **Schema Intel** scans the HR database and flags the `ssn` column as **PII / High risk**
2. You click **Investigate →** on that column
3. You land in **Query Workspace** (Ask mode) with the question pre-filled: *"What does the current data in employees.ssn look like, and is there anything that looks like exposed PII I should be aware of?"*
4. AskData generates and runs a query, showing you sample data
5. You decide the SSNs need masking — go to **Security** and add a masking policy
6. The **Audit Trail** records every step: the scan, the investigation, the policy change

---

## 🚀 Getting Started

1. Start the app: `docker compose up -d`
2. Open `http://localhost:3000` in your browser
3. Log in with `admin@dataplane.ai` / `admin123`
4. Open the sidebar and explore each feature
5. All 6 demo databases are pre-loaded with realistic data — no setup needed