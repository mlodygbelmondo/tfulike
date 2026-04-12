# tfulike

Party game built with Next.js 16, Supabase, and a Chrome extension that syncs TikTok likes into a shared guessing game.

Players join a room, sync their TikTok liked videos, and then try to guess whose TikTok is currently playing.

## Stack

- Next.js 16 App Router
- React 19
- Supabase for data, auth-adjacent session state, Realtime, and Edge Functions
- Chrome MV3 extension for TikTok sync and video playback fetching
- Vitest + Testing Library

## Repo Layout

- `src/app` - Next.js app
- `src/app/[lang]` - all locale-aware user-facing routes
- `src/app/api` - room and gameplay API routes
- `src/components` - client UI, including gameplay
- `src/lib` - shared utilities, i18n, extension bridge, and app types
- `extension` - bundled Chrome MV3 extension
- `supabase/migrations` - database schema history
- `supabase/functions` - Supabase Edge Functions

## Locales

The app currently supports:

- `en`
- `pl`

Locale config lives in `src/lib/i18n.ts`, and dictionaries are loaded via `src/lib/dictionaries.ts`.

## Game Flow

1. A host creates a room.
2. Players join the room.
3. Each player syncs their TikTok liked videos through the Chrome extension.
4. Starting the room materializes synced likes into `videos` and creates round 1.
5. During each round, the app plays one video and players vote on whose TikTok it is.
6. Reveal and next-round routes score the round and advance the game.

Key API routes:

- `src/app/api/rooms/route.ts`
- `src/app/api/rooms/join/route.ts`
- `src/app/api/rooms/reconnect/route.ts`
- `src/app/api/rooms/[pin]/start/route.ts`
- `src/app/api/rooms/[pin]/rounds/reveal/route.ts`
- `src/app/api/rooms/[pin]/rounds/next/route.ts`

## TikTok sync and playback flow

TikTok integration is extension-first.

- The web app talks to the Chrome extension through `window.postMessage` via `src/lib/extension.ts`.
- The extension uses the player's TikTok session to sync liked videos.
- Video playback in the app does not rely on direct TikTok CDN URLs as the `<video src>` fallback.
- Instead, the extension fetches video bytes and returns a Blob URL the page can play.

Important files:

- `src/lib/extension.ts`
- `src/components/game-play-view.tsx`
- `extension/background.js`
- `extension/content.js`
- `extension/tiktok-sync.js`

`src/app/api/tiktok/scrape/route.ts` is intentionally a `410` stub and should not be revived as the primary sync path.

## Requirements

- Node.js 20+
- npm
- A Supabase project
- Google Chrome or another Chromium browser that supports MV3 extensions

## Environment Variables

Copy `.env.local.example` to `.env.local` and fill in your values:

```bash
cp .env.local.example .env.local
```

Required variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

## Install

```bash
npm install
```

## Run The App

```bash
npm run dev
```

The app runs on `http://localhost:3000` by default.

## Load The Chrome Extension

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Choose `Load unpacked`.
4. Select the `extension/` directory from this repo.

The extension currently injects on:

- `https://tfulike.vercel.app/*`
- `http://localhost:3000/*`
- `http://localhost:3001/*`

If you use a different local origin, update `extension/manifest.json`.

## Supabase

This repo includes:

- SQL migrations in `supabase/migrations`
- Edge Functions in `supabase/functions`

Notes:

- Browser code uses `@/lib/supabase/client` with synchronous `createClient()`.
- Server code uses `@/lib/supabase/server` and must `await createClient()`.
- `src/lib/types.ts` is manually maintained. If you change schema or migrations, update those TypeScript types too.

## Development Commands

```bash
npm run dev
npm run build
npm run start
npm run lint
npm test
npm test -- src/components/__tests__/game-play-view.test.tsx
node --check extension/background.js
```

## Testing Notes

- Vitest covers both app and extension tests.
- App tests live under `src/**/*.test.{ts,tsx}`.
- Extension tests live under `extension/**/*.test.{js,ts}`.
- `src/__tests__/setup.ts` provides shared test setup, including mocked `next/navigation`.

## Project Notes

- This repo uses Next.js 16 conventions. In App Router files here, `params` and `searchParams` are handled as `Promise<...>`.
- The gameplay screen subscribes directly to Supabase Realtime updates for rooms, rounds, players, and votes.
- `public/sw.js` is only registered in production.
- There is an old `supabase/functions/video-proxy` in the tree, but current playback should not depend on it.

## Contributing

Before opening a PR, at minimum run:

```bash
npm run lint
npm test
```

If you changed extension behavior, also check:

```bash
node --check extension/background.js
```
