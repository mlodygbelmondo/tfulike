import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockExchangeCodeForSession,
  mockGetUser,
  mockFrom,
  mockRedirect,
  mockCookies,
} = vi.hoisted(() => ({
  mockExchangeCodeForSession: vi.fn(),
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  mockRedirect: vi.fn((url: string) => ({ redirected: true, url })),
  mockCookies: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    redirect: mockRedirect,
  },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
      getUser: mockGetUser,
    },
    from: mockFrom,
  })),
}));

import { GET } from "@/app/auth/callback/route";

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      getAll: vi.fn(() => []),
      set: vi.fn(),
    });
    mockExchangeCodeForSession.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { onboarding_completed: false },
          }),
        })),
      })),
    });
  });

  it("redirects unfinished users to onboarding after exchanging the code", async () => {
    const response = await GET(
      new Request("https://example.com/auth/callback?code=test-code")
    );

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith("test-code");
    expect(response).toEqual({
      redirected: true,
      url: "https://example.com/en/onboarding",
    });
  });

  it("redirects authenticated returning users to the localized home page", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { onboarding_completed: true },
          }),
        })),
      })),
    });

    const response = await GET(
      new Request("https://example.com/auth/callback?code=test-code")
    );

    expect(response).toEqual({
      redirected: true,
      url: "https://example.com/en",
    });
  });
});
