"use client";
import { useState } from "react";
import type { Connector } from "../lib/types";
import { HEALTH_META, TYPE_META } from "../lib/types";
import EditConnectorModal from "./EditConnectorModal";
import DeleteConnectorDialog from "./DeleteConnectorDialog";
import CredentialRotationModal from "./CredentialRotationModal";
import ConnectorAuditLog from "./ConnectorAuditLog";

interface ConnectorCardProps {
  connector: Connector;
  testResult?: { status: string; detail?: string };
  isTesting: boolean;
  isScanning: boolean;
  onTest: (id: number) => void;
  onScan: (id: number) => void;
  onRefresh: () => void;
}

export default function ConnectorCard({ connector, testResult, isTesting, isScanning, onTest, onScan, onRefresh }: ConnectorCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showRotate, setShowRotate] = useState(false);
  const [showAudit, setShowAudit] = useState(false);

  const meta = TYPE_META[connector.type] ?? TYPE_META.sqlite;
  const test = testResult;
  const health = test?.status === "connected" ? HEALTH_META.healthy
    : test?.status === "failed" ? HEALTH_META.down
    : HEALTH_META[connector.health_status ?? "unknown"] ?? HEALTH_META.unknown;
  const statusDetail = test?.detail ?? connector.last_test_error ?? undefined;

  return (
    <>
      <div className="p-5 rounded-2xl bg-zinc-900/50 border border-zinc-800 backdrop-blur-sm flex flex-col gap-4 group hover:border-zinc-700 transition-all relative">
        <div className="flex justify-between items-start">
          <div>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${meta.bgColor} ${meta.color}`}>
              {meta.icon} {connector.type}
            </span>
            <h4 className="font-semibold text-zinc-200 mt-2">{connector.name}</h4>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`flex items-center gap-1.5 text-xs ${health.text}`}
              title={statusDetail}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${health.dot}`} />
              {test?.status === "testing" ? "Testing..." : health.label}
            </span>
            {/* Three-dot menu */}
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                </svg>
              </button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-0 top-8 z-50 w-48 rounded-xl bg-zinc-800 border border-zinc-700 shadow-2xl py-1">
                    <button
                      onClick={() => { setShowMenu(false); setShowEdit(true); }}
                      className="w-full px-4 py-2 text-xs text-left text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
                    >
                      ✎ Edit
                    </button>
                    <button
                      onClick={() => { setShowMenu(false); setShowRotate(true); }}
                      className="w-full px-4 py-2 text-xs text-left text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
                    >
                      🔑 Rotate Credentials
                    </button>
                    <button
                      onClick={() => { setShowMenu(false); setShowAudit(true); }}
                      className="w-full px-4 py-2 text-xs text-left text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
                    >
                      📋 View Activity
                    </button>
                    <div className="border-t border-zinc-700 my-1" />
                    <button
                      onClick={() => { setShowMenu(false); setShowDelete(true); }}
                      className="w-full px-4 py-2 text-xs text-left text-red-400 hover:bg-zinc-700 flex items-center gap-2"
                    >
                      🗑️ Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-zinc-800/50 pt-3 text-xs text-zinc-500">
          <span className="font-mono text-[10px] truncate block">{JSON.stringify(connector.config)}</span>
        </div>
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => onTest(connector.id)}
            disabled={isTesting}
            className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-medium text-zinc-300 transition-colors disabled:opacity-50"
          >
            {isTesting ? "Testing..." : "Test Conn"}
          </button>
          <button
            onClick={() => onScan(connector.id)}
            disabled={isScanning}
            className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-medium text-zinc-300 transition-colors disabled:opacity-50"
          >
            {isScanning ? "Scanning..." : "Scan Schema"}
          </button>
        </div>
      </div>

      {showEdit && (
        <EditConnectorModal
          connector={connector}
          onClose={() => setShowEdit(false)}
          onSaved={onRefresh}
        />
      )}
      {showDelete && (
        <DeleteConnectorDialog
          connector={connector}
          onClose={() => setShowDelete(false)}
          onDeleted={onRefresh}
        />
      )}
      {showRotate && (
        <CredentialRotationModal
          connector={connector}
          onClose={() => setShowRotate(false)}
          onRotated={onRefresh}
        />
      )}
      {showAudit && (
        <ConnectorAuditLog
          connectorId={connector.id}
          connectorName={connector.name}
          onClose={() => setShowAudit(false)}
        />
      )}
    </>
  );
}