import { describe, expect, it } from "vitest";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { getFunctionsErrorMessage } from "@/lib/supabase/functions";

describe("getFunctionsErrorMessage", () => {
  it("returns the edge function error body instead of the generic wrapper message", async () => {
    const response = new Response(
      JSON.stringify({
        error: "Failed to upsert likes",
        detail: "duplicate key value violates unique constraint",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );

    const message = await getFunctionsErrorMessage(new FunctionsHttpError(response));

    expect(message).toBe(
      "Failed to upsert likes: duplicate key value violates unique constraint"
    );
  });

  it("falls back to the normal error message for non-function errors", async () => {
    const message = await getFunctionsErrorMessage(new Error("Not authenticated"));

    expect(message).toBe("Not authenticated");
  });
});
