declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

const ALLOWED_ORIGINS = new Set([
  "https://tfulike.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
]);

function corsHeaders(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin":
      origin && ALLOWED_ORIGINS.has(origin)
        ? origin
        : "https://tfulike.vercel.app",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "OPTIONS",
    Vary: "Origin",
  };
}

Deno.serve((req: Request) => {
  const headers = corsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  return new Response(
    JSON.stringify({
      error: "video-proxy is retired. Playback must use the Chrome extension flow.",
    }),
    {
      status: 410,
      headers: { ...headers, "Content-Type": "application/json" },
    }
  );
});
