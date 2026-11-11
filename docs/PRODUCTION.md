# Taking SightLine to production

What's ready, what's deliberately deferred, and the order to do the rest in.

---

## Where things stand

The app runs end-to-end with **no backend**. Chats and memory persist to disk
on the user's machine; API keys are stored encrypted on the same machine. That is a real, shippable configuration — not a stub — and it is what
the Neon and AWS steps below build on rather than replace.

| Area | Status |
|---|---|
| Coaching loop, voice, memory, saved chats | Working, local |
| Screenshots | In memory only, never written to disk |
| Chats + memory | JSON files under `%APPDATA%/SightLine/data-v2` (the older `data` folder is left untouched) |
| API keys | Encrypted with Electron `safeStorage` (Windows DPAPI) in `%APPDATA%/SightLine/keys.json`, copied in from `.env` at startup |
| Accounts / sign-in | **Not built** — every record already carries a `user_id` column, currently null |
| Neon Postgres | **Not connected** — schema written and ready to apply |
| AWS S3 | **Not needed yet** — see "Do you actually need S3?" below |

---

## 1. Add the ElevenLabs key (5 minutes, biggest quality win)

The single highest-impact thing you can do before showing this to anyone.

1. Create a key at <https://elevenlabs.io> → Profile → API Keys.
2. Put it in `.env` as `ELEVENLABS_API_KEY=...` (see `.env.example`).
3. Restart the app. Settings → Voice → pick a voice → **Preview**.

The status line under the picker tells you which provider actually spoke. If it
says "ElevenLabs — the good one", you're set. If it falls back to Google, the
key or the account's credit balance is the problem — the app will keep working
either way.

Voices are fetched live from your account, so any custom or cloned voice you
create shows up in the picker automatically.

---

## 2. Neon Postgres (when you want history off one machine)

The schema is already written, as SQL, in
[`electron/db/schema.ts`](../electron/db/schema.ts) — exported as
`POSTGRES_SCHEMA` and kept in the same file as the TypeScript types it mirrors,
so the two can't drift unnoticed.

**Tables:** `users`, `memory_facts`, `chats`.

### Applying it

```bash
# 1. Create a project at https://console.neon.tech and copy the connection string
# 2. Dump the schema constant to a file and apply it
node -e "import('./dist-electron/main.mjs')" # or copy POSTGRES_SCHEMA by hand
psql "$DATABASE_URL" -f schema.sql
```

### Wiring it up

Every read and write already goes through one module:
[`electron/db/store.ts`](../electron/db/store.ts). It exports plain functions —
`saveChat`, `listChats`, `getChat`, `listFacts`, `saveFacts`, and so on.
Nothing above that file knows how persistence works.

To move to Neon: write `electron/db/store-postgres.ts` exporting the same
function signatures, and switch the import in `electron/main.ts`. That's the
whole change. Keep the local store as the offline fallback — a coaching session
should not fail because a database is unreachable.

**Order matters:** do auth before Neon, or every row lands with a null
`user_id` and you'll be backfilling. The columns and foreign keys are already
in the schema.

---

## 3. Do you actually need S3?

Probably not, and it's worth being clear about why.

Screenshots are the only large artifact this app produces, and they are
**deliberately never persisted** — they exist in memory for the length of a
chat and are gone when it ends. That's a privacy property worth keeping: the
app watches your screen, and the strongest promise it can make is that it
doesn't keep what it saw.

Everything that *is* stored is text: chat transcripts, step logs, memory facts. A
heavy user generates a few megabytes a year. That belongs in Postgres, not
object storage.

Add S3 (or Cloudflare R2) only if you later decide to support:

- **Session recordings** — replaying what the screen looked like. This reverses
  the privacy property above; make it opt-in and per-session, never a default.
- **Exported chats or plans** as PDF or video.
- **Uploaded reference material** larger than the current text-file limit.

If you do: `AWS_REGION` and `AWS_S3_BUCKET` are already reserved in
`.env.example`. Serve through CloudFront with signed URLs, and set a lifecycle
rule to expire recordings — storing screen recordings indefinitely is a
liability, not a feature.

