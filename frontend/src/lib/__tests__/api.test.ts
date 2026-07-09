import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addUnauthorizedHandler, api } from "../api";

function fakeResponse(body: unknown, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

describe("addUnauthorizedHandler", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ detail: "nope" }, 401)));
    // jsdom throws "not implemented" on real navigation; stub location as a
    // plain writable object so handle401's redirect is a harmless no-op.
    // defineProperty (not assignment) sidesteps window.location's setter
    // being typed as `string & Location` in this lib.dom version.
    Object.defineProperty(window, "location", {
      value: { href: "" },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
    vi.unstubAllGlobals();
  });

  it("runs every registered handler on a 401, not just the first", async () => {
    const first = vi.fn();
    const second = vi.fn();
    addUnauthorizedHandler(first);
    addUnauthorizedHandler(second);

    await expect(api.get("/whatever")).rejects.toThrow();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not let a throwing handler block the others", async () => {
    const boom = vi.fn(() => {
      throw new Error("handler blew up");
    });
    const fine = vi.fn();
    addUnauthorizedHandler(boom);
    addUnauthorizedHandler(fine);

    await expect(api.get("/whatever")).rejects.toThrow();

    expect(boom).toHaveBeenCalledTimes(1);
    expect(fine).toHaveBeenCalledTimes(1);
  });

  it("unregister removes only its own handler (bugs #03 — no cross-clobbering)", async () => {
    const stillMounted = vi.fn();
    const unmounting = vi.fn();
    addUnauthorizedHandler(stillMounted);
    const removeUnmounting = addUnauthorizedHandler(unmounting);

    removeUnmounting();
    await expect(api.get("/whatever")).rejects.toThrow();

    expect(stillMounted).toHaveBeenCalledTimes(1);
    expect(unmounting).not.toHaveBeenCalled();
  });
});

describe("api.get", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards an AbortSignal to fetch when provided", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => fakeResponse({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await api.get("/things", { signal: controller.signal });

    const [, init] = fetchMock.mock.calls[0];
    expect(init).toMatchObject({ signal: controller.signal });
  });

  it("still works with no options (signal is undefined, not required)", async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.get<{ ok: boolean }>("/things");

    expect(result).toEqual({ ok: true });
  });
});
