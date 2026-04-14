# Video Reliability And Prefetch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce the rare TikTok playback failures, add TikTok Photo Mode gallery support with audio, and remove most of the wait between rounds by hardening the extension fetch path and preloading one next-round medium in the browser.

**Architecture:** Keep the existing extension-first playback model. Extend the medium model from video-only to `video | photo_gallery`, parse TikTok Photo Mode image arrays and audio URLs during sync, render photo galleries directly from HTTPS image URLs, fetch gallery audio through the extension blob path, reject non-video fetch responses before they become Blob URLs, and add a one-item-ahead client-side prefetch cache keyed by `videos.id` / `planned_round_number`. This avoids new paid infrastructure and stays aligned with the current Chrome extension + Supabase design.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase, Chrome MV3 extension, Vitest, Testing Library.

---

## Current Findings

- Remote data snapshot: `user_likes` has 815 rows. 799 rows already have multiple candidate URLs. 16 rows have no playable URL candidates at all.
- Those 16 broken likes are a data-quality issue, but they are not the current round-playback root cause. `src/lib/game.ts` already filters out likes where `videoUrls.length === 0` before creating `videos` rows.
- Active room snapshot: `videos` currently has 14 rows across active rooms. All 14 have `tiktok_video_id`, `tiktok_url`, fresh URL candidates, and 4-16 candidates each.
- Direct server-side fetches of the active `video_url` values returned `403 text/html` for every sampled row. That confirms the raw CDN URLs are only reliable from the browser/extension path, not from a generic server or Node fetch.
- The most likely current code-level failure points are:
  - `extension/background.js` accepts any `2xx` response as success, even when TikTok returns `text/html` or another non-video body.
  - `src/components/game-play-view.tsx` treats `extensionPresentRef.current === null` the same as `false`, so an early playback failure can skip refresh even though the extension is actually installed.
  - `src/components/game-play-view.tsx` only resolves the active round video on demand. There is no cache or prefetch for the next round, so every round waits for `fetch -> arrayBuffer -> base64 -> Blob URL` from scratch.

## Recommended Scope

Implement two focused changes first:

1. Harden the existing playback path so non-video fetch responses fail fast and still trigger refresh.
2. Support TikTok Photo Mode galleries with image navigation and audio.
3. Prefetch exactly one next-round medium while the current round is already playing.

Do not add a paid proxy, CDN, or server-side TikTok playback path. Do not prefetch the full game upfront. The current data does not justify the extra complexity or cost.

## Photo Mode Findings

- The currently "missing" rare items are real TikTok Photo Mode posts, not just broken videos.
- Sample rows from `user_likes` have:
  - `video_url = null`
  - `video_urls = []`
  - `cover_url` on `*-photomode-*` hosts
- Sample `cover_url` image requests succeed directly as `image/jpeg`, so gallery images can render from HTTPS URLs without the extension.
- The practical architecture for v1 is:
  - images: direct HTTPS URLs in the page
  - gallery audio: fetched through the extension and converted to a Blob URL
  - navigation: simple previous/next controls plus tap/swipe later if needed

### Task 0: Add Photo Mode To The Shared Media Model

**Files:**
- Modify: `extension/tiktok-sync.js`
- Modify: `extension/background.js`
- Modify: `extension/tiktok-sync.test.js`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/game.ts`
- Modify: `src/lib/__tests__/game.test.ts`
- Modify: `src/app/api/profile/sync-likes/route.ts`
- Modify: `src/app/api/profile/sync-likes/__tests__/route.test.ts`
- Modify: `src/app/api/rooms/[pin]/start/route.ts`
- Modify: `src/app/api/rooms/[pin]/rounds/next/route.ts`
- Modify: `src/app/api/rooms/__tests__/rooms-start.test.ts`
- Create: `supabase/migrations/010_photo_gallery_media.sql`

**Step 1: Write the failing tests**

Cover these behaviors first:

- extension parser returns `media_type: "photo_gallery"`
- image URLs are extracted from `imagePost` and `image_post`
- audio URL is extracted from `music.playUrl` and `music.play_url`
- `assignRoundOrder()` keeps photo galleries even when `video_urls` is empty but `image_urls` is not
- `/api/profile/sync-likes` persists `media_type`, `image_urls`, `audio_url`
- `/api/rooms/[pin]/start` allows photo gallery items to materialize into `videos`

**Step 2: Run the tests to verify they fail**

Run:

`npm test -- extension/tiktok-sync.test.js src/lib/__tests__/game.test.ts src/app/api/profile/sync-likes/__tests__/route.test.ts src/app/api/rooms/__tests__/rooms-start.test.ts`

Expected: FAIL before implementation.

**Step 3: Implement the minimal shared media model**

Add a shared medium model with:

- `media_type: 'video' | 'photo_gallery'`
- `video_url`
- `video_urls`
- `image_urls`
- `audio_url`
- existing `cover_url`

Keep the round-selection rule minimal:

- `video` is playable if it has `video_urls.length > 0`
- `photo_gallery` is playable if it has `image_urls.length > 0`
- items with neither are still filtered out

**Step 4: Add the migration**

Create `supabase/migrations/010_photo_gallery_media.sql` that adds the new fields to `user_likes` and `videos`.

**Step 5: Re-run the tests**

Run the same command from Step 2.

Expected: PASS

### Task 0.5: Render Photo Galleries With Audio In Gameplay

**Files:**
- Modify: `src/components/game-play-view.tsx`
- Modify: `src/components/__tests__/game-play-view.test.tsx`
- Modify: `src/lib/extension.ts`

**Step 1: Write the failing tests**

Cover these behaviors:

- photo gallery rounds render the first image
- previous / next buttons move between images
- photo gallery audio loads through the extension blob fetch path
- sound toggle controls gallery audio as well as normal video playback

**Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/__tests__/game-play-view.test.tsx`

Expected: FAIL before implementation.

**Step 3: Implement the minimal renderer**

In `src/components/game-play-view.tsx`:

- branch on `video.media_type`
- keep existing video renderer unchanged for `video`
- for `photo_gallery` render:
  - current image with descriptive alt text
  - image position chip like `1 / N`
  - simple `Previous photo` and `Next photo` buttons
  - an `<audio>` element fed by `requestMediaDataUri(video.audio_url)` when audio exists
- keep one shared sound toggle button for both medium types

Do not add drag gestures in this pass. Keep controls explicit and reliable.

**Step 4: Re-run the component tests**

Run: `npm test -- src/components/__tests__/game-play-view.test.tsx`

Expected: PASS

### Task 1: Reject Non-Video Fetch Responses In The Extension

**Files:**
- Create: `extension/video-fetch.js`
- Create: `extension/video-fetch.test.js`
- Modify: `extension/background.js`
- Modify: `src/lib/extension.ts`

**Step 1: Write the failing tests**

Create `extension/video-fetch.test.js` with focused tests for the response validator.

```js
import { describe, expect, it } from "vitest";
import { validateVideoFetchResponse } from "./video-fetch.js";

describe("validateVideoFetchResponse", () => {
  it("rejects a 200 HTML response", async () => {
    const response = new Response("<html>blocked</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });

    await expect(validateVideoFetchResponse(response, "https://example.com/x.mp4"))
      .rejects.toThrow("non-video");
  });

  it("accepts a video response", async () => {
    const response = new Response(new Uint8Array([0, 1, 2]), {
      status: 200,
      headers: { "content-type": "video/mp4" },
    });

    await expect(validateVideoFetchResponse(response, "https://example.com/x.mp4"))
      .resolves.toMatchObject({ mimeType: "video/mp4" });
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npm test -- extension/video-fetch.test.js`

Expected: FAIL because `validateVideoFetchResponse` does not exist yet.

**Step 3: Write the minimal implementation**

Create `extension/video-fetch.js` and move the response validation there.

```js
export async function validateVideoFetchResponse(response, requestUrl) {
  const contentType = response.headers.get("content-type") || "application/octet-stream";

  if (!response.ok) {
    throw new Error(`Fetch failed with status ${response.status}`);
  }

  if (!contentType.toLowerCase().startsWith("video/")) {
    throw new Error(`TikTok returned non-video content: ${contentType}`);
  }

  const buffer = await response.arrayBuffer();
  return { buffer, mimeType: contentType, requestUrl };
}
```

Keep the helper small. The point is to reject HTML/JSON challenge pages before they turn into a Blob URL that the `<video>` element cannot play.

**Step 4: Wire the helper into the background fetch path**

Update `extension/background.js` so `handleFetchVideoData()`:

- calls `validateVideoFetchResponse()` after `fetch()`
- does not base64-encode HTML / JSON responses
- returns structured failure details to the page, for example:

```js
return {
  ok: false,
  error: "TikTok returned non-video content: text/html",
  debug: {
    status: response.status,
    contentType,
    host: normalizedUrl.host,
  },
};
```

Update `src/lib/extension.ts` so `VideoDataResponse` can carry `debug` fields.

**Step 5: Re-run the tests and syntax checks**

Run: `npm test -- extension/video-fetch.test.js`

Expected: PASS

Run: `node --check extension/background.js`

Expected: no syntax errors

### Task 2: Fix The Refresh Race In `GamePlayView`

**Files:**
- Modify: `src/components/game-play-view.tsx`
- Modify: `src/components/__tests__/game-play-view.test.tsx`

**Step 1: Write the failing test**

Add a test proving that refresh is still attempted when extension presence is still unknown (`null`) but the initial playback path has already started.

```tsx
it("still tries refresh when extension presence check has not resolved yet", async () => {
  vi.mocked(checkExtensionPresent).mockImplementation(() => new Promise(() => {}));
  vi.mocked(requestVideoRefresh).mockResolvedValue({ ok: false, error: "refresh failed" });

  // render with a video, then trigger the video element error
  // expect requestVideoRefresh to be called even though presence is unresolved
});
```

**Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/__tests__/game-play-view.test.tsx`

Expected: FAIL because the current code treats `null` as “extension missing”.

**Step 3: Implement the minimal fix**

In `src/components/game-play-view.tsx`:

- change the refresh guard from `if (!extensionPresentRef.current)` to `if (extensionPresentRef.current === false)`
- keep `null` as “unknown, try anyway”
- when `requestVideoDataUri()` or `requestVideoRefresh()` returns any extension response, treat that as proof the extension is present for the rest of the session
- when `requestVideoDataUri()` fails with structured debug details, include them in `logVideoDebug()`

Keep the rest of the retry order the same:

1. try next saved candidate
2. if all candidates fail, ask the extension for fresh URLs
3. only mark the round unavailable after refresh also fails

**Step 4: Re-run the component tests**

Run: `npm test -- src/components/__tests__/game-play-view.test.tsx`

Expected: PASS

### Task 3: Add Lightweight Failure Telemetry For Rare Cases

**Files:**
- Create: `supabase/migrations/010_video_playback_failures.sql`
- Modify: `src/lib/types.ts`
- Create: `src/app/api/video-playback-failures/route.ts`
- Create: `src/app/api/video-playback-failures/__tests__/route.test.ts`
- Modify: `src/components/game-play-view.tsx`

**Step 1: Write the failing route tests**

Create a narrow route test file that covers:

- `401` for unauthenticated requests
- `400` for malformed payloads
- `200` for valid failure events

Use the existing API-route test style from `src/app/api/profile/sync-likes/__tests__/route.test.ts`.

**Step 2: Run the test to verify it fails**

Run: `npm test -- src/app/api/video-playback-failures/__tests__/route.test.ts`

Expected: FAIL because the route and table do not exist yet.

**Step 3: Add the minimal schema**

Create `supabase/migrations/010_video_playback_failures.sql` with one table for failure-only diagnostics.

```sql
create table video_playback_failures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  room_id uuid references rooms(id) on delete cascade,
  video_id uuid references videos(id) on delete cascade,
  tiktok_video_id text,
  stage text not null,
  candidate_index int,
  candidate_host text,
  error text,
  debug jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);
```

Do not log successes. Only log failure paths.

**Step 4: Add the minimal API route**

Create `src/app/api/video-playback-failures/route.ts`.

The route should:

- require an authenticated user
- accept only a small payload shape
- insert one row into `video_playback_failures`
- return `{ ok: true }`

**Step 5: Emit failures from the client**

In `src/components/game-play-view.tsx`, send failure events only from these places:

- `video-data-fetch-error`
- `<video onError>` after the final candidate fails
- extension refresh failure after the final refresh attempt fails

Log these fields at minimum:

- `room_id`
- `video.id`
- `video.tiktok_video_id`
- `candidateIndex`
- candidate host
- `error`
- `debug` from the extension fetch path

Use a best-effort fire-and-forget request. Do not block the UI on telemetry.

**Step 6: Re-run the route tests**

Run: `npm test -- src/app/api/video-playback-failures/__tests__/route.test.ts`

Expected: PASS

### Task 4: Prefetch Exactly One Next-Round Video

**Files:**
- Modify: `src/components/game-play-view.tsx`
- Modify: `src/components/__tests__/game-play-view.test.tsx`

**Step 1: Write the failing tests**

Add three focused tests:

1. `starts prefetching the next planned round after the current video starts playing`
2. `reuses the prefetched blob when the next round becomes active`
3. `revokes the old prefetched blob when the cache entry is replaced`

You will probably need to extend the test Supabase mock so it can answer a `videos` query filtered by `planned_round_number`.

**Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/__tests__/game-play-view.test.tsx`

Expected: FAIL because there is no next-round prefetch logic yet.

**Step 3: Implement the minimal cache**

In `src/components/game-play-view.tsx` add:

- one ref for a single prefetched entry
- one ref for an in-flight prefetch promise
- cleanup that revokes cached Blob URLs on replacement and on unmount

Use a shape like this:

```tsx
type PrefetchedVideo = {
  videoId: string;
  sourceKey: string;
  blobUrl: string;
};
```

**Step 4: Start prefetch only after current playback is stable**

Kick off prefetch from `handlePlaying()` or immediately after the current round enters a stable playing state.

Prefetch algorithm:

1. compute `nextRoundNumber = round.round_number + 1`
2. fetch the matching row from `videos` using `room_id` + `planned_round_number`
3. normalize candidate URLs using the same filtering logic already used for the active round
4. resolve the next video through `requestVideoDataUri()`
5. store the resulting Blob URL in the one-entry cache

Guardrails:

- prefetch only one round ahead
- do not prefetch while the current round is still resolving
- do not prefetch if the current round already failed to load
- do not prefetch multiple copies of the same `video.id`

**Step 5: Use the cache when the next round starts**

When `videoSourceKey` changes for the new active round:

- if the cache entry matches `video.id` and the new `videoSourceKey`, use the cached Blob URL immediately
- skip a duplicate `requestVideoDataUri()` call
- clear the cache entry after handing it off as the active `videoSrc`

**Step 6: Re-run the component tests**

Run: `npm test -- src/components/__tests__/game-play-view.test.tsx`

Expected: PASS

### Task 5: Verify The End-To-End Behavior

**Files:**
- No source changes

**Step 1: Run targeted tests**

Run: `npm test -- extension/video-fetch.test.js src/components/__tests__/game-play-view.test.tsx src/app/api/video-playback-failures/__tests__/route.test.ts`

Expected: PASS

If telemetry was deferred, omit the route test file from this command.

**Step 2: Run related existing regression tests**

Run: `npm test -- src/app/api/rooms/__tests__/video-refresh.test.ts`

Expected: PASS

**Step 3: Run extension syntax checks**

Run: `node --check extension/background.js && node --check extension/content.js`

Expected: no syntax errors

**Step 4: Run lint**

Run: `npm run lint`

Expected: PASS

**Step 5: Manual verification**

Use one active synced room and verify:

1. the current round still plays normally
2. a forced bad candidate triggers refresh instead of immediate “Video unavailable”
3. moving from reveal to next round reuses the prefetched Blob URL with no visible loading gap
4. a final failure writes a row to `video_playback_failures` with enough detail to inspect later

## Notes For Implementation

- Keep `src/lib/game.ts` unchanged unless tests prove otherwise. The empty-candidate likes are already filtered out before rooms are materialized.
- Do not revive `supabase/functions/video-proxy`.
- Do not add server-side TikTok scraping back into `src/app/api/tiktok/scrape/route.ts`.
- Do not prefetch the entire game. One next-round Blob URL is enough for the first pass and avoids unnecessary memory pressure.
- If Blob memory pressure becomes visible later, the next iteration should add a byte-size guard, not a bigger cache.
