import { describe, expect, it } from "vitest";
import { readJsonBody, RequestBodyError } from "./request";

describe("bounded JSON request parsing", () => {
  it("reads JSON with a correct length", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "catalog" }),
    });
    await expect(readJsonBody(request, 100)).resolves.toEqual({ action: "catalog" });
  });

  it("rejects malformed or oversized bodies", async () => {
    const malformed = new Request("https://example.test", { method: "POST", body: "{" });
    await expect(readJsonBody(malformed, 100)).rejects.toBeInstanceOf(RequestBodyError);

    const oversized = new Request("https://example.test", { method: "POST", body: "123456" });
    await expect(readJsonBody(oversized, 4)).rejects.toMatchObject({ message: "too_large" });
  });
});
