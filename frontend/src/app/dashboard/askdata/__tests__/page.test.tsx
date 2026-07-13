import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AskDataPage from "../page";
import { ApiError } from "@/lib/api";
import type { AskDataAskResponse } from "../lib/types";

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: { get: getMock, post: postMock },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

// jsdom doesn't implement scrollIntoView (used to keep the latest chat
// turn in view).
Element.prototype.scrollIntoView = vi.fn();

function askResult(overrides: Partial<AskDataAskResponse> = {}): AskDataAskResponse {
  return {
    session_id: "s1",
    sql: "SELECT * FROM customers LIMIT 100;",
    grounded: true,
    confidence: 70,
    method: "heuristic",
    executed: true,
    columns: ["id", "name", "email"],
    rows: [{ id: 1, name: "Alice", email: "alice@x.com" }],
    row_count: 1,
    masked_columns: [],
    summary: "Found 1 row",
    warnings: [],
    error: null,
    ...overrides,
  };
}

describe("AskDataPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockResolvedValue([{ id: 1, name: "widgets-db", type: "sqlite" }]);
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a question and renders the answer, SQL, and result table", async () => {
    postMock.mockResolvedValue(askResult());
    render(<AskDataPage />);

    await waitFor(() => expect(screen.getByText(/widgets-db/)).toBeInTheDocument());

    const input = screen.getByPlaceholderText("Ask about your data…");
    fireEvent.change(input, { target: { value: "show everything in customers" } });
    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => expect(screen.getByText("Found 1 row")).toBeInTheDocument());
    expect(postMock).toHaveBeenCalledWith("/api/v1/askdata/ask", expect.objectContaining({
      connection_id: 1, question: "show everything in customers",
    }));

    fireEvent.click(screen.getByText("Show SQL"));
    expect(screen.getByText("SELECT * FROM customers LIMIT 100;")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("reuses the session_id returned by the first turn on the next question", async () => {
    postMock.mockResolvedValueOnce(askResult({ session_id: "abc-123" }));
    postMock.mockResolvedValueOnce(askResult({ session_id: "abc-123", summary: "Found 2 rows" }));

    render(<AskDataPage />);
    await waitFor(() => expect(screen.getByText(/widgets-db/)).toBeInTheDocument());

    const input = screen.getByPlaceholderText("Ask about your data…");
    fireEvent.change(input, { target: { value: "first question" } });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() => expect(screen.getByText("Found 1 row")).toBeInTheDocument());

    fireEvent.change(input, { target: { value: "follow up" } });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() => expect(screen.getByText("Found 2 rows")).toBeInTheDocument());

    const secondCall = postMock.mock.calls[1][1];
    expect(secondCall.session_id).toBe("abc-123");
  });

  it("shows a masked-columns notice when PII is redacted", async () => {
    postMock.mockResolvedValue(askResult({
      masked_columns: ["email"],
      rows: [{ id: 1, name: "Alice", email: "***REDACTED***" }],
    }));
    render(<AskDataPage />);
    await waitFor(() => expect(screen.getByText(/widgets-db/)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Ask about your data…"), { target: { value: "q" } });
    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => expect(screen.getByText(/Masked: email/)).toBeInTheDocument());
  });

  it("stores a Query Studio handoff in sessionStorage and navigates", async () => {
    postMock.mockResolvedValue(askResult());
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    render(<AskDataPage />);
    await waitFor(() => expect(screen.getByText(/widgets-db/)).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("Ask about your data…"), { target: { value: "q" } });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() => expect(screen.getByText("Found 1 row")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Edit in Query Studio →"));

    expect(setItemSpy).toHaveBeenCalledWith(
      "qs-handoff",
      JSON.stringify({ connectionId: 1, sql: "SELECT * FROM customers LIMIT 100;" }),
    );
  });

  it("shows an error message when the API call fails", async () => {
    postMock.mockRejectedValue(new ApiError(500, "boom"));
    render(<AskDataPage />);
    await waitFor(() => expect(screen.getByText(/widgets-db/)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Ask about your data…"), { target: { value: "q" } });
    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
  });
});
