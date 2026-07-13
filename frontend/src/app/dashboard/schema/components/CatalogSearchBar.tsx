"use client";

interface CatalogSearchBarProps {
  q: string;
  onQChange: (v: string) => void;
  dataType: string;
  onDataTypeChange: (v: string) => void;
  classificationLabel: string;
  onClassificationLabelChange: (v: string) => void;
}

export default function CatalogSearchBar({
  q, onQChange, dataType, onDataTypeChange, classificationLabel, onClassificationLabelChange,
}: CatalogSearchBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={q}
        onChange={(e) => onQChange(e.target.value)}
        placeholder="Search table or column name…"
        className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
      />
      <input
        type="text"
        value={dataType}
        onChange={(e) => onDataTypeChange(e.target.value)}
        placeholder="Data type (e.g. TEXT)"
        className="w-40 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
      />
      <select
        value={classificationLabel}
        onChange={(e) => onClassificationLabelChange(e.target.value)}
        className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 focus:outline-none focus:border-blue-500"
      >
        <option value="">All classifications</option>
        <option value="PII">PII</option>
        <option value="Sensitive">Sensitive</option>
        <option value="Public">Public</option>
      </select>
    </div>
  );
}
