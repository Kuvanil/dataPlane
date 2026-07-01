"use client";
import { useEffect, useMemo, useState } from "react";
import { classNames } from "../lib/format";
import {
  KIND_DESCRIPTIONS,
  TRANSFORMATION_KINDS,
  blankTransformation,
  validateTransformation,
} from "../lib/transformations";
import type {
  TransformationKind,
  TransformationPayload,
} from "../lib/types";

interface TransformEditorProps {
  initial: TransformationPayload;
  onCancel: () => void;
  onApply: (next: TransformationPayload) => void;
}

export default function TransformEditor({
  initial,
  onCancel,
  onApply,
}: TransformEditorProps) {
  const [kind, setKind] = useState<TransformationKind>(initial.kind);
  const [payload, setPayload] = useState<TransformationPayload>(initial);

  // When kind changes, reset the payload to that kind's defaults (preserving
  // "from" for cast when switching to a similar kind, but starting fresh is
  // simpler and matches the backend grammar semantics).
  useEffect(() => {
    if (payload.kind !== kind) {
      setPayload(blankTransformation(kind));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const issues = useMemo(() => validateTransformation(payload), [payload]);
  const desc = KIND_DESCRIPTIONS[kind];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit transformation"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-2xl rounded-xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">
              Edit Transformation
            </h2>
            <p className="text-xs text-zinc-500 mt-1">
              {desc.summary}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-zinc-500 hover:text-zinc-200 text-sm"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mt-5">
          <label className="text-xs text-zinc-400">
            Kind
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as TransformationKind)}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 focus:outline-none focus:border-blue-500"
            >
              {TRANSFORMATION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_DESCRIPTIONS[k].label} — {KIND_DESCRIPTIONS[k].summary}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4">
          <KindFields kind={kind} payload={payload} onChange={setPayload} />
        </div>

        {issues.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="text-xs font-semibold text-amber-300 mb-1">
              {issues.length} issue{issues.length === 1 ? "" : "s"}
            </div>
            <ul className="text-[11px] text-amber-200 space-y-0.5">
              {issues.map((iss, i) => (
                <li key={i}>
                  <span className="font-mono text-amber-400">{iss.field}</span>: {iss.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onApply(payload)}
            disabled={issues.length > 0}
            className={classNames(
              "px-4 py-2 text-sm font-semibold rounded-lg",
              issues.length > 0
                ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                : "bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:opacity-90",
            )}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function KindFields({
  kind,
  payload,
  onChange,
}: {
  kind: TransformationKind;
  payload: TransformationPayload;
  onChange: (next: TransformationPayload) => void;
}) {
  const set = (key: string, value: unknown) => {
    onChange({ ...payload, [key]: value } as TransformationPayload);
  };

  if (kind === "direct" || kind === "upper" || kind === "lower" || kind === "trim") {
    return (
      <div className="text-xs text-zinc-500 italic px-3 py-2 rounded bg-zinc-950/50 border border-zinc-800">
        No parameters — this kind applies the operation to the source column directly.
      </div>
    );
  }

  if (kind === "cast") {
    const p = payload as Extract<TransformationPayload, { kind: "cast" }>;
    return (
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-zinc-400">
          From type
          <input
            type="text"
            value={p.from}
            onChange={(e) => set("from", e.target.value)}
            placeholder="TEXT"
            className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm font-mono"
          />
        </label>
        <label className="text-xs text-zinc-400">
          To type
          <input
            type="text"
            value={p.to}
            onChange={(e) => set("to", e.target.value)}
            placeholder="INTEGER"
            className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm font-mono"
          />
        </label>
      </div>
    );
  }

  if (kind === "concat") {
    const p = payload as Extract<TransformationPayload, { kind: "concat" }>;
    return (
      <div className="space-y-2">
        <div className="text-xs text-zinc-400">Parts (in order)</div>
        {p.parts.map((part, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={part.kind}
              onChange={(e) => {
                const k = e.target.value as "literal" | "source";
                const next = [...p.parts];
                next[i] =
                  k === "literal"
                    ? { kind: "literal", value: "" }
                    : { kind: "source" };
                onChange({ ...payload, parts: next } as TransformationPayload);
              }}
              className="px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-xs"
            >
              <option value="literal">literal</option>
              <option value="source">source</option>
            </select>
            {part.kind === "literal" ? (
              <input
                type="text"
                value={part.value}
                onChange={(e) => {
                  const next = [...p.parts];
                  next[i] = { kind: "literal", value: e.target.value };
                  onChange({ ...payload, parts: next } as TransformationPayload);
                }}
                placeholder="literal text"
                className="flex-1 px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-sm font-mono"
              />
            ) : (
              <span className="flex-1 text-xs text-zinc-500 italic">
                uses the N-th source column (position {i} in parts)
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                const next = p.parts.filter((_, idx) => idx !== i);
                onChange({ ...payload, parts: next } as TransformationPayload);
              }}
              className="px-2 py-1 text-xs text-zinc-500 hover:text-red-400"
              aria-label="Remove part"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            const next = [...p.parts, { kind: "literal" as const, value: "" }];
            onChange({ ...payload, parts: next } as TransformationPayload);
          }}
          className="text-xs text-blue-300 hover:underline"
        >
          + Add part
        </button>
      </div>
    );
  }

  if (kind === "substring") {
    const p = payload as Extract<TransformationPayload, { kind: "substring" }>;
    return (
      <div className="grid grid-cols-3 gap-3">
        <label className="text-xs text-zinc-400">
          Source index
          <input
            type="number"
            min={0}
            value={p.source_index}
            onChange={(e) => set("source_index", Number(e.target.value))}
            className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm font-mono"
          />
        </label>
        <label className="text-xs text-zinc-400">
          Start (0-based)
          <input
            type="number"
            min={0}
            value={p.start}
            onChange={(e) => set("start", Number(e.target.value))}
            className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm font-mono"
          />
        </label>
        <label className="text-xs text-zinc-400">
          Length
          <input
            type="number"
            min={1}
            value={p.length}
            onChange={(e) => set("length", Number(e.target.value))}
            className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm font-mono"
          />
        </label>
      </div>
    );
  }

  if (kind === "coalesce") {
    const p = payload as Extract<TransformationPayload, { kind: "coalesce" }>;
    return (
      <label className="text-xs text-zinc-400">
        Fallback value (literal)
        <input
          type="text"
          value={p.fallback_value}
          onChange={(e) => set("fallback_value", e.target.value)}
          placeholder="n/a"
          className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm font-mono"
        />
      </label>
    );
  }

  if (kind === "default") {
    const p = payload as Extract<TransformationPayload, { kind: "default" }>;
    return (
      <label className="text-xs text-zinc-400">
        Default value (literal)
        <input
          type="text"
          value={String(p.value)}
          onChange={(e) => set("value", e.target.value)}
          placeholder="unknown"
          className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm font-mono"
        />
      </label>
    );
  }

  if (kind === "null_if") {
    const p = payload as Extract<TransformationPayload, { kind: "null_if" }>;
    return (
      <label className="text-xs text-zinc-400">
        Equals (literal)
        <input
          type="text"
          value={String(p.equals)}
          onChange={(e) => set("equals", e.target.value)}
          placeholder=""
          className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm font-mono"
        />
      </label>
    );
  }

  if (kind === "lookup") {
    const p = payload as Extract<TransformationPayload, { kind: "lookup" }>;
    return (
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-zinc-400">
          Lookup table
          <input
            type="text"
            value={p.table}
            onChange={(e) => set("table", e.target.value)}
            placeholder="lu_country"
            className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm font-mono"
          />
        </label>
        <label className="text-xs text-zinc-400">
          Key column
          <input
            type="text"
            value={p.key_column}
            onChange={(e) => set("key_column", e.target.value)}
            placeholder="code"
            className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm font-mono"
          />
        </label>
        <label className="text-xs text-zinc-400">
          Value column
          <input
            type="text"
            value={p.value_column}
            onChange={(e) => set("value_column", e.target.value)}
            placeholder="name"
            className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm font-mono"
          />
        </label>
        <label className="text-xs text-zinc-400">
          Default (optional)
          <input
            type="text"
            value={p.default ?? ""}
            onChange={(e) => set("default", e.target.value || null)}
            placeholder="UNK"
            className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm font-mono"
          />
        </label>
      </div>
    );
  }

  return null;
}
