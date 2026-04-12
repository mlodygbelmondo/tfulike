const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const ALLOWED_HOST_SUFFIXES = [
  ".tiktok.com",
  ".tiktokv.com",
  ".byteoversea.com",
];

function isAllowedUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;

    const hostname = url.hostname.toLowerCase();
    return ALLOWED_HOST_SUFFIXES.some(
      (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix)
    );
  } catch {
    return false;
  }
}

function buildProxyHeaders(req: Request): Headers {
  const headers = new Headers();

  const range = req.headers.get("range");
  if (range) headers.set("range", range);

  const accept = req.headers.get("accept");
  headers.set("accept", accept || "*/*");
  headers.set("accept-language", "en-US,en;q=0.9");
  headers.set("referer", "https://www.tiktok.com/");
  headers.set("user-agent", USER_AGENT);

  return headers;
}

function buildResponseHeaders(upstream: Response): Headers {
  const headers = new Headers(corsHeaders);

  const passthrough = [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "cache-control",
    "expires",
    "last-modified",
    "etag",
  ];

  for (const key of passthrough) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }

  headers.set("vary", "origin, range");
  return headers;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const target = url.searchParams.get("u") || "";

  if (!target || !isAllowedUrl(target)) {
    return new Response(JSON.stringify({ error: "Invalid or forbidden target URL" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: buildProxyHeaders(req),
      redirect: "follow",
    });

    const responseHeaders = buildResponseHeaders(upstream);

    if (req.method === "HEAD") {
      return new Response(null, {
        status: upstream.status,
        headers: responseHeaders,
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Proxy request failed",
        detail: String((error as { message?: string })?.message || error),
      }),
      {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
