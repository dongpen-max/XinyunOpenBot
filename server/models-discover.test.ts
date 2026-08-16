import { afterEach, describe, expect, it, vi } from "vitest";

import { discoverModels } from "./models-discover.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("domestic model discovery", () => {
  it("uses the provider preset URL when only an API key is configured", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "deepseek-v4-flash" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(discoverModels({ domestic: { deepseek: { key: "test-key" } } }, "deepseek"))
      .resolves.toEqual(["deepseek-v4-flash"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer test-key" }),
      }),
    );
  });
});
