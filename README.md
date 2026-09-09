# ContentKita

30 hari content khas untuk restoran anda.

ContentKita turns a short restaurant profile into a 30-day social media content
plan — hook, caption, CTA, photo idea and (where it fits) a Reel idea for every
day. Built for Malaysian restaurant, cafe and kedai makan owners, in BM.

## Status: Milestone 1

The complete product shell runs on local/mock data. Sign-up, persistence and AI
generation are stubbed behind interfaces that are meant to be swapped, not
rewritten. See [Deferred](#deferred) for what is intentionally not built yet.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Content-engine tests (`node --test`, no test framework needed) |
| `npm run validate` | typecheck + lint + test |

## Routes

| Route | Screen |
| --- | --- |
| `/` | Landing page |
| `/signup`, `/login` | Auth (UI only) |
| `/onboarding` | 4-step restaurant profile wizard |
| `/dashboard` | Today's content + the 30-day plan |
| `/content/[id]` | One day in full, with copy and regenerate |
| `/profile` | Edit the restaurant profile |

`/dashboard`, `/content/[id]` and `/profile` share `AppShell` via the
`app/(app)/` route group.

## Architecture

### The content engine — `lib/content/`

The only place content is produced. Everything else consumes the
`ContentGenerator` interface.

```
types.ts          ContentGenerator, ContentPlan, ContentItem, RestaurantProfile
categories.ts     the 30-day rhythm, category metadata, selling fallbacks
templates.ts      the copy itself, grouped by category
mock-generator.ts MockContentGenerator — deterministic, seeded, offline
index.ts          getContentGenerator() — the single swap point
demo.ts           Warung Kak Ina, the sample restaurant
```

**To add real AI**, write an `AIContentGenerator implements ContentGenerator`
and return it from `getContentGenerator()` in `index.ts`. Nothing in `app/` or
`components/` needs to change. Keep `MockContentGenerator` as the fallback when
no API key is configured — the product must stay fully developable offline.

Two properties the mock generator holds and a replacement should keep:

- **Deterministic.** The same profile and the same variant selections always
  produce the same plan, so server and client renders agree and "Jana semula"
  is reproducible rather than a dice roll.
- **It does not invent facts.** Templates declare what they need
  (`requires: ["promotion"]`), and a day scheduled as a selling post falls back
  to a truthful category when the owner gave no offer. This is enforced by the
  data model, not by asking a model nicely. `mock-generator.test.ts` covers it.

### State — `lib/store.tsx`

`AppProvider` reads localStorage through `useSyncExternalStore`, so the server
render and the hydration render both see `null` and there is no mismatch. Three
keys: `contentkita.profile.v1`, `contentkita.variants.v1`,
`contentkita.planStart.v1`. With no saved profile the app shows the Warung Kak
Ina sample and a demo banner.

**To add Supabase**, replace the read/write helpers at the top of this file. The
`AppState` shape that components consume stays the same.

### Auth — `lib/auth.ts`

`getAuthClient()` returns a `LocalAuthClient` that validates input, waits, and
succeeds — it creates no session. **To add Supabase Auth**, write a
`SupabaseAuthClient implements AuthClient` and return it here.

### Design system

Tailwind v4, tokens defined in `app/globals.css` under `@theme`. No
`tailwind.config`. Primitives in `components/ui/`. The palette is a warm
sambal red on paper cream; category chips use muted tints.

## Deferred

Not built in Milestone 1, by design:

- Supabase (database, migrations, RLS) — data lives in localStorage
- Real auth sessions, password reset, email verification
- Real AI generation (the interface is ready; the implementation is not)
- Payments, Stripe, subscriptions — the Pro tier is marked "Akan datang"
- Multi-restaurant accounts, team access, scheduling/publishing integrations
