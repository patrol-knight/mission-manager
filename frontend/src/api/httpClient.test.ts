import { describe, it, expect, vi, afterEach } from "vitest";
import { http, ApiError } from "./httpClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("httpClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns parsed JSON on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ hello: "world" })));
    const result = await http.get<{ hello: string }>("/api/anything");
    expect(result).toEqual({ hello: "world" });
  });

  it("sends a JSON body on POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await http.post("/api/anything", { x: 1 });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ x: 1 });
  });

  it("throws an ApiError with the backend's detail message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ detail: "Mission not found" }, 404)),
    );
    await expect(http.get("/api/missions/current")).rejects.toBeInstanceOf(ApiError);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ detail: "Mission not found" }, 404)),
    );
    await expect(http.get("/api/missions/current")).rejects.toMatchObject({
      status: 404,
      message: "Mission not found",
    });
  });

  it("returns undefined for 204 No Content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(http.delete("/api/missions/foo")).resolves.toBeUndefined();
  });
});
