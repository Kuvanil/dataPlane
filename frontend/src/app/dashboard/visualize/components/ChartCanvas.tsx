"use client";
import { useMemo, type RefObject } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Area, AreaChart,
  Pie, PieChart, Scatter, ScatterChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { ChartType, MeasureSpec, VizQueryResponse } from "../lib/types";

const SERIES_COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#06b6d4"];

interface ChartCanvasProps {
  chartType: ChartType;
  result: VizQueryResponse | null;
  dimensions: string[];
  measures: MeasureSpec[];
  loading: boolean;
  error: string | null;
  containerRef: RefObject<HTMLDivElement | null>;
}

function toObjectRows(result: VizQueryResponse): Record<string, unknown>[] {
  return result.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    result.columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

export default function ChartCanvas({ chartType, result, dimensions, measures, loading, error, containerRef }: ChartCanvasProps) {
  const data = useMemo(() => (result ? toObjectRows(result) : []), [result]);
  const measureKeys = useMemo(
    () => measures.map((m) => m.label || `${m.aggregation}_${m.field}`),
    [measures],
  );
  const dimensionKey = dimensions[0];

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-zinc-500">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs">Running query…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md text-center text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          {error}
        </div>
      </div>
    );
  }

  if (!result || data.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-10">
        <div className="max-w-sm text-center text-sm text-zinc-500">
          {!result
            ? "Select fields to build your chart."
            : "No data matches your filters."}
        </div>
      </div>
    );
  }

  if (chartType === "kpi") {
    const key = measureKeys[0];
    const value = data[0]?.[key];
    return (
      <div ref={containerRef} className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl font-bold text-zinc-100">
            {typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(value)}
          </div>
          <div className="text-xs text-zinc-500 mt-2 uppercase tracking-wider">{key}</div>
        </div>
      </div>
    );
  }

  if (chartType === "table") {
    return (
      <div ref={containerRef} className="flex-1 overflow-auto p-2">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase text-zinc-500 border-b border-zinc-800">
              {result.columns.map((c) => <th key={c} className="text-left px-3 py-2">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i} className="border-b border-zinc-800/60">
                {row.map((v, j) => (
                  <td key={j} className="px-3 py-1.5 text-zinc-300">{v === null ? "—" : String(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {result.truncated && (
          <p className="text-[11px] text-amber-400 mt-2 px-3">
            Results truncated — showing the first {result.rows.length} rows.
          </p>
        )}
      </div>
    );
  }

  if (chartType === "pie") {
    const key = measureKeys[0];
    return (
      <div ref={containerRef} className="flex-1 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey={key} nameKey={dimensionKey} outerRadius="70%" label>
              {data.map((_, i) => <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46" }} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (chartType === "scatter") {
    const [xKey, yKey] = measureKeys;
    return (
      <div ref={containerRef} className="flex-1 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart>
            <CartesianGrid stroke="#27272a" />
            <XAxis dataKey={xKey} name={xKey} stroke="#71717a" fontSize={11} />
            <YAxis dataKey={yKey} name={yKey} stroke="#71717a" fontSize={11} />
            <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46" }} />
            <Scatter data={data} fill={SERIES_COLORS[0]} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const ChartComponent = chartType === "line" ? LineChart : chartType === "area" ? AreaChart : BarChart;

  return (
    <div ref={containerRef} className="flex-1 p-4">
      <ResponsiveContainer width="100%" height="100%">
        <ChartComponent data={data}>
          <CartesianGrid stroke="#27272a" />
          <XAxis dataKey={dimensionKey} stroke="#71717a" fontSize={11} />
          <YAxis stroke="#71717a" fontSize={11} />
          <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46" }} />
          <Legend />
          {measureKeys.map((key, i) =>
            chartType === "line" ? (
              <Line key={key} type="monotone" dataKey={key} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} />
            ) : chartType === "area" ? (
              <Area key={key} type="monotone" dataKey={key} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} fill={SERIES_COLORS[i % SERIES_COLORS.length]} fillOpacity={0.3} />
            ) : (
              <Bar key={key} dataKey={key} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
            ),
          )}
        </ChartComponent>
      </ResponsiveContainer>
    </div>
  );
}
