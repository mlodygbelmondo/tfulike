import { vi } from "vitest";

type SupabaseChain = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  _resolveValue: { data: unknown; error: unknown; count?: number | null };
};

/**
 * Creates a chainable mock that mimics the Supabase client query builder.
 *
 * Usage:
 *   const mock = createSupabaseMock();
 *   mock._resolveValue = { data: { id: '1' }, error: null };
 *   vi.mocked(createClient).mockResolvedValue(mock as any);
 */
export function createSupabaseMock(): SupabaseChain {
  const chain: Partial<SupabaseChain> = {
    _resolveValue: { data: null, error: null },
  };

  const self = new Proxy(chain, {
    get(target, prop) {
      if (prop === "_resolveValue") return target._resolveValue;

      if (prop === "then") {
        // Make it thenable so `await` works on the chain
        return (resolve: (v: unknown) => void) =>
          resolve(target._resolveValue);
      }

      if (prop in target) return target[prop as keyof typeof target];

      // For any chained method, return a mock fn that returns the proxy
      const fn = vi.fn(() => self);
      (target as Record<string | symbol, unknown>)[prop] = fn;
      return fn;
    },
  }) as unknown as SupabaseChain;

  return self;
}

/**
 * A more granular mock builder where you can set different return values
 * per `.from(table)` call by using a map.
 *
 * Usage:
 *   const sb = createRoutableMock({
 *     rooms: { data: { id: '1', pin: '1234' }, error: null },
 *     players: { data: { id: 'p1' }, error: null },
 *   });
 */
export function createRoutableMock(
  tableResults: Record<
    string,
    { data: unknown; error: unknown; count?: number | null }
  >
) {
  const rpcResult = { data: null, error: null } as {
    data: unknown;
    error: unknown;
  };

  function makeChain(
    resolveValue: { data: unknown; error: unknown; count?: number | null } = {
      data: null,
      error: null,
    }
  ) {
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

  return {
    from: vi.fn((table: string) => {
      const result = tableResults[table] || { data: null, error: null };
      return makeChain(result);
    }),
    rpc: vi.fn(() => makeChain(rpcResult)),
    _setRpc(val: { data: unknown; error: unknown }) {
      rpcResult.data = val.data;
      rpcResult.error = val.error;
    },
    _setTable(
      table: string,
      val: { data: unknown; error: unknown; count?: number | null }
    ) {
      tableResults[table] = val;
    },
  };
}
