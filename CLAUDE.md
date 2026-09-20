# Operating instructions

Read this before writing any code. This project has a hard deadline (Sunday 8:00 PM IST) and a set of architectural decisions that were already worked through in detail before any code was written — don't re-derive or second-guess them, build against them.

## Non-negotiable decisions already made

These were each chosen over a simpler or more "impressive-sounding" alternative, for specific reasons. Don't swap them out mid-build without checking `docs/` first.

1. **Real recorded human voice/face is the headline feature.** AI-narrated fallback (Polly) exists only as a safety net if the human-recording pipeline breaks, never as the primary path in the demo.
2. **Recording happens scene by scene against a teleprompter, not as one long take.** This was chosen specifically because it makes the video-to-visual matching almost free (each clip is already born matched to its scene) instead of needing heavy post-hoc alignment.
3. **Sync uses a two-pointer match between the known script and the messy Whisper transcript — not phrase detection, not an ML alignment model.** The script is authoritative. The transcript is allowed to be messy (stutters, repeats, filler words). See `docs/SYNC_ALGORITHM.md` before touching this code.
4. **UI-demo scenes use the browser's tab-picker (`getDisplayMedia`), recorded as one silent clip per demo step, separate from the narration (so the app can use the mic), not desktop capture and not an uploaded video from elsewhere.** Auto-zoom-on-click is good-to-have, not must-have.
5. **Hinglish is the default and a first-class requirement of the script prompt, not a translation pass after the fact.** (English is a second option, picked before drafting; it has its own example lines.) Give the generation prompt real Hinglish example lines to match register against, or it defaults to stiff, formal Hindi. Use Polly's **Kajal** voice for any AI-narrated audio — it's built to switch Hindi/Indian-English mid-sentence.
6. **Video rendering does not run on Lambda.** It runs on Fargate, started by a Step Functions workflow that cleans up (marks failed, refunds a tester, alerts) if the task fails. The Fargate image only changes when it is rebuilt and pushed, so after any change under `render/` or `shared/` rebuild it (or test with `RENDER_MODE=local`).
7. **Narration is written to be spoken.** Short sentences, plain words, no dashes, colons or hype. The rules live in `backend/src/lib/prompts/spokenStyle.ts` and are checked on the output; a user's own wording is never rewritten.
8. **Access is enforced on the server, in one place.** Every route goes through `guard()` (`backend/src/lib/auth/access.ts`): sign-in, project ownership, quota. New routes must use it (Lambda: wrap with `secured()`; local server: `secure()`). Hiding a page in the UI is not protection. Sign-in is Cognito. Never print or commit `AUTH_SECRET` or `backend/.accounts.txt`.
9. **The Zod schemas in `shared/` are the single source of truth.** Change a shape there first; the API, the frontend and the renderer all use it.
10. **How a frame looks lives in `shared/src/visualDesign.ts`, and it is themeable.** Every color is a CSS variable; a script's `theme` (`dark` default, `light` = the website's tokens and Geist Mono) picks the palette. Never hardcode a color in a visual or in slide HTML, and add new slide building blocks there, so the renderer and the review preview stay identical. A change here needs the Fargate image rebuilt.

## Where things stand

Everything is built and deployed (see the live link in `README.md`), including dark and light slide themes, richer slide blocks (bullets, tables, stat cards), and the redesigned dashboard and Studio. The LLM is Gemini and transcription is Whisper via Groq, not Bedrock and AWS Transcribe as first planned; both are behind provider interfaces. Frontend hosting is a Lambda behind the same HTTP API, because this AWS account can't create CloudFront resources yet. `docs/ARCHITECTURE.md` is the current design; `docs/FEATURES.md` says what is built, where to find it, and what is not built.

## Build order

Done in the order `docs/SCOPE_PLAN.md` set out: repo in, locked script, AI-narrated (Polly) fallback video end to end, then the human-recording sync as upside. Keep the fallback path working.

## When you finish a piece

Update `PROGRESS.md` with what's done, what broke, and what's still open. Keep it current across sessions — that file is the memory of this build, not this conversation.

## What NOT to build unless the must-haves are done

Everything under "Not built yet" in `docs/FEATURES.md`. Especially: auto-zoom-on-click, multi-visual-beat animation triggered by anything other than the two-pointer checkpoint match, and any attempt to auto-drive a target app's UI via browser automation (not planned — screen-share is user-driven, not agent-driven).

## Style

Plain, direct code and comments. No filler. If something in these docs turns out to be wrong once you're actually building it, say so and update the doc, don't silently drift from it.
