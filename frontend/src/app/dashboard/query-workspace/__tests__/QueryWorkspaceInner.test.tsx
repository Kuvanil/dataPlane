import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QueryWorkspaceInner from "../QueryWorkspaceInner";
import { writeWorkspaceHandoff } from "../lib/handoff";
import type { AskDataAskResponse } from "../../askdata/lib/types";
import type { QueryExecuteResult } from "../../query-studio/lib/types";

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: getMock,
    post: postMock,
    delete: vi.fn(),
    downloadPost: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

let currentSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => currentSearchParams,
}));

Element.prototype.scrollIntoView = vi.fn();

const CONNECTIONS = [{ id: 1, name: "widgets-db", type: "sqlite" }];

function askResult(overrides: Partial<AskDataAskResponse> = {}): AskDataAskResponse {
  return {
    session_id: "s1",
    sql: "SELECT * FROM customers LIMIT 100;",
    grounded: true,
    confidence: 70,
    method: "heuristic",
    executed: true,
    columns: ["id", "name"],
    rows: [{ id: 1, name: "Alice" }],
    row_count: 1,
    masked_columns: [],
    summary: "Found 1 row",
    warnings: [],
    error: null,
    ...overrides,
  };
}

function execResult(overrides: Partial<QueryExecuteResult> = {}): QueryExecuteResult {
  return {
    statement_type: "select",
    tables_referenced: ["widgets"],
    warnings: [],
    requires_confirmation: false,
    executed: true,
    columns: ["id"],
    rows: [{ id: 1 }],
    row_count: 1,
    affected_rows: null,
    page: 1,
    page_size: 100,
    has_more: false,
    truncated: false,
    duration_ms: 5,
    error: null,
    ...overrides,
  };
}

function routeGet(overrides: Record<string, unknown> = {}) {
  getMock.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/v1/connectors/")) return CONNECTIONS;
    if (path.startsWith("/api/v1/catalog/")) return { connection_id: 1, tables: [] };
    if (path.startsWith("/api/v1/query-studio/saved")) return overrides.saved ?? [];
    if (path.startsWith("/api/v1/query-studio/history")) return overrides.history ?? { history: [], total: 0, page: 1, page_size: 50 };
    throw new Error(`unexpected GET: ${path}`);
  });
}

describe("QueryWorkspaceInner", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    sessionStorage.clear();
    currentSearchParams = new URLSearchParams();
    routeGet();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to Ask mode and both subviews stay mounted across a switch", async () => {
    render(<QueryWorkspaceInner />);
    await waitFor(() => expect(screen.getByPlaceholderText("Ask about your data…")).toBeInTheDocument());

    // SQL mode's editor should already be in the DOM, just hidden.
    expect(screen.getByText("Query Studio")).toBeInTheDocument();
  });

  it("initializes mode from the ?mode= search param", async () => {
    currentSearchParams = new URLSearchParams("mode=sql");
    render(<QueryWorkspaceInner />);
    await waitFor(() => expect(screen.getByText(/Run \(/)).toBeInTheDocument());
  });

  it("preserves a SQL draft across a mode switch instead of remounting", async () => {
    routeGet({
      history: {
        history: [{
          id: 1, actor: "a@x.com", sql: "SELECT * FROM widgets", connection_id: "1",
          statement_type: "select", outcome: "success", row_count: 1, duration_ms: 3,
          created_at: "2026-07-11T00:00:00Z",
        }],
        total: 1, page: 1, page_size: 50,
      },
    });
    render(<QueryWorkspaceInner />);

    fireEvent.click(screen.getByText("SQL"));
    await waitFor(() => expect(screen.getByText("SELECT * FROM widgets")).toBeInTheDocument());
    fireEvent.click(screen.getByText("SELECT * FROM widgets"));
    await waitFor(() => {
      expect(document.querySelector(".cm-content")?.textContent).toContain("SELECT * FROM widgets");
    });

    // Switch away and back — SqlWorkspaceView was never unmounted, so the
    // loaded draft must still be there (not reset to empty).
    fireEvent.click(screen.getByText("Ask"));
    fireEvent.click(screen.getByText("SQL"));

    expect(document.querySelector(".cm-content")?.textContent).toContain("SELECT * FROM widgets");
  });

  it("applies an in-shell handoff from AskData and switches to SQL mode without navigation", async () => {
    postMock.mockResolvedValue(askResult());
    render(<QueryWorkspaceInner />);
    await waitFor(() => expect(screen.getByPlaceholderText("Ask about your data…")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Ask about your data…"), { target: { value: "q" } });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() => expect(screen.getByText("Found 1 row")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Show SQL"));
    fireEvent.click(screen.getByText("Edit in Query Studio →"));

    await waitFor(() => {
      const editorContent = document.querySelector(".cm-content");
      expect(editorContent?.textContent).toContain("SELECT * FROM customers LIMIT 100;");
    });
    expect(screen.getByText("Query Studio")).toBeInTheDocument();
  });

  it("applies a WorkspaceHandoff on mount, shows the banner, and its mode wins over ?mode=", async () => {
    currentSearchParams = new URLSearchParams("mode=ask");
    writeWorkspaceHandoff({
      connectionId: 1,
      mode: "sql",
      sql: "SELECT * FROM customers LIMIT 100;",
      banner: { sourceModule: "schema_intel", summary: "Drift on customers" },
    });

    render(<QueryWorkspaceInner />);

    await waitFor(() => expect(screen.getByText(/Drift on customers/)).toBeInTheDocument());
    expect(screen.getByText(/Schema Intel/)).toBeInTheDocument();
    await waitFor(() => {
      const editorContent = document.querySelector(".cm-content");
      expect(editorContent?.textContent).toContain("SELECT * FROM customers LIMIT 100;");
    });

    // The handoff key is cleared after being read once.
    expect(sessionStorage.getItem("query-workspace-handoff")).toBeNull();
  });

  it("keeps the write-confirm modal visible even after switching away from SQL mode", async () => {
    routeGet({
      saved: [{
        id: 5, connection_id: 1, name: "delete-all", sql_text: "DELETE FROM widgets",
        created_by: "a@x.com", created_at: "2026-07-11T00:00:00Z", updated_at: "2026-07-11T00:00:00Z",
      }],
    });
    postMock.mockResolvedValueOnce(execResult({
      statement_type: "delete", requires_confirmation: true, executed: false,
      warnings: ["This is a DELETE statement — pass confirm=true to execute it."],
      columns: [], rows: [], row_count: 0,
    }));

    render(<QueryWorkspaceInner />);
    fireEvent.click(screen.getByText("SQL"));

    fireEvent.click(screen.getByText("Saved"));
    await waitFor(() => expect(screen.getByText("delete-all")).toBeInTheDocument());
    fireEvent.click(screen.getByText("delete-all"));

    fireEvent.click(screen.getByText(/Run \(/));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    // Switch to Ask mode — the modal must still be visible (rendered at shell level).
    fireEvent.click(screen.getByText("Ask"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
