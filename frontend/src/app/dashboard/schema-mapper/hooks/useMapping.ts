"use client";
/**
 * useMapping — central state + actions for one open mapping.
 *
 * Owns: mapping, edges, suggestions, selectedEdgeId, dirty/saving/lastSaved,
 *       validation, role, exportVersionId.
 *
 * All persistence happens through the backend; this hook is purely a
 * thin orchestrator with optimistic updates + rollback on error.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type {
  AISuggestion,
  EdgeTransformationUpdate,
  ExportArtifact,
  FieldMapping,
  Mapping,
  Paginated,
  PublishResponse,
  Role,
  SourceRef,
  SuggestionAcceptRequest,
  TargetRef,
  TransformationPayload,
  ValidationResponse,
} from "../lib/types";

const AUTOSAVE_INTERVAL_MS = 30_000;

// The suggestion panel wants "every pending suggestion for this mapping" in
// one shot, not a browsable page -- so it requests the server's max page
// size (see le=200 on GET /mappings/{id}/suggestions) rather than paging.
// A mapping with more than 200 unmapped target columns at once (20% of the
// TRD's 1,000-column ceiling) would need real pagination here too; tracked
// as a known limit rather than built out speculatively.
const SUGGESTIONS_PAGE_LIMIT = 200;

async function fetchAllSuggestions(mappingId: number): Promise<AISuggestion[]> {
  const page = await api.get<Paginated<AISuggestion>>(
    `/api/v1/mappings/${mappingId}/suggestions?limit=${SUGGESTIONS_PAGE_LIMIT}`,
  );
  return page.items;
}

export interface UseMappingResult {
  mapping: Mapping | null;
  edges: FieldMapping[];
  suggestions: AISuggestion[];
  pendingSuggestions: AISuggestion[];
  decidedSuggestions: AISuggestion[];
  selectedEdgeId: number | null;
  dirty: boolean;
  saving: boolean;
  lastSavedAt: string | null;
  error: string | null;
  toast: { kind: "info" | "error" | "success"; message: string } | null;
  validation: ValidationResponse | null;
  exportVersionId: number | null;
  exportArtifact: ExportArtifact | null;
  role: Role | null;

  load(mappingId: number): Promise<void>;
  close(): void;
  create(input: { name: string; source_id: number; target_id: number }): Promise<Mapping>;
  refresh(): Promise<void>;
  addEdge(input: {
    target: TargetRef;
    sources: SourceRef[];
    transformation: TransformationPayload;
    origin?: FieldMapping["origin"];
  }): Promise<FieldMapping | null>;
  removeEdge(edgeId: number): Promise<void>;
  updateTransformation(edgeId: number, transformation: TransformationPayload): Promise<void>;
  selectEdge(edgeId: number | null): void;
  requestSuggestions(): Promise<void>;
  acceptSuggestion(suggestionId: number, transformation?: TransformationPayload): Promise<void>;
  rejectSuggestion(suggestionId: number): Promise<void>;
  validate(): Promise<ValidationResponse | null>;
  publish(): Promise<PublishResponse | null>;
  loadExport(versionId?: number): Promise<ExportArtifact | null>;
  clearExport(): void;
  clearToast(): void;
}

export function useMapping(): UseMappingResult {
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<UseMappingResult["toast"]>(null);
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [exportVersionId, setExportVersionId] = useState<number | null>(null);
  const [exportArtifact, setExportArtifact] = useState<ExportArtifact | null>(null);
  const [role, setRole] = useState<Role | null>(null);

  const mappingIdRef = useRef<number | null>(null);
  const dirtyQueueRef = useRef<Array<() => Promise<void>>>([]);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showToast = useCallback(
    (kind: "info" | "error" | "success", message: string) => {
      setToast({ kind, message });
      setTimeout(() => setToast(null), 5000);
    },
    [],
  );

  // Fetch the current user's role on mount.
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ role: Role }>("/api/v1/auth/me")
      .then((me) => {
        if (!cancelled) setRole(me.role);
      })
      .catch(() => {
        if (!cancelled) setRole(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 30 s autosave flush.
  useEffect(() => {
    flushTimerRef.current = setInterval(() => {
      if (dirtyQueueRef.current.length > 0) void flushDirty();
    }, AUTOSAVE_INTERVAL_MS);
    const onVis = () => {
      if (document.visibilityState === "hidden") void flushDirty();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flushDirty = useCallback(async () => {
    if (saving || dirtyQueueRef.current.length === 0) return;
    const queue = dirtyQueueRef.current.splice(0);
    setSaving(true);
    try {
      for (const op of queue) {
        await op();
      }
      setLastSavedAt(new Date().toISOString());
      setDirty(false);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Autosave failed.";
      setError(message);
      showToast("error", message);
    } finally {
      setSaving(false);
    }
  }, [saving, showToast]);

  const enqueue = useCallback((op: () => Promise<void>) => {
    dirtyQueueRef.current.push(op);
    setDirty(true);
  }, []);

  // ── Data fetch ───────────────────────────────────────────────

  const load = useCallback(
    async (mappingId: number) => {
      mappingIdRef.current = mappingId;
      setMapping(null);
      setSuggestions([]);
      setSelectedEdgeId(null);
      setValidation(null);
      setExportArtifact(null);
      setError(null);
      try {
        const [m, s] = await Promise.all([
          api.get<Mapping>(`/api/v1/mappings/${mappingId}`),
          fetchAllSuggestions(mappingId).catch(() => [] as AISuggestion[]),
        ]);
        setMapping(m);
        setSuggestions(s);
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : "Failed to load mapping.";
        setError(message);
        showToast("error", message);
      }
    },
    [showToast],
  );

  const close = useCallback(() => {
    mappingIdRef.current = null;
    setMapping(null);
    setSuggestions([]);
    setSelectedEdgeId(null);
    setValidation(null);
    setExportArtifact(null);
  }, []);

  const refresh = useCallback(async () => {
    if (mappingIdRef.current === null) return;
    await load(mappingIdRef.current);
  }, [load]);

  // ── CRUD ──────────────────────────────────────────────────────

  const create = useCallback(
    async (input: { name: string; source_id: number; target_id: number }) => {
      const created = await api.post<Mapping>("/api/v1/mappings/", input);
      showToast("success", `Created draft "${created.name}".`);
      return created;
    },
    [showToast],
  );

  const addEdge: UseMappingResult["addEdge"] = useCallback(
    async (input) => {
      if (!mapping) return null;
      // Optimistic insert.
      const tempId = -Date.now();
      const optimistic: FieldMapping = {
        id: tempId,
        mapping_id: mapping.id,
        target: input.target,
        sources: input.sources,
        transformation: input.transformation,
        origin: input.origin ?? "manual",
        ai_confidence: null,
        audit: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setMapping({ ...mapping, edges: [...mapping.edges, optimistic] });
      try {
        const real = await api.post<FieldMapping>(
          `/api/v1/mappings/${mapping.id}/edges`,
          {
            target: input.target,
            sources: input.sources,
            transformation: input.transformation,
            origin: input.origin ?? "manual",
          },
        );
        // Replace optimistic with real.
        setMapping((prev) =>
          prev
            ? { ...prev, edges: prev.edges.map((e) => (e.id === tempId ? real : e)) }
            : prev,
        );
        setLastSavedAt(new Date().toISOString());
        return real;
      } catch (err) {
        setMapping((prev) =>
          prev
            ? { ...prev, edges: prev.edges.filter((e) => e.id !== tempId) }
            : prev,
        );
        const message =
          err instanceof ApiError ? err.message : "Failed to add edge.";
        showToast("error", message);
        throw err;
      }
    },
    [mapping, showToast],
  );

  const removeEdge: UseMappingResult["removeEdge"] = useCallback(
    async (edgeId) => {
      if (!mapping) return;
      const snapshot = mapping.edges;
      setMapping({ ...mapping, edges: mapping.edges.filter((e) => e.id !== edgeId) });
      if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
      try {
        await api.delete(`/api/v1/mappings/${mapping.id}/edges/${edgeId}`);
        setLastSavedAt(new Date().toISOString());
      } catch (err) {
        setMapping({ ...mapping, edges: snapshot });
        const message =
          err instanceof ApiError ? err.message : "Failed to remove edge.";
        showToast("error", message);
        throw err;
      }
    },
    [mapping, selectedEdgeId, showToast],
  );

  const updateTransformation = useCallback(
    async (edgeId: number, transformation: TransformationPayload) => {
      if (!mapping) return;
      const body: EdgeTransformationUpdate = { transformation };
      enqueue(async () => {
        await api.put<FieldMapping>(
          `/api/v1/mappings/${mapping.id}/edges/${edgeId}/transformation`,
          body,
        );
      });
      // Apply optimistically; the queued PUT will reconcile if it fails.
      setMapping({
        ...mapping,
        edges: mapping.edges.map((e) =>
          e.id === edgeId ? { ...e, transformation } : e,
        ),
      });
    },
    [enqueue, mapping],
  );

  const selectEdge = useCallback((edgeId: number | null) => {
    setSelectedEdgeId(edgeId);
  }, []);

  // ── AI suggestions ───────────────────────────────────────────

  const requestSuggestions = useCallback(async () => {
    if (!mapping) return;
    try {
      const { task_id } = await api.post<{ task_id: string }>(
        `/api/v1/mappings/${mapping.id}/suggestions`,
        {},
      );
      showToast("info", "Generating AI suggestions…");
      // Poll the task until SUCCESS/FAILURE.
      const poll = async () => {
        try {
          const status = await api.get<{
            status: string;
            result?: { suggestions_created?: number } | null;
          }>(`/api/v1/tasks/${task_id}`);
          if (status.status === "SUCCESS") {
            const fresh = await fetchAllSuggestions(mapping.id);
            setSuggestions(fresh);
            showToast(
              "success",
              `Generated ${status.result?.suggestions_created ?? fresh.length} suggestion(s).`,
            );
            return;
          }
          if (status.status === "FAILURE") {
            showToast("error", "AI suggestion task failed.");
            return;
          }
          setTimeout(poll, 2000);
        } catch {
          setTimeout(poll, 4000);
        }
      };
      setTimeout(poll, 1500);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Failed to enqueue AI task.";
      showToast("error", message);
    }
  }, [mapping, showToast]);

  const acceptSuggestion = useCallback(
    async (suggestionId: number, transformation?: TransformationPayload) => {
      if (!mapping) return;
      const body: SuggestionAcceptRequest = {
        transformation: transformation ?? { kind: "direct" },
      };
      try {
        await api.post<FieldMapping>(
          `/api/v1/mappings/${mapping.id}/suggestions/${suggestionId}/accept`,
          body,
        );
        // Refresh both edges and suggestions.
        const [m, s] = await Promise.all([
          api.get<Mapping>(`/api/v1/mappings/${mapping.id}`),
          fetchAllSuggestions(mapping.id),
        ]);
        setMapping(m);
        setSuggestions(s);
        showToast("success", "Suggestion accepted.");
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : "Failed to accept suggestion.";
        showToast("error", message);
      }
    },
    [mapping, showToast],
  );

  const rejectSuggestion = useCallback(
    async (suggestionId: number) => {
      if (!mapping) return;
      try {
        await api.post(
          `/api/v1/mappings/${mapping.id}/suggestions/${suggestionId}/reject`,
          {},
        );
        const s = await fetchAllSuggestions(mapping.id);
        setSuggestions(s);
        showToast("info", "Suggestion rejected.");
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : "Failed to reject suggestion.";
        showToast("error", message);
      }
    },
    [mapping, showToast],
  );

  // ── Validate / Publish / Export ───────────────────────────────

  const validate = useCallback(async () => {
    if (!mapping) return null;
    try {
      const v = await api.post<ValidationResponse>(
        `/api/v1/mappings/${mapping.id}/validate`,
        {},
      );
      setValidation(v);
      if (v.blocking_count === 0 && v.warning_count === 0) {
        showToast("success", "Validation passed — no issues.");
      } else if (v.blocking_count === 0) {
        showToast("info", `Validation passed with ${v.warning_count} warning(s).`);
      } else {
        showToast(
          "error",
          `Validation found ${v.blocking_count} blocking issue(s).`,
        );
      }
      return v;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Validation failed.";
      showToast("error", message);
      return null;
    }
  }, [mapping, showToast]);

  const publish = useCallback(async () => {
    if (!mapping) return null;
    try {
      const v = await api.post<PublishResponse>(
        `/api/v1/mappings/${mapping.id}/publish`,
        {},
      );
      showToast("success", `Published v${v.version_number}.`);
      await refresh();
      return v;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Publish failed.";
      showToast("error", message);
      throw err;
    }
  }, [mapping, refresh, showToast]);

  const loadExport = useCallback(
    async (versionId?: number) => {
      if (!mapping) return null;
      try {
        const qs = versionId !== undefined ? `?version_id=${versionId}` : "";
        const a = await api.get<ExportArtifact>(
          `/api/v1/mappings/${mapping.id}/export${qs}`,
        );
        setExportArtifact(a);
        setExportVersionId(versionId ?? null);
        return a;
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : "Export failed.";
        showToast("error", message);
        return null;
      }
    },
    [mapping, showToast],
  );

  const clearExport = useCallback(() => {
    setExportArtifact(null);
    setExportVersionId(null);
  }, []);

  const clearToast = useCallback(() => setToast(null), []);

  // Derived.
  const edges = mapping?.edges ?? [];
  const pendingSuggestions = suggestions.filter((s) => s.status === "pending");
  const decidedSuggestions = suggestions.filter((s) => s.status !== "pending");

  return {
    mapping,
    edges,
    suggestions,
    pendingSuggestions,
    decidedSuggestions,
    selectedEdgeId,
    dirty,
    saving,
    lastSavedAt,
    error,
    toast,
    validation,
    exportVersionId,
    exportArtifact,
    role,
    load,
    close,
    create,
    refresh,
    addEdge,
    removeEdge,
    updateTransformation,
    selectEdge,
    requestSuggestions,
    acceptSuggestion,
    rejectSuggestion,
    validate,
    publish,
    loadExport,
    clearExport,
    clearToast,
  };
}
