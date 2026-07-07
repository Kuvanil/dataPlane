# Task #2 — Caching Layer for Dashboard Summaries (DASH-T2)

**TRD reference:** Performance NFR (initial render ≤ 2.5s, widget refresh ≤ 1.5s), §10 risk table (slow load from many module calls).

**Current state:** The aggregation API (Task #1) fans out to 6+ module tables on every request. No caching exists anywhere in this codebase yet — this is the first caching implementation.

## Scope

Add a lightweight in-process cache for the dashboard summary endpoint, keyed by user + range, with a short configurable TTL. Use `cachetools.TTLCache` (already available — no new dependencies) rather than introducing Redis, keeping the first implementation simple.

### Cache design

- **Cache key:** `f"dashboard_summary:{user_id}:{range}"` (string)
- **Cache value:** Serialized `DashboardSummary` response
- **TTL:** 30 seconds (configurable via `settings.DASHBOARD_CACHE_TTL`)
- **Max size:** 256 entries (32 users × 3 range options × ~2.5 — sufficient for development)

### Implementation — `backend/app/services/dashboard_cache.py` (new)

```python
from cachetools import TTLCache
from app.core.config import settings

# Module-level singleton cache
_dashboard_cache: TTLCache | None = None

def get_cache() -> TTLCache:
    global _dashboard_cache
    if _dashboard_cache is None:
        _dashboard_cache = TTLCache(
            maxsize=getattr(settings, "DASHBOARD_CACHE_MAXSIZE", 256),
            ttl=getattr(settings, "DASHBOARD_CACHE_TTL", 30),
        )
    return _dashboard_cache

def invalidate_all():
    """Invalidate all dashboard cache entries. Called when any module data changes."""
    cache = get_cache()
    cache.clear()
```

### Integration in `dashboard_service.py`

Wrap `get_summary()` with a cache-check before the fan-out and a cache-set after:

```python
def get_summary(self, range: str = "7d", user=None) -> DashboardSummary:
    cache = get_cache()
    user_id = getattr(user, "id", "anonymous")
    cache_key = f"dashboard_summary:{user_id}:{range}"

    # Check cache
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    # Fan out (existing logic from Task #1)
    result = self._do_get_summary(range=range, user=user)

    # Set cache
    cache[cache_key] = result
    return result
```

### Cache invalidation triggers

The dashboard cache should be invalidated when any underlying module data changes. Add calls to `invalidate_all()` in the following places:

| Action | Module | Where to add invalidation |
|--------|--------|--------------------------|
| Connector created/deleted | Connectors | `connectors.py` router, after successful create/delete |
| Mapping created/deleted | Schema Mapper | `mappings.py` router, after successful create/delete |
| Pipeline created/run/deleted | Pipelines | `pipelines.py` router, after successful create/run/delete |
| Audit event recorded | Audit | `audit_helper.py` `record_audit()` — **but this would fire on every audit event, defeating the cache. Instead, let the TTL handle it.** |
| Autopilot action recorded | AI Autopilot | `autopilot.py` router, after recording a new action |

**Decision:** For the first implementation, do NOT add explicit invalidation calls. The 30s TTL is short enough that stale data is acceptable for a dashboard overview. Explicit invalidation is a future optimization.

## Dependencies

- `cachetools` (check if already in `requirements.txt`; if not, add it)
- Task #1's aggregation API

## Edge cases

- **Cache miss on first request:** Every user's first request after deployment or TTL expiry is a cache miss and fans out to all modules. This is expected and acceptable (cold start).
- **TTL of 0 disables caching:** If `DASHBOARD_CACHE_TTL = 0`, every request bypasses the cache. Useful for debugging.
- **Memory limits:** `maxsize=256` prevents unbounded growth. Oldest entries are evicted first when the cache is full.
- **Concurrent requests:** `TTLCache` is thread-safe for reads; writes are not atomic in a multi-worker scenario (each worker process has its own cache). For a single-worker dev setup this is fine. For production with multiple workers, a shared cache (Redis) would be needed — flagged as a future enhancement.
- **Cache poisoning:** The cache key includes `user_id`, so one user cannot see another user's cached data (role-scoping is per-user).

## Verify

```python
# Test 1: First request is a cache miss, second is a cache hit
response1 = client.get("/api/v1/dashboard/summary")
response2 = client.get("/api/v1/dashboard/summary")
assert response1.json() == response2.json()  # Same data (within TTL)

# Test 2: Different ranges produce different cache entries
r7d = client.get("/api/v1/dashboard/summary?range=7d")
r24h = client.get("/api/v1/dashboard/summary?range=24h")
assert r7d.json()["range"] == "7d"
assert r24h.json()["range"] == "24h"

# Test 3: TTL expiry produces fresh data
import time
time.sleep(DASHBOARD_CACHE_TTL + 1)
fresh = client.get("/api/v1/dashboard/summary")
assert fresh.status_code == 200
```

## Risk

Low. The cache is purely an optimization; if it breaks, the aggregation API still works (cold path). The main risk is memory growth from unbounded cache entries, mitigated by `maxsize`.