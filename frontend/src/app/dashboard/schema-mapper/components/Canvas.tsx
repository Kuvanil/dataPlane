"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { classNames } from "../lib/format";
import type {
  FieldMapping,
  Role,
  SourceRef,
  TargetRef,
} from "../lib/types";

interface CanvasProps {
  mappingId: number;
  edges: FieldMapping[];
  selectedEdgeId: number | null;
  canEdit: boolean;
  role: Role | null;
  onSelectEdge: (id: number | null) => void;
  onCreateEdge: (target: TargetRef, sources: SourceRef[]) => Promise<void>;
}

interface ColumnNode {
  id: string;
  table: string;
  column: string;
  type: string;
  primary_key: boolean;
  edge_id?: number; // if already mapped
  side: "source" | "target";
}

interface ConnectorView {
  sourceId: string;
  targetId: string;
  edgeId: number;
  origin: FieldMapping["origin"];
  confidence: number | null;
}

/**
 * Canvas — side-by-side source/target columns with inline SVG connectors.
 * Drag a source column onto a target column to create a 1:1 edge. The UI
 * calls onCreateEdge which posts to /api/v1/mappings/{id}/edges.
 *
 * Schema metadata (table/column/type) is fetched from the existing
 * /api/v1/connectors/{id}/schema endpoint for source and target.
 */
