import { FunctionsHttpError } from "@supabase/supabase-js";

export async function getFunctionsErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;

    try {
      const data = await response.clone().json();
      if (typeof data?.error === "string" && data.error.trim()) {
        if (typeof data?.detail === "string" && data.detail.trim()) {
          return `${data.error}: ${data.detail}`;
        }
        return data.error;
      }
    } catch {
      // Fall back to the wrapper error message below.
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unknown error";
}
