"use client";
/**
 * Visualize — charting workspace (frontend_tasks/01_visualize_charting.md).
 *
 * Replaces the pre-TRD Database Topology Visualizer at this route (moved
 * to /dashboard/visualize/topology, still linked from the sidebar).
 * Data source: a connection's Schema Intel catalog table, queried live via
 * POST /api/v1/viz/query (real GROUP BY aggregation against the source DB,
 * not sample/mock data).
 */
import Link from "next/link";
import { useRef } from "react";

import { useVisualize } from "./hooks/useVisualize";

import ChartTypeSelector from "./components/ChartTypeSelector";
import FieldConfigPanel from "./components/FieldConfigPanel";
import FilterBar from "./components/FilterBar";
import ChartCanvas from "./components/ChartCanvas";
import SaveViewDialog from "./components/SaveViewDialog";
import ExportMenu from "./components/ExportMenu";
import Toast from "./components/Toast";

export default function VisualizePage() {
  const v = useVisualize();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const canSave = v.role === "admin" || v.role === "analyst";

  const selectedTable = v.catalogTables.find((t) => t.table_name === v.tableName) ?? null;
  const columns = selectedTable?.columns ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="p-4 border-b border-border bg-surface-elevated backdrop-blur-sm flex flex-wrap justify-between items-center gap-3">
        <div>
          <h3 className="text-lg font-semibold text-fg-muted">Visualize</h3>
          <p className="text-xs text-fg0">
            Build charts from your catalog data — dimensions, measures, filters, saved views
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={v.connectionId ?? ""}
            onChange={(e) => v.setConnectionId(Number(e.target.value))}
            className="px-3 py-2 rounded-lg bg-surface-overlay border border-border-strong text-sm text-fg focus:outline-none focus:border-blue-500"
          >
            {v.connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <SaveViewDialog
            savedViews={v.savedViews}
            onSave={v.saveView}
            onLoad={v.loadView}
            onDelete={v.deleteView}
            canSave={canSave}
          />
          <ExportMenu result={v.result} containerRef={chartContainerRef} chartType={v.chartType} />
          <Link
            href="/dashboard/visualize/topology"
            className="px-3 py-2 text-xs font-semibold text-fg-subtle border border-border-strong rounded-lg hover:bg-surface-overlay"
          >
            Schema Topology →
          </Link>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-80 border-r border-border bg-surface-elevated p-4 overflow-y-auto flex flex-col gap-5">
          <div>
            <div className="text-xs text-fg-subtle mb-1.5">Chart type</div>
            <ChartTypeSelector
              value={v.chartType}
              onChange={v.setChartType}
              dimensionCount={v.dimensions.length}
              measureCount={v.measures.length}
            />
          </div>

          <FieldConfigPanel
            catalogTables={v.catalogTables}
            catalogLoading={v.catalogLoading}
            tableName={v.tableName}
            onTableChange={v.setTableName}
            dimensions={v.dimensions}
            onDimensionsChange={v.setDimensions}
            measures={v.measures}
            onMeasuresChange={v.setMeasures}
          />

          <FilterBar columns={columns} filters={v.filters} onChange={v.setFilters} />
        </aside>

        <div className="flex-1 flex flex-col">
          <ChartCanvas
            chartType={v.chartType}
            result={v.result}
            dimensions={v.dimensions}
            measures={v.measures}
            loading={v.queryLoading}
            error={v.queryError}
            containerRef={chartContainerRef}
          />
        </div>
      </div>

      <Toast toast={v.toast} onDismiss={v.clearToast} />
    </div>
  );
}
