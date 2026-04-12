import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/tiktok/scrape/route";

describe("POST /api/tiktok/scrape (deprecated)", () => {
  it("returns 410 Gone with deprecation message", async () => {
    const res = await POST();

    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.error).toContain("deprecated");
  });
});
