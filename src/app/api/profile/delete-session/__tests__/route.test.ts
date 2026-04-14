import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { POST } from "@/app/api/profile/delete-session/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

function makeChain(resolveValue: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(chain, {
    get(target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(resolveValue);
      }
      if (prop in target) return target[prop as keyof typeof target];
      const fn = vi.fn(() => proxy);
      target[prop as string] = fn;
      return fn;
    },
  });
  return proxy;
}

describe("POST /api/profile/delete-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when user is not authenticated", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    } as never);

    const response = await POST();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("deletes only the auth user and relies on database cascades", async () => {
    const deleteUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
    const fromSpy = vi.fn();

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    } as never);

    vi.mocked(createAdminClient).mockReturnValue({
      from: fromSpy,
      auth: {
        admin: {
          deleteUser,
        },
      },
    } as never);

    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    expect(deleteUser).toHaveBeenCalledWith("user-1");
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("returns 500 when deleting the auth user fails", async () => {
    const deleteUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { message: "boom" },
    });

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    } as never);

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => makeChain({ data: null, error: null })),
      auth: {
        admin: {
          deleteUser,
        },
      },
    } as never);

    const response = await POST();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to delete user",
      detail: "boom",
    });
  });
});
