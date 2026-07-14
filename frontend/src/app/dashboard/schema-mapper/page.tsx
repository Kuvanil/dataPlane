"use client";
/**
 * Schema Mapper — main page.
 *
 * Wires the MappingList (left rail) and the per-mapping Workspace (right pane)
 * to the `useMapping` hook which talks to the `/api/v1/mappings` API.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/api";

import { useMapping } from "./hooks/useMapping";
import { classNames } from "./lib/format";

import MappingList from "./components/MappingList";
import WorkspaceHeader from "./components/WorkspaceHeader";
import DraftBar from "./components/DraftBar";
import Canvas from "./components/Canvas";
import SuggestionPanel from "./components/SuggestionPanel";
import EdgeInspector from "./components/EdgeInspector";
import ValidationPanel from "./components/ValidationPanel";
import TransformEditor from "./components/TransformEditor";
import PublishDialog from "./components/PublishDialog";
import ExportModal from "./components/ExportModal";
import Toast from "./components/Toast";

export default function SchemaMapperPage() {
  const router = useRouter();
  const m = useMapping();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [transformEdit, setTransformEdit] = useState<{
    initial: import("./lib/types").TransformationPayload;
    edgeId: number;
  } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [validating, setValidating] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  // Redirect to login if the role check returns 401.
  useEffect(() => {
    if (m.error && m.error.toLowerCase().includes("not authenticated")) {
      router.push("/login");
    }
  }, [m.error, router]);

  // Load the selected mapping.
  useEffect(() => {
    if (selectedId !== null) void m.load(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const mapping = m.mapping;
  const canEdit = !!mapping && mapping.status === "draft" &&
    (m.role === "admin" || m.role === "analyst");
  const selectedEdge = m.edges.find((e) => e.id === m.selectedEdgeId) ?? null;

  const handleValidate = async () => {
    setValidating(true);
    try {
      await m.validate();
    } finally {
      setValidating(false);
    }
  };

  const handlePublishClick = () => {
    setPublishOpen(true);
  };

  const handlePublishConfirm = async () => {
    setPublishing(true);
    try {
      await m.publish();
      setPublishOpen(false);
    } catch {
      // toast already shown by hook
    } finally {
      setPublishing(false);
    }
  };

  const handleExportClick = async () => {
    setExportOpen(true);
    if (mapping) {
      setExportLoading(true);
      try {
        await m.loadExport(mapping.current_version_id ?? undefined);
      } finally {
        setExportLoading(false);
      }
    }
  };

  const handleExportClose = () => {
    setExportOpen(false);
    m.clearExport();
  };

  const handleJumpToEdge = (edgeId: number) => {
    m.selectEdge(edgeId);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/40 backdrop-blur-sm flex flex-wrap justify-between items-center gap-3">
        <div>
          <h3 className="text-lg font-semibold text-zinc-200">Schema Mapper</h3>
          <p className="text-xs text-zinc-500">
            Visual drag-and-drop with versioned, audited mappings
          </p>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <MappingList
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
          onCreate={m.create}
          role={m.role}
          renamedMappingId={mapping?.id ?? null}
          renamedMappingName={mapping?.name ?? null}
        />

        {!mapping ? (
          <div className="flex-1 flex items-center justify-center p-10">
            <div className="max-w-md text-center">
              <div className="text-5xl mb-3">🗺️</div>
              <h2 className="text-lg font-semibold text-zinc-200 mb-2">
                {selectedId === null ? "Select or create a mapping" : "Loading mapping…"}
              </h2>
              <p className="text-sm text-zinc-500">
                Pick a draft from the list, or click <span className="text-zinc-300">+ New</span> to start one.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            <WorkspaceHeader
              mapping={mapping}
              role={m.role}
              validation={m.validation}
              onValidate={handleValidate}
              onPublish={handlePublishClick}
              onExport={handleExportClick}
              onRename={(name) => m.rename(name)}
              validating={validating}
              publishing={publishing}
            />
            <DraftBar
              dirty={m.dirty}
              saving={m.saving}
              lastSavedAt={m.lastSavedAt}
              error={m.error}
            />
            <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 flex flex-col overflow-hidden">
                <Canvas
                  mappingId={mapping.id}
                  edges={m.edges}
                  selectedEdgeId={m.selectedEdgeId}
                  canEdit={canEdit}
                  role={m.role}
                  onSelectEdge={(id) => m.selectEdge(id)}
                  onCreateEdge={(target, sources, transformation) =>
                    // mapper_tasks #1: Canvas now computes the right
                    // transformation (direct for 1 source, concat for
                    // 2+) and needs the created edge back to auto-select
                    // multi-source edges for review.
                    m.addEdge({ target, sources, transformation })
                  }
                />
                {m.validation && (
                  <ValidationPanel
                    validation={m.validation}
                    onClose={() => { /* hide by re-render: caller can re-toggle */ }}
                    onJumpToEdge={handleJumpToEdge}
                    edges={m.edges}
                    suggestions={m.suggestions}
                    sourceConnectionId={mapping?.source_id}
                  />
                )}
                {/* Suggestions are a draft-only workflow: publish supersedes
                    every pending suggestion server-side, and a published
                    mapping is immutable — so no suggestion UI (historical
                    or otherwise) is shown once a mapping is published. */}
                {mapping.status === "draft" && (
                  <SuggestionPanel
                    pending={m.pendingSuggestions}
                    decided={m.decidedSuggestions}
                    loading={false}
                    role={m.role}
                    onRequest={m.requestSuggestions}
                    onAccept={(id) => m.acceptSuggestion(id)}
                    onReject={(id) => m.rejectSuggestion(id)}
                    sourceConnectionId={mapping?.source_id}
                  />
                )}
              </div>
              <EdgeInspector
                edge={selectedEdge}
                role={m.role}
                canEdit={canEdit}
                onEdit={(t) => {
                  if (!selectedEdge) return;
                  setTransformEdit({ initial: t, edgeId: selectedEdge.id });
                }}
                onDelete={async () => {
                  if (!selectedEdge) return;
                  if (confirm(`Delete edge ${selectedEdge.target.table}.${selectedEdge.target.column}?`)) {
                    await m.removeEdge(selectedEdge.id);
                  }
                }}
              />
            </div>
          </div>
        )}
      </div>

      <Toast toast={m.toast} onDismiss={m.clearToast} />

      {transformEdit && (
        <TransformEditor
          initial={transformEdit.initial}
          onCancel={() => setTransformEdit(null)}
          onApply={(next) => {
            void m.updateTransformation(transformEdit.edgeId, next);
            setTransformEdit(null);
          }}
        />
      )}

      {publishOpen && mapping && (
        <PublishDialog
          open
          blockingCount={m.validation?.blocking_count ?? 0}
          warningCount={m.validation?.warning_count ?? 0}
          currentVersionId={mapping.current_version_id}
          onCancel={() => !publishing && setPublishOpen(false)}
          onConfirm={handlePublishConfirm}
          publishing={publishing}
        />
      )}

      {exportOpen && (
        <ExportModal
          open
          artifact={m.exportArtifact}
          loading={exportLoading}
          versionId={m.exportVersionId}
          onClose={handleExportClose}
        />
      )}

      {/* Accessibility live region for status updates. */}
      <div className={classNames("sr-only")} aria-live="polite">
        {m.toast?.message ?? ""}
      </div>

      {/* suppress unused-import warning */}
      {false && <span>{ApiError.name}</span>}
    </div>
  );
}
