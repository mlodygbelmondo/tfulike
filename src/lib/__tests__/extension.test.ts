import { describe, expect, it } from "vitest";

import { normalizeExtensionSyncError } from "@/lib/extension";

describe("normalizeExtensionSyncError", () => {
  it("maps the Chrome host-permission error to a user-friendly sync hint", () => {
    expect(
      normalizeExtensionSyncError(
        "Cannot access contents of the page. Extension manifest must request permission to access the respective host."
      )
    ).toBe(
      "Couldn't access your TikTok tab. Make sure TikTok is open in this Chrome profile, the tab is fully loaded, you're logged in, and the extension is allowed on tiktok.com, then try again."
    );
  });

  it("leaves unrelated extension errors unchanged", () => {
    expect(normalizeExtensionSyncError("Something else broke")).toBe("Something else broke");
  });
});
