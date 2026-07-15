import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import IntegrationsPage from "../page";

const { getMock, putMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  putMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: { get: getMock, put: putMock },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

function mockApis({ configured = true, accounts = [] as unknown[], accountsError = null as string | null } = {}) {
  getMock.mockImplementation((path: string) => {
    if (path === "/api/v1/integrations/status") {
      return Promise.resolve({
        configured,
        portal_url: "http://aci-portal.example:3001",
        external_actions: [
          { action_type: "notify_slack_internal", description: "Post to the internal channel", risk: "low", auto_capable: true },
          { action_type: "external_email_send", description: "Send an email", risk: "high", auto_capable: false },
        ],
      });
    }
    if (path === "/api/v1/integrations/linked-accounts") {
      return Promise.resolve({ accounts, error: accountsError });
    }
    if (path === "/api/v1/integrations/notification-settings") {
      return Promise.resolve({ settings: [{ event_key: "pipeline:run_failure", enabled: true }] });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

afterEach(() => {
  getMock.mockReset();
  putMock.mockReset();
});

describe("IntegrationsPage", () => {
  it("connect link points at ACI's portal, not a dataPlane route", async () => {
    mockApis();
    render(<IntegrationsPage />);
    const link = await screen.findByTestId("connect-app-link");
    expect(link).toHaveAttribute("href", "http://aci-portal.example:3001");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("renders linked accounts with status", async () => {
    mockApis({
      accounts: [{ id: "1", app_name: "SLACK", linked_account_owner_id: "dataplane", enabled: true }],
    });
    render(<IntegrationsPage />);
    await waitFor(() => expect(screen.getByText("SLACK")).toBeInTheDocument());
    expect(screen.getByText("enabled")).toBeInTheDocument();
  });

  it("shows governed actions with their approval posture", async () => {
    mockApis();
    render(<IntegrationsPage />);
    await waitFor(() => expect(screen.getByText("notify_slack_internal")).toBeInTheDocument());
    expect(screen.getByText("auto-capable (fixed destination)")).toBeInTheDocument();
    expect(screen.getByText("approval required")).toBeInTheDocument();
  });

  it("shows a clear unconfigured state instead of an error", async () => {
    mockApis({ configured: false, accountsError: "ACI integration is not configured (ACI_API_KEY unset)." });
    render(<IntegrationsPage />);
    await waitFor(() =>
      expect(screen.getByText(/isn't configured \(ACI_API_KEY is unset\)/)).toBeInTheDocument());
  });

  it("toggling a notify-out setting PUTs to the settings endpoint", async () => {
    mockApis();
    putMock.mockResolvedValue({ event_key: "pipeline:run_failure", enabled: false });
    render(<IntegrationsPage />);
    await waitFor(() => expect(screen.getByText("Pipeline run failed")).toBeInTheDocument());

    const checkbox = screen.getByText("Pipeline run failed")
      .closest("label")!.querySelector("input")!;
    expect(checkbox.checked).toBe(true); // from the fixture settings
    fireEvent.click(checkbox);
    await waitFor(() => expect(putMock).toHaveBeenCalledWith(
      "/api/v1/integrations/notification-settings/pipeline%3Arun_failure",
      { enabled: false },
    ));
  });
});
