# ContentKita

30 hari content khas untuk restoran anda.

ContentKita turns a short restaurant profile into a 30-day social media content
plan — hook, caption, CTA, photo idea and (where it fits) a Reel idea for every
day. Built for Malaysian restaurant, cafe and kedai makan owners, in BM.

## Status: Milestone 2

The product is backed by a real Firebase project. Owners sign up with an email
and password, their restaurant and their plan live in Firestore, and everything
survives a refresh, a closed browser and a sign-in from another device.

Content is still produced by the deterministic offline generator behind the
`ContentGenerator` interface — see [Deferred](#deferred).

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in from the Firebase console
npm run dev                  # http://localhost:3000
```

The six `NEXT_PUBLIC_FIREBASE_*` values come from the Firebase console under
**Project settings → General → Your apps → Web app → SDK setup and
configuration**. They are the Firebase *Web* configuration: public by design,
shipped to every browser, and not a secret. Access is enforced by Firebase Auth
and by `firestore.rules`, never by hiding these strings.

Without them the app throws a `FirebaseConfigError` naming the missing
variables. It does not fall back to a local session — see
[Auth](#auth--libauthts).

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Offline unit tests (`node --test`, no test framework needed) |
| `npm run validate` | typecheck + lint + test |
| `npm run verify:firebase` | Live auth + rules check against the real project |

`verify:firebase` creates two throwaway accounts, proves that neither can reach
the other's data and that a signed-out client can reach nothing at all, then
deletes both. It talks to the real project, so it needs `.env.local` and a
logged-in Firebase CLI.

## Routes

| Route | Screen | Access |
| --- | --- | --- |
| `/` | Landing page | Public |
| `/signup`, `/login` | Auth | Public; redirects a signed-in owner to `/dashboard` |
| `/onboarding` | 4-step restaurant profile wizard | Signed in, no restaurant yet |
| `/dashboard` | Today's content + the 30-day plan | Signed in, onboarded |
| `/content/[id]` | One day in full, with copy and regenerate | Signed in, onboarded |
| `/profile` | Edit the restaurant, regenerate the plan, sign out | Signed in, onboarded |

`/dashboard`, `/content/[id]` and `/profile` share `AppShell` via the
`app/(app)/` route group. The landing page is deliberately outside every
provider, so a visitor who never signs in never downloads the Firebase SDK.

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
demo.ts           Warung Kak Ina, the sample restaurant on the landing page
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

### Firebase — `lib/firebase/`

```
config.ts    reads NEXT_PUBLIC_FIREBASE_*; throws FirebaseConfigError if short
client.ts    lazily initialises the app, Auth and Firestore (browser only)
codecs.ts    RestaurantProfile / ContentPlan ↔ Firestore documents
data.ts      the reads and writes the app performs, keyed by uid
errors.ts    Firebase error codes → plain Malay the owner can act on
```

Three collections, each keyed by the owner's uid:

| Path | Holds |
| --- | --- |
| `users/{uid}` | `email`, `displayName`, `createdAt`, `updatedAt` |
| `restaurants/{uid}` | the restaurant profile + `ownerId` |
| `contentPlans/{uid}` | the 30-day plan, one document, + `ownerId` |

**The uid is the ownership boundary.** Because every document lives at a path
keyed by the owner's uid, there is nothing for a client to spoof — no
`where("ownerId", "==", …)` query to forge. `ownerId` is stored for readability
and future queries, and the rules require it to *match the path* on write, so a
forged value is rejected rather than honoured.

`firestore.rules` denies everything by default, allows `get` (never `list`) and
`create`/`update` only to the signed-in owner of the path, and denies `delete`
outright — deleting an account is not a client operation.

```bash
npx firebase deploy --only firestore:rules --project <project-id>
```

### State — `lib/store.tsx`

`AppProvider` subscribes to Firebase Auth, loads the restaurant and the plan for
the current uid, and exposes them to the screens. Loaded data is tagged with the
uid it belongs to, and everything the components read is *derived* from that
record — so a sign-out or a switch of account cannot leave one owner's plan on
screen for another. localStorage is deliberately not consulted for anything; it
is not the source of truth for authentication or for data.

Writes are explicit and never implicit: saving the restaurant does not touch the
plan, and regenerating a single day writes exactly that one day back. The owner
regenerates the whole plan only by asking for it on `/profile` and confirming.

### Auth — `lib/auth.ts`

`getAuthClient()` returns a `FirebaseAuthClient` behind the `AuthClient`
interface the screens already used in Milestone 1. There is deliberately **no
mock implementation left in the file**: a client that accepts arbitrary
credentials is the kind of thing that survives into production by accident, so
the only way to run ContentKita is against a real Firebase project.

Route protection has two independent layers. `components/auth-gate.tsx` decides
what a browser is allowed to *render*; `firestore.rules` decides what it is
allowed to *read*. The second one is the security boundary — the first exists so
the experience matches.

### Design system

Tailwind v4, tokens defined in `app/globals.css` under `@theme`. No
`tailwind.config`. Primitives in `components/ui/`. The palette is a warm
sambal red on paper cream; category chips use muted tints.

## Deferred

Not built yet, by design:

- Real AI generation (the interface is ready; the implementation is not)
- Password reset, email verification, Google and social sign-in
- Payments, Stripe, subscriptions — the Pro tier is marked "Akan datang"
- Firebase Storage, Cloud Functions, analytics, push notifications
- Multi-restaurant accounts, team access, scheduling/publishing integrations
