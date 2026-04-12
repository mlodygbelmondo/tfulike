<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This repo is on Next 16. Read the relevant guide in `node_modules/next/dist/docs/` before changing App Router APIs or config. Follow the repo's current pattern: `params` and `searchParams` are `Promise<...>` in pages, layouts, and route handlers.
<!-- END:nextjs-agent-rules -->

## Repo Shape

- Single Next app in `src/app`, bundled Chrome MV3 extension in `extension/`, Supabase schema/functions in `supabase/`.
- All user-facing routes live under `src/app/[lang]`. Keep locale-aware routes aligned with `src/lib/i18n.ts` and `src/lib/dictionaries.ts`.
- `src/lib/types.ts` is manually maintained. If you change Supabase schema or migrations, update these TS types too.

## Commands

- Dev server: `npm run dev`
- Full test run: `npm test`
- Single test file: `npm test -- src/components/__tests__/game-play-view.test.tsx`
- Lint: `npm run lint`
- Extension JS syntax check: `node --check extension/background.js`
- Do not treat `npx tsc --noEmit` as a reliable repo gate without explanation: the root tsconfig also picks up `supabase/functions/*` Deno edge functions.

## Testing Conventions

- Vitest covers both app and extension tests: `src/**/*.test.{ts,tsx}` and `extension/**/*.test.{js,ts}`.
- `src/__tests__/setup.ts` globally mocks `next/navigation`; component tests rely on that setup.
- API route tests usually mock `@/lib/supabase/server` and reuse `src/__tests__/helpers/supabase-mock.ts`. Prefer those helpers over ad hoc Supabase stubs.

## Supabase

- Browser code uses `@/lib/supabase/client` with synchronous `createClient()`.
- Server code uses `@/lib/supabase/server` and must `await createClient()`.
- Required local env is in `.env.local.example`: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## TikTok And Extension Flow

- TikTok sync is extension-first now. `src/app/api/tiktok/scrape/route.ts` is intentionally a `410` stub; do not restore server-side scraping.
- Video playback is `extension/background.js` fetch -> `src/lib/extension.ts` `requestVideoDataUri()` -> Blob URL in `src/components/game-play-view.tsx`.
- Do not reintroduce Supabase proxy playback or raw TikTok CDN URLs as `<video src>` fallbacks. There is an old `supabase/functions/video-proxy` in the tree, but current playback should not depend on it.
- If you change extension messaging, keep `src/lib/extension.ts`, `extension/content.js`, and `extension/background.js` in sync.
- The extension only injects on `https://tfulike.vercel.app/*`, `http://localhost:3000/*`, and `http://localhost:3001/*`. If you use another local origin or port, update `extension/manifest.json`.

## Game Flow

- `src/app/api/rooms/[pin]/start/route.ts` materializes synced `likes` into `videos`, then creates round 1.
- `src/app/api/rooms/[pin]/rounds/reveal/route.ts` scores the round; `src/app/api/rooms/[pin]/rounds/next/route.ts` advances or finishes the game.
- `src/components/game-play-view.tsx` subscribes directly to Supabase Realtime on `rooms`, `rounds`, `players`, and `votes`; round-flow changes usually need both API-route and client-view updates.

## PWA

- `public/sw.js` is only registered in production by `src/components/sw-registrar.tsx`; do not expect the service worker in local dev.
