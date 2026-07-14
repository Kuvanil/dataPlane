import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SuggestionPanel from "../SuggestionPanel";
import type { AISuggestion } from "../../lib/types";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

function suggestion(overrides: Partial<AISuggestion> = {}): AISuggestion {
  return {
    id: 1,
    mapping_id: 1,
    target_table: "customers",
    target_column: "email_address",
    target_type: "varchar",
    source_table: "raw_customers",
    source_column: "email",
    source_type: "varchar",
    confidence: 62,
    reason: "name similarity",
    status: "pending",
    created_at: "2026-07-14T00:00:00Z",
    decided_at: null,
    decided_by: null,
    ...overrides,
  };
}

describe("SuggestionPanel", () => {
  beforeEach(() => {
    sessionStorage.clear();
    pushMock.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("writes a WorkspaceHandoff using the suggestion's own resolved source table/column", () => {
    render(
      <SuggestionPanel
        pending={[suggestion()]}
        decided={[]}
        loading={false}
        role="admin"
        onRequest={vi.fn()}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        sourceConnectionId={10}
      />
    );

    fireEvent.click(screen.getByLabelText("Investigate suggestion"));

    const raw = sessionStorage.getItem("query-workspace-handoff");
    expect(raw).not.toBeNull();
    const payload = JSON.parse(raw as string);
    expect(payload.connectionId).toBe(10);
    expect(payload.mode).toBe("sql");
    expect(payload.sql).toContain("raw_customers");
    expect(payload.sql).toContain("email");
    expect(payload.banner.summary).toContain("raw_customers.email");
    expect(pushMock).toHaveBeenCalledWith("/dashboard/query-workspace");
  });

  it("no-ops when the mapping has no source connection yet", () => {
    render(
      <SuggestionPanel
        pending={[suggestion()]}
        decided={[]}
        loading={false}
        role="admin"
        onRequest={vi.fn()}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        sourceConnectionId={null}
      />
    );
    fireEvent.click(screen.getByLabelText("Investigate suggestion"));
    expect(sessionStorage.getItem("query-workspace-handoff")).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