export default function Canvas({
  mappingId,
  edges,
  selectedEdgeId,
  canEdit,
  role,
  onSelectEdge,
  onCreateEdge,
}: CanvasProps) {
  const [sourceColumns, setSourceColumns] = useState<ColumnNode[]>([]);
  const [targetColumns, setTargetColumns] = useState<ColumnNode[]>([]);
  const [sourceConnId, setSourceConnId] = useState<number | null>(null);
  const [targetConnId, setTargetConnId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draggingSourceId, setDraggingSourceId] = useState<string | null>(null);
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Load mapping → resolve source/target connection ids, then schemas.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const { api } = await import("@/lib/api");
        const m = await api.get<{
          id: number;
          source_id: number | null;
          target_id: number | null;
        }>(`/api/v1/mappings/${mappingId}`);
        if (cancelled) return;
        setSourceConnId(m.source_id);
        setTargetConnId(m.target_id);
        if (!m.source_id || !m.target_id) {
          setLoading(false);
          return;
        }
        const [s, t] = await Promise.all([
          api.get<{ schema: Record<string, Array<{ name: string; type: string; primary_key?: boolean }>> }>(
            `/api/v1/connectors/${m.source_id}/schema`,
          ),
          api.get<{ schema: Record<string, Array<{ name: string; type: string; primary_key?: boolean }>> }>(
            `/api/v1/connectors/${m.target_id}/schema`,
          ),
        ]);
        if (cancelled) return;
        setSourceColumns(flattenSchema(s.schema, "source"));
        setTargetColumns(flattenSchema(t.schema, "target"));
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Failed to load schema.";
          setError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mappingId]);

  // Mark columns that are already mapped (for visual hint).
  const targetEdgeByColumn = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of edges) {
      map.set(`${e.target.table}.${e.target.column}`, e.id);
    }
    return map;
  }, [edges]);

  const sourceMappedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const e of edges) {
      for (const s of e.sources) set.add(`${s.table}.${s.column}`);
    }
    return set;
  }, [edges]);

  // Render connectors between mapped columns.
  const connectors: ConnectorView[] = useMemo(() => {
    const out: ConnectorView[] = [];
    for (const e of edges) {
      for (const s of e.sources) {
        out.push({
          sourceId: `src_${s.table}_${s.column}`,
          targetId: `tgt_${e.target.table}_${e.target.column}`,
          edgeId: e.id,
          origin: e.origin,
          confidence: e.ai_confidence ?? null,
        });
      }
    }
    return out;
  }, [edges]);

  const rowHeight = 36;
  const maxRows = Math.max(sourceColumns.length, targetColumns.length);
  const svgHeight = Math.max(280, maxRows * rowHeight + 24);

  const onDrop = async (target: ColumnNode) => {
    if (!canEdit || !draggingSourceId || creating) return;
    const source = sourceColumns.find((c) => c.id === draggingSourceId);
    if (!source) return;
    setCreating(true);
    setDraggingSourceId(null);
    setHoverTargetId(null);
    try {
      await onCreateEdge(
        {
          table: target.table,
          column: target.column,
          type: target.type,
          primary_key: target.primary_key,
        },
        [{ table: source.table, column: source.column, type: source.type }],
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto p-5"
      aria-label="Schema mapping canvas"
    >
      {loading ? (
        <div className="flex items-center justify-center h-64 text-sm text-zinc-500">
          Loading schemas…
        </div>
      ) : error ? (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
          {error}
        </div>
      ) : (
        <div className="flex gap-6 justify-center min-w-fit">
          <SchemaPanel
            title="Source"
            connId={sourceConnId}
            nodes={sourceColumns}
            side="source"
            mappedKeys={sourceMappedKeys}
            draggingId={draggingSourceId}
            onDragStart={canEdit ? setDraggingSourceId : undefined}
            onDragEnd={() => setDraggingSourceId(null)}
          />
          <ConnectorOverlay
            height={svgHeight}
            connectors={connectors}
            rowHeight={rowHeight}
            nodeIndex={(id) => {
              const idx = sourceColumns.findIndex((n) => n.id === id);
              if (idx >= 0) return { row: idx, side: "source" as const };
              const idx2 = targetColumns.findIndex((n) => n.id === id);
              if (idx2 >= 0) return { row: idx2, side: "target" as const };
              return null;
            }}
            selectedEdgeId={selectedEdgeId}
            onSelectEdge={onSelectEdge}
          />
          <SchemaPanel
            title="Target"
            connId={targetConnId}
            nodes={targetColumns}
            side="target"
            mappedKeys={new Set(Array.from(targetEdgeByColumn.keys()))}
            draggingId={null}
            onDragStart={undefined}
            onDragEnd={undefined}
            hoverId={hoverTargetId}
            onDropHover={(id) => setHoverTargetId(id)}
            onDrop={onDrop}
          />
        </div>
      )}
      {!canEdit && role && (
        <div className="mt-4 text-center text-xs text-amber-400 italic">
          Your role ({role}) cannot create or modify edges.
        </div>
      )}
    </div>
  );
}

function flattenSchema(
  schema: Record<string, Array<{ name: string; type: string; primary_key?: boolean }>>,
  side: "source" | "target",
): ColumnNode[] {
  const out: ColumnNode[] = [];
  for (const table of Object.keys(schema)) {
    for (const col of schema[table]) {
      out.push({
        id: `${side === "source" ? "src" : "tgt"}_${table}_${col.name}`,
        table,
        column: col.name,
        type: col.type,
        primary_key: !!col.primary_key,
        side,
      });
    }
  }
  return out;
}

function SchemaPanel({
  title,
  connId,
  nodes,
  side,
  mappedKeys,
  draggingId,
  hoverId,
  onDragStart,
  onDragEnd,
  onDropHover,
  onDrop,
}: {
  title: string;
  connId: number | null;
  nodes: ColumnNode[];
  side: "source" | "target";
  mappedKeys: Set<string>;
  draggingId: string | null;
  hoverId?: string | null;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
  onDropHover?: (id: string | null) => void;
  onDrop?: (n: ColumnNode) => void;
}) {
  const accent = side === "source" ? "text-blue-400" : "text-indigo-400";
  return (
    <div className="w-80 shrink-0">
      <div className={classNames("text-xs font-semibold mb-2 flex items-center gap-2", accent)}>
        <span>📥 {title}</span>
        {connId && <span className="text-zinc-500 font-normal">#{connId}</span>}
      </div>
      <div className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/40 p-2 min-h-[200px]">
        {nodes.length === 0 ? (
          <div className="text-[11px] text-zinc-500 italic px-2 py-3">
            No columns.
          </div>
        ) : (
          nodes.map((n) => {
            const isMapped = mappedKeys.has(`${n.table}.${n.column}`);
            const isDragging = draggingId === n.id;
            const isHover = hoverId === n.id;
            return (
              <div
                key={n.id}
                draggable={!!onDragStart}
                onDragStart={(e) => {
                  if (onDragStart) {
                    e.dataTransfer.effectAllowed = "link";
                    onDragStart(n.id);
                  }
                }}
                onDragEnd={() => onDragEnd?.()}
                onDragOver={(e) => {
                  if (onDrop && side === "target") {
                    e.preventDefault();
                    onDropHover?.(n.id);
                  }
                }}
                onDragLeave={() => {
                  if (isHover) onDropHover?.(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (onDrop && side === "target") {
                    onDrop(n);
                  }
                }}
                className={classNames(
                  "flex items-center justify-between px-2 py-1.5 rounded text-[11px] font-mono border transition-all",
                  isDragging && "opacity-50",
                  isMapped
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-transparent hover:bg-zinc-800/40",
                  isHover && "border-blue-500/40 bg-blue-500/10",
                  onDragStart ? "cursor-grab" : "",
                )}
                style={{ minHeight: 32 }}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  {n.primary_key && <span className="text-amber-400 text-[9px]">🔑</span>}
                  <span className="text-zinc-400 mr-1">{n.table}.</span>
                  <span className={classNames(side === "source" ? "text-blue-200" : "text-indigo-200", "truncate")}>
                    {n.column}
                  </span>
                </span>
                <span className="text-zinc-600 text-[10px]">{n.type}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ConnectorOverlay({
  height,
  connectors,
  rowHeight,
  nodeIndex,
  selectedEdgeId,
  onSelectEdge,
}: {
  height: number;
  connectors: ConnectorView[];
  rowHeight: number;
  nodeIndex: (id: string) => { row: number; side: "source" | "target" } | null;
  selectedEdgeId: number | null;
  onSelectEdge: (id: number | null) => void;
}) {
  const width = 160;
  return (
    <div className="w-40 shrink-0 relative">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold text-center mb-2">
        Mappings
      </div>
      <svg width={width} height={height} role="img" aria-label="Mapping connectors">
        {connectors.map((c) => {
          const sIdx = nodeIndex(c.sourceId);
          const tIdx = nodeIndex(c.targetId);
          if (!sIdx || !tIdx) return null;
          const sy = sIdx.row * rowHeight + 16;
          const ty = tIdx.row * rowHeight + 16;
          const isAi = c.origin === "ai_accepted";
          const isSelected = c.edgeId === selectedEdgeId;
          const stroke = isSelected
            ? "#60a5fa"
            : isAi
              ? "#8b5cf6"
              : "#22c55e";
          return (
            <g
              key={c.edgeId}
              style={{ cursor: "pointer" }}
              onClick={() => onSelectEdge(c.edgeId)}
            >
              <line
                x1={0}
                y1={sy}
                x2={width}
                y2={ty}
                stroke={stroke}
                strokeWidth={isSelected ? 3 : 2}
                strokeDasharray={isAi ? "5,3" : "0"}
                opacity={0.85}
              />
              {c.confidence !== null && (
                <text
                  x={width / 2}
                  y={(sy + ty) / 2 - 4}
                  textAnchor="middle"
                  fill="#a1a1aa"
                  fontSize={9}
                >
                  {Math.round(c.confidence <= 1 ? c.confidence * 100 : c.confidence)}%
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