---

## 4. Authentication

Not built, by design — it's the dependency you said could come later, and
nothing else is blocked on it.

What's already in place:

- `user_id` on every table, nullable, with the foreign keys defined.
- A `users` table with `email` and `display_name`.
- `ChatRecord.userId` and `MemoryFact.userId` plumbed through the app, set
  to `null` today.

What to do when you add it: populate those fields when a chat starts, filter
`listChats()` and `listFacts()` by the signed-in user, and backfill existing
local rows to the first account on first sign-in.

---

## 5. Pre-release checklist

### Verify

```bash
npm run lint     # tsc over both compilation targets
npm test         # the unit tests (753 on 11 November 2026)
npm run build    # production Vite + esbuild bundle
npm run dev      # launch and click through it
```

Runtime behaviour — audio, capture, pacing — needs a real run. The automated
tests cover the pure logic, not how it feels.

### Manual pass

- [ ] Type a goal on Home; the coach should say the goal back, and give step one once you say yes
- [ ] Ask a quick question; it should simply answer, with no rail down the side
- [ ] Hold the push-to-talk key mid-sentence — the coach should stop *immediately*
- [ ] Scroll up in a long chat and let a step finish; the view should stay put and a "ready" pill appear
- [ ] Open the "⋯" menu; the cost so far should move, and Settings → Spend should be able to cap a sitting
- [ ] Leave a chat, reopen it, and confirm it greets you with where you left off
- [ ] Finish a chat, then start a new one and confirm it remembers something
- [ ] Settings → Memory → "Review what it remembers" → forget a fact
- [ ] Unplug/replug a monitor while docked; the sidebar should recover
- [ ] Settings → Diagnostics → Open log file, and confirm `[loop]` lines explain the pacing

### Before the installer

- [ ] `build/icon.ico` exists (referenced by `package.json` → `build.win.icon`)
- [ ] Bump `version` in `package.json`
- [ ] Confirm `.env` is **not** in the build — keys come from the encrypted store
- [ ] `npm run dist` and install the output on a clean machine
- [ ] Code-sign the installer, or Windows SmartScreen will warn every user

---

## 6. What it costs to run

Measured against the actual payload the loop sends (see
`src/__tests__/usage.test.ts`, which fails if a change inflates it):

| Usage | Claude calls/hour | Cost |
|---|---|---|
| Typical session | ~130 | **~$1.09** |
| Heavy — a call every 18s | 200 | **~$1.79** |

Plus ElevenLabs speech. That was roughly $0.05–0.15/hour on the Flash model; the app moved to ElevenLabs' v4 Turbo model on 10 November 2026 for a more natural voice, which very likely costs more per character and has not been measured.

The Claude figures above were measured before the coach moved to Sonnet 5.5 and Opus 5.5. The one live run on Sonnet 5.5 so far cost 25 cents for 16 looks.

The default cap is $3/session, chosen as a runaway guard rather than a ration —
a cap that trips mid-task is worse than no cap. It's adjustable in Settings.

Three things keep this down, and all three are worth preserving:

1. **The system prompt is cached.** It's byte-identical across ticks, which is
   why per-tick data goes in the user message. If cache hit rate collapses (it's
   logged every tick), something has leaked into the prefix.
2. **Only the latest screenshot is full resolution.** History frames go at
   640px — 4x cheaper, and they only exist to answer "what changed".
3. **Most ticks never reach Claude at all.** The frame comparator and the gate
   in `src/lib/loopGate.ts` skip unchanged screens.

---

## 7. Known limits

- **Windows only.** Docking uses the Windows AppBar API through native FFI, and
  screen calibration works around a Windows-specific display-ID bug. A macOS
  port needs a different mechanism for both.
- **Push-to-talk needs an OpenAI key** for Whisper transcription. Typed
  follow-ups work without it.
- **The chat list caps at 500 chats** and memory at 400 facts, pruned
  oldest-first (chats by last active, facts by last used).
- **No multi-device sync** until Neon and auth are wired.
