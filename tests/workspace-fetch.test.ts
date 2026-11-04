import { afterEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_CHANGED_EVENT, workspaceFetch } from "../src/lib/workspace-fetch";

afterEach(() => vi.unstubAllGlobals());

describe("workspace cache invalidation", () => {
  it.each(["POST", "PATCH", "DELETE"])("invalidates after a successful %s and preserves the response", async (method) => {
    const events = new EventTarget();
    const changed = vi.fn();
    events.addEventListener(WORKSPACE_CHANGED_EVENT, changed);
    vi.stubGlobal("window", events);
    const response = new Response(JSON.stringify({ data: { id: "saved" } }), { status: 200 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const result = await workspaceFetch("/api/groups", { method });

    expect(changed).toHaveBeenCalledOnce();
    expect(await result.json()).toEqual({ data: { id: "saved" } });
  });

  it.each([{ method: "GET", status: 200 }, { method: "POST", status: 400 }, { method: "DELETE", status: 500 }])(
    "keeps cache for $method with status $status",
    async ({ method, status }) => {
      const events = new EventTarget();
      const changed = vi.fn();
      events.addEventListener(WORKSPACE_CHANGED_EVENT, changed);
      vi.stubGlobal("window", events);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));

      await workspaceFetch("/api/groups", { method });

      expect(changed).not.toHaveBeenCalled();
    },
  );
});
