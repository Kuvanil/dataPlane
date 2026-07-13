"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Tenant } from "../lib/types";

interface TenantCreateFormProps {
  onClose: () => void;
  onCreated: () => void;
}

export default function TenantCreateForm({ onClose, onCreated }: TenantCreateFormProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [autoSlug, setAutoSlug] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const handleNameChange = (v: string) => {
    setName(v);
    if (autoSlug) {
      setSlug(v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError("Tenant name is required."); return; }
    if (!slug.trim()) { setError("Tenant slug is required."); return; }

    setCreating(true);
    try {
      await api.post("/api/v1/tenants", { name: name.trim(), slug: slug.trim() });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create tenant.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="w-full max-w-md p-6 rounded-2xl bg-zinc-900 border border-zinc-800 flex flex-col gap-4 shadow-2xl">
        <h3 className="text-lg font-semibold text-zinc-200">Create Tenant</h3>

        {error && (
          <div className="p-2 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-xs">{error}</div>
        )}

        <form onSubmit={handleCreate} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-400">Tenant Name</label>
            <input
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              required
              placeholder="Acme Corp"
              className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm focus:outline-none focus:border-blue-500 text-zinc-200"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-400">Slug</label>
            <input
              value={slug}
              onChange={e => { setSlug(e.target.value); setAutoSlug(false); }}
              required
              placeholder="acme-corp"
              className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm font-mono focus:outline-none focus:border-blue-500 text-zinc-200"
            />
            <span className="text-[10px] text-zinc-600">URL-friendly identifier. Auto-generated from name.</span>
          </div>
          <div className="flex gap-2 mt-4">
            <button type="button" onClick={onClose} className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm font-semibold text-zinc-400">
              Cancel
            </button>
            <button type="submit" disabled={creating} className="flex-1 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl text-sm font-semibold text-white disabled:opacity-50">
              {creating ? "Creating..." : "Create Tenant"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}