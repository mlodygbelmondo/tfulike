# TikTok Data Portability API — Application Package

Apply at: https://developers.tiktok.com → Manage apps → Add products →
**Login Kit**, **Webhooks**, **Data Portability API** → Apply for scopes.

Decision typically within 3–4 weeks. If rejected, you can reapply at any time.

## Prerequisites checklist

- [ ] TikTok developer account (personal is fine to start)
- [ ] App registered on TikTok for Developers, at least in **Staging** status
- [ ] Redirect URI registered: `https://tfulike.vercel.app/api/tiktok/oauth/callback`
      (add `http://localhost:3000/api/tiktok/oauth/callback` for sandbox)
- [ ] Screenshots of the UX mockups (open `mockups.html` in a browser,
      screenshot each of the 4 screens — the application requires these)
- [ ] Everything submitted in **English**

## Scopes to request

- `portability.all.single` — one-time transfer of the user's data archive
  (the Like List lives in the full-archive category)
- `portability.all.ongoing` — recurring permission, so returning players can
  re-sync before each game night without re-authorizing

## Suggested application answers (edit to taste)

**App name:** tf u like?

**Service description:**

> "tf u like?" is a social party game for groups of friends, playable on the
> web (https://tfulike.vercel.app). Players join a shared game room; in each
> round, one video that a player has liked on TikTok is shown anonymously,
> and everyone else guesses which member of the group liked it. Points are
> awarded for correct guesses.

**Why we need the Data Portability API / use case:**

> Our core feature requires, with the user's explicit consent, a list of the
> videos they have liked on TikTok ("Like List" within the Activity data).
> Each player individually connects their own TikTok account via Login Kit
> and authorizes a transfer of their data archive. From the archive we read
> ONLY the Like List (video links and dates). We use it solely to select
> which videos appear in that player's game rounds. We do not read direct
> messages, watch history, searches, or any other categories, and we discard
> the rest of the archive immediately after extracting the Like List.

**Data handling / retention:**

> Extracted Like List entries (video ID, video link, like date) are stored in
> the user's profile in our database (Supabase, EU region) until the user
> deletes their account or requests deletion. The downloaded archive itself
> is processed in memory and never persisted. Access tokens are stored
> encrypted at rest and used only to request and download the user's own
> data at their request. Users can disconnect their TikTok account at any
> time, which deletes stored tokens.

**Why ongoing permission:**

> Players return to the game regularly and expect newly liked videos to
> appear in future game sessions. Ongoing permission lets a returning player
> refresh their Like List with one tap instead of re-authorizing each time.

**Target users / region:**

> Consumers in the European Economic Area (initially Poland). The game is a
> PWA and works on mobile and desktop browsers.

## UX flow (matches mockups.html)

1. **Connect screen** — onboarding step "Sync TikTok Likes" shows a
   "Connect TikTok account" button (alongside the existing options).
2. **TikTok authorization** — standard Login Kit consent screen where the
   user grants the portability scope.
3. **Import progress** — back in the app: "Importing your likes from
   TikTok…" while we add the data request and poll until the archive is
   ready (TikTok prepares it in seconds to hours).
4. **Done** — "Likes imported!" and the player can start/join a game.

## Integration status in this repo

Code is implemented and gated behind `NEXT_PUBLIC_TIKTOK_PORTABILITY_ENABLED`:

- OAuth: `src/app/api/tiktok/oauth/start/route.ts`, `.../oauth/callback/route.ts`
- Data request + import: `src/app/api/tiktok/portability/sync/route.ts`
- API client + archive parsing: `src/lib/tiktok-portability.ts`
- UI: `src/components/tiktok-connect-card.tsx` (onboarding step 2)
- Schema: `supabase/migrations/013_tiktok_connections.sql`

To go live after approval: set `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`,
`TIKTOK_REDIRECT_URI`, `TIKTOK_PORTABILITY_SCOPE` and flip
`NEXT_PUBLIC_TIKTOK_PORTABILITY_ENABLED=true` (see `.env.local.example`).
