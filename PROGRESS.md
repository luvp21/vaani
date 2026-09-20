# Progress log

Update this at the end of every work session, or every time a coding agent finishes a chunk of work. This is the memory of the build across sessions, keep it honest, note what broke, not just what's done.

## Friday, Sept 18

- [x] AWS credit form submitted / account created (IAM user `vaani-dev` set up, AWS CLI +
      SAM CLI installed and authenticated)
- [ ] First Commit check-in confirmed (both members)
- [ ] Builder Center profiles verified (both members)
- [x] Repo ingest working
- [x] Hinglish script generation working, beat-tagged — **tested live end-to-end, but currently
      running on Gemini (now the primary provider, see decision below)**
- [x] Script review UI

Notes:
- **DECISION (Sat Sept 19): Gemini is the primary LLM; not switching back to Bedrock.** The
  organizers (We Make Dev Teams, email from Kunal) confirmed Bedrock is not mandatory, Free Tier
  is fully prize-eligible, and the only requirement is deploying on AWS. Script-gen runs on
  Gemini inside our AWS Lambda. `LLM_PROVIDER` now defaults to `gemini`; `template.yaml` passes
  `GEMINI_API_KEY` via a NoEcho `GeminiApiKey` parameter (deploy with
  `--parameter-overrides GeminiApiKey=...`). The Bedrock client stays in the repo as an unused
  alternative. This supersedes the earlier "do not submit on Gemini" note and the Bedrock
  decision in CLAUDE.md/docs; the AWS support case is no longer blocking anything.
- **AWS Bedrock blocker, exhaustively diagnosed, unresolved as of Friday evening:** account
  (979973571368, IAM user `vaani-dev`, AdministratorAccess) has been unable to invoke any
  Bedrock model for 4-5+ days — well past AWS's stated "verification normally takes less than 2
  hours." Ruled out everything on our side: tested IAM credentials AND a Bedrock API bearer key
  (two different auth mechanisms), bare model IDs, cross-region inference profile IDs, and full
  inference-profile ARNs, across us-east-1/us-west-2/ap-south-1, against Nova/gpt-oss/Llama/
  Mistral/DeepSeek/the exact model (openai.gpt-6-astra) that works in the console Playground —
  every single combination fails identically with `ValidationException: Operation not allowed`.
  Bedrock's on-demand service quotas are all `0.0` account-wide vs. AWS's non-zero defaults. The
  console Playground working is not contradictory evidence — it almost certainly uses an
  internal console-only invocation path, not the public `bedrock-runtime` API our code needs.
  **(No longer blocking, see decision above.) Action taken:** filed an AWS support case (Account and billing, free tier) and emailed
  aws-verification@amazon.com Friday evening; also pursuing the hackathon's AWS rep channel.
  **No further diagnosis possible from our side — purely waiting on AWS now.**
- Claude models specifically are also access-denied on this account regardless of the above (per
  Bedrock console Model Access page) — moot until the account-level block clears anyway, but
  worth knowing this account may need a separate Claude access request even after that.
- Secondary finding worth keeping for later: in `us-west-2`, `amazon.nova-micro-v1:0` rejected
  on-demand invocation and asked for an inference-profile ARN instead of a raw model ID — some
  models in some regions require a cross-region inference profile, not the base model ID.
  Unrelated to the verification block, relevant once we're back to picking a region/model.
- **Gemini stopgap** (`backend/src/lib/llm/`): built a provider-agnostic `LlmClient` interface
  (`converseWithForcedTool`) with `BedrockClient` and `GeminiClient` implementations, switched
  via `LLM_PROVIDER` env var (defaults to `"bedrock"` if unset, so any environment that forgets
  to set it fails toward the correct locked architecture rather than silently staying on
  Gemini). `scriptGen.ts` now builds a plain provider-agnostic `ToolDefinition` instead of a
  Bedrock-specific `Tool` type. Uses `@google/genai` (`gemini-flash-latest` by default, override
  via `GEMINI_MODEL`).
- **Real bug found and fixed while wiring Gemini up:** `GEMINI_MODEL=` left as an empty string
  in `.env` (not unset) silently defeated the `??` fallback — `?? ` only replaces
  `null`/`undefined`, not `""`. Same latent bug existed in the Bedrock model-ID fallback too
  (harmless there only because `.env.example`'s default isn't blank). Fixed both to use `||`.
- **Real Gemini platform limit discovered and worked around:** Gemini's forced function-calling
  (`FunctionCallingConfigMode.ANY`) hard-rejects any tool parameter schema with 8+ properties on
  one object with a bare `400 INVALID_ARGUMENT` — confirmed empirically by bisection, independent
  of which properties or their names. Our beat schema had 9. Restructured `RawBeat` (internal to
  script-gen, NOT the cross-track `Beat`/`VisualSpec` contract, so this didn't require
  re-agreeing anything in `docs/ARCHITECTURE.md`) down to 5 properties: `start_line`/`end_line`
  merged into one `line_range: "10-25"` string, `language` dropped (now inferred from
  `file_path`'s extension in code instead of asked of the model), and `html`/`description`/
  `note` collapsed into one generic `content` field interpreted per `visual_type`. Bisection
  script and scratch files cleaned up after use.
- **Live end-to-end test against real Gemini passed:** ran ingest → script-gen against
  `vercel/ms` with real user context. Output quality is strong — natural code-switched Hinglish
  ("Toh aaj hum dekhenge...", "Sabse pehle code ke top pe dekho..."), correct scene/beat
  structure, real file paths + plausible line ranges from the actual ingested source, language
  auto-inferred correctly, and contextually accurate HTML slides (a regex breakdown, an
  execution-flow diagram) grounded in the repo's real code, not generic filler.
- Stack chosen and confirmed with user: Node.js + TypeScript + AWS SAM for backend Lambda
  functions; React + Vite + TypeScript + Tailwind + shadcn/ui for frontend. npm workspaces
  monorepo: `shared/` (contract types + Zod schemas), `backend/`, `frontend/`.
- `shared/` is the single source of truth for the Scene/Beat/Script/Checkpoint contract from
  `docs/ARCHITECTURE.md`, as Zod schemas with types inferred from them — both frontend and
  backend import the same shapes and validate against them at every API boundary (per this
  user's own security/coding-style rules: never trust external input, request bodies, or
  Bedrock's response without runtime validation).
- **Repo ingest** (`backend/src/lib/ingest.ts`): pulls README + package files + up to 12 capped
  sample source files via the GitHub REST/raw API, not `git clone` — Lambda has no git binary
  and a full clone is more than a capped sample needs. Tested live against
  `octocat/Hello-World` and `vercel/ms` through the local Express dev server; works, returns
  correctly capped results. Doesn't yet deprioritize test files in the sample selection — first
  N source files by path depth, so `*.test.ts` can crowd out other files on some repos. Minor,
  fix later if it matters.
- **Script generation** (`backend/src/lib/scriptGen.ts` + `backend/src/lib/llm/`): forced
  tool-call pattern (`emit_script`) so the response is structured JSON, not parsed free-text.
  System prompt includes real Hinglish example lines per CLAUDE.md #5. LLM output is validated
  with `RawScriptOutputSchema.parse()` before use — untrusted external data like anything else.
  Provider details (Bedrock vs. the Gemini stopgap) covered above — see that note before
  touching this file, especially the "before submission" TODO.
- `BEDROCK_MODEL_ID` defaults to `anthropic.claude-3-5-sonnet-20241022-v2:0` in
  `backend/src/lib/llm/bedrock.ts` and `.env.example` — a known-good placeholder, not yet
  confirmed against this account's actual Bedrock model access (still blocked, see above). Check
  this once Bedrock access clears, before relying on script gen working on the real provider.
- **Script review UI**: repo URL + context form → generating skeleton state → editable
  scene/beat cards (inline textarea per beat, editable scene titles) → lock button. Built with
  React + Vite + Tailwind + shadcn/ui (base-nova style, `@base-ui/react` primitives). Verified
  in a real browser via Claude in Chrome: form renders, ingest call succeeds and shows the
  ingested-file summary, loading/error states both render correctly.
- Backend also runs as a plain Express server (`backend/src/local-server.ts`) wrapping the same
  lib functions the Lambda handlers call, specifically so local dev doesn't depend on SAM CLI.
  `backend/template.yaml` has the real SAM deploy config (3 Lambdas behind one HTTP API, S3
  bucket, Bedrock IAM policy) — still untested with an actual `sam deploy`, though AWS CLI + SAM
  CLI are now installed and the account authenticates fine (S3 works; only Bedrock is blocked).
- AWS CLI 2.36.48 and SAM CLI 1.166.2 installed to `~/.local/bin` (no sudo on this machine),
  already on PATH via `.zshrc`. IAM user `vaani-dev` (AdministratorAccess) configured and
  working for everything except Bedrock (see blocker above).
- Incident: a short-term Bedrock API bearer key got briefly exposed in a chat transcript during
  setup (a redaction command only handled one of two `.zshrc` lines). User revoked it
  immediately. No lasting exposure — it was a 12h-expiry key and is now revoked — but noting it
  since it happened.
- Caught and fixed before it became a real bug: `shared/package.json` originally pointed
  `main`/`types` straight at `src/index.ts`. That works in dev (`tsx` and Vite both transpile
  TS on the fly, including through the workspace symlink) but would have broken at actual
  Lambda runtime, since a plain `tsc` build + Node can't execute a raw `.ts` file. Fixed:
  `shared` now builds to `dist/` and `main`/`types` point there; `build:backend`/
  `build:frontend`/`dev:*` all run `build:shared` first. Rebuilt and reverified everything
  after the fix — ingest still works end to end through the local server.
- Minor tooling note: `npx shadcn@latest add ...` wrote generated component files into a
  literal `./@/...` directory instead of resolving the `@` alias to `./src` — a bug in this
  environment/CLI version, not a project config issue (tsconfig/vite alias config is correct).
  Worked around by moving the files manually. If running `shadcn add` again, check
  `find frontend -maxdepth 1 -name '@'` afterward and relocate if it reappears.

## Saturday, Sept 19

- [x] Visual generation per beat — see note below on what this actually meant
- [x] Polly Kajal narration wired up — real backend pipeline verified end to end; one small
      manual check still open, see note below
- [x] Fallback video complete end to end — **deployed for real and verified against the actual
      AWS stack, not just locally.** repo → script → visuals → Kajal narration → rendered MP4,
      running on real Lambda + real Fargate. See note below.
- [x] Teleprompter recording UI — webcam capture, scene by scene, **verified with a real
      recording in a real browser**, not simulated. See note below.
- [ ] Tab-picker capture for UI-demo scenes — good-to-have per docs/FEATURES.md, not attempted
      (SCOPE_PLAN.md phrases it as "if attempting that feature")
- [x] Transcribe integration confirmed on a real test recording — mechanically works end to end
      (job start → poll → parse), but surfaced a real problem for the sync algorithm's real-world
      accuracy on code-switched content. See note below — this needs a decision before Sunday's
      "wire sync to a real recording" task.
- [x] Two-pointer sync algorithm built + unit-tested — built and passing in isolation, per
      docs/SYNC_ALGORITHM.md's own instruction to verify this before it ever touches a real
      recording; not yet wired to Transcribe/real audio (that's still open, needs the
      recording UI + Transcribe integration first)

Notes:
- **Visual generation turned out to already be mostly done by script-gen itself** —
  `docs/ARCHITECTURE.md`'s data contract has `visual_spec` as part of stage 2's output, and our
  script-gen call already produces real HTML for `slide`/`graph` beats and real file/line refs
  for `code_highlight` beats in the same LLM call (confirmed in the live Gemini test). What was
  actually missing was *rendering* those into a visual — built `frontend/src/components/
  VisualPreview.tsx`: `code_highlight` renders via `react-syntax-highlighter` against the real
  ingested file content (matched by `file_path`) with the target lines tinted and
  auto-scrolled into view (a real UX gap caught and fixed — highlighted ranges deep in a file
  were invisible without this); `slide`/`graph` render their `html` in a fully sandboxed iframe
  (`sandbox=""`, no scripts, no same-origin) since LLM-authored HTML is untrusted content, never
  `dangerouslySetInnerHTML`'d into the main page. Wired into `ScriptReview.tsx`, sourced from
  the ingest result already held in frontend state from the same session.
- Verified live in-browser against `vercel/ms`: both HTML slides and code-highlight previews
  render correctly, including a beat highlighting lines deep in the file (27-32) where the
  auto-scroll fix was needed to actually see it.
- Known minor items, not urgent: production bundle is ~977KB (333KB gzipped), mostly
  `react-syntax-highlighter`'s full Prism language bundle — could switch to `PrismLight` with
  only registered languages later if load time becomes a real concern. Not fixed now.
- Still open from this milestone: this only covers `slide`/`graph`/`code_highlight`. `ui_demo`
  is explicitly a good-to-have (`docs/FEATURES.md`) and just shows a placeholder — correct,
  don't build more for it yet.
- **Polly Kajal narration** (`backend/src/lib/narration/`): synthesizes each beat's text
  separately via Polly (`VoiceId=Kajal`, `Engine=neural` by default, `POLLY_ENGINE=generative`
  available), concatenates a scene's beat audio into one MP3 (`Buffer.concat` — pragmatic, not
  frame-perfect, acceptable for a fallback demo), uploads to S3, returns a presigned URL
  (1h expiry) + per-beat offsets. Since we generate the audio ourselves, each beat's exact
  duration comes straight from `music-metadata` parsing the synthesized MP3 — **no transcription
  or two-pointer sync needed for this path**, cumulative beat durations directly become the
  checkpoints the render step will need. New endpoint `POST /api/narrate { script_id }`, fetches
  the locked script from S3 rather than re-accepting it over the wire. Frontend:
  `NarrationPanel.tsx`, one `<audio controls>` per scene, wired into `App.tsx` after lock.
- **Verified via direct testing (not just believed to work):** full pipeline tested with `curl`
  end to end — locked a script, called `/api/narrate`, downloaded the resulting presigned S3
  URL, confirmed with `file`/`ffprobe` it's a valid MP3 with duration (9.919s) matching the
  computed sum of beat durations (9912ms) to within 7ms. Also drove the *actual UI* through
  Claude in Chrome: ingest → script-gen → lock → narrate all fired as real network calls (all
  200s) through real clicks, not simulated. Confirmed via direct DOM inspection that the
  `<audio>` elements render with correct presigned `src` URLs, one per scene.
- **One thing NOT fully closed out:** couldn't get 100% conclusive proof of actual in-browser
  playback (not "does the data exist and is it valid" — already proven above — but "does
  clicking play in a real browser tab produce sound"). Hit real tooling limits chasing this:
  the browser tab used for testing showed unrelated flakiness all session (repeated CDP
  screenshot timeouts), Chrome's native direct-media-URL viewer doesn't expose to automation,
  and a `fetch()`-based check hit CORS (expected — CORS doesn't apply to `<audio src>` loads,
  only to `fetch()`, so that failure doesn't indicate a real problem). Given the underlying data
  is independently verified correct, this is very likely fine, but **do one 5-second manual
  check**: open the app in a normal browser, generate narration, click play on a scene, confirm
  audio comes out. Flagging honestly rather than claiming full verification I don't have.
- **AWS credentials note:** created a real S3 bucket for this
  (`vaani-ai-979973571368-us-east-1`, public access blocked, presigned URLs only) since none
  existed yet — SAM's `template.yaml` creates one on deploy but we're still on the local Express
  server. `backend/.env`'s `S3_BUCKET`/`AWS_REGION` point at it now.
- **Second credential-exposure incident, same category as the earlier Bedrock bearer-token
  leak:** used the `Read` tool directly on `backend/.env` to update it, which printed the
  Gemini API key in plaintext into the conversation. User asked to revoke/regenerate it via
  Google AI Studio. Going forward: never `Read` a file known to hold secrets — presence-only
  checks (`grep -c`) only, exactly like the AWS-credentials handling already established.
  Also note for future sessions: presigned S3 URLs were treated as lower-severity than
  long-lived keys when debugging narration playback (time-limited to 1h, scoped to one object,
  designed to be shareable) — reasonable, but keep being deliberate about what gets read vs.
  presence-checked.

- **Render stage (stage 8, Fargate — never Lambda per CLAUDE.md #6) built, new `render/`
  workspace.** New npm workspace, not deployed as a Lambda — it's a one-off container run via
  ECS `RunTask` (not a long-running service, so cost is only actual render runtime).
  - `render/src/visuals.ts`: turns a beat into a fixed 1280x720 HTML page ready to screenshot.
    `code_highlight` uses `shiki`'s `decorations` API for VS-Code-quality syntax highlighting
    (server-side, no browser needed for this part) against the real ingested file content, with
    a ±5-line context window around the target range (screenshotting an entire huge file isn't
    useful). `slide`/`graph` just wrap the beat's already-LLM-generated `html`. `ui_demo` shows
    a placeholder (it's a good-to-have, matches the visual-preview decision from earlier).
  - `render/src/screenshot.ts`: Playwright/Chromium screenshots each beat's HTML at exactly
    1280x720, so every frame is already the right size for ffmpeg, no scaling step needed.
  - `render/src/ffmpeg.ts` + `index.ts`: per scene, builds an ffmpeg concat-demuxer image list
    where each beat's screenshot holds for exactly its narration duration (from
    `NarrationResult`), muxes with that scene's real audio track, then concatenates all scene
    videos (stream copy, no re-encode) into the final MP4. Uploads to S3, writes status
    throughout (`pending → running → done`/`error`) so the frontend can poll.
  - New endpoints: `POST /api/render { script_id }` (fires `ecs:RunTask`, returns immediately)
    and `GET /api/render/:scriptId/status` (backend generates a *fresh* presigned URL for the
    video on each read when done, rather than trusting a URL the worker wrote once — presigned
    URLs expire, worker-write and status-read can be arbitrarily far apart). Frontend:
    `RenderPanel.tsx`, polls every 3s while pending/running, shows a `<video controls>` when done.
  - **Real gap found and fixed along the way:** the render worker needs actual source file
    content for `code_highlight` beats and the real narration timing, but neither was ever
    persisted server-side before now — `IngestResult` only lived in the frontend's browser
    session, and `NarrationResult` was only ever returned to the caller, never stored. Fixed
    both: `LockedScript` now includes `ingest`, and `narrateScript()` now persists its result to
    S3. Centralized all S3 key naming (`shared/src/storageKeys.ts`) since backend and render are
    genuinely separate codebases now — a string-literal typo between them would've been a
    silent, hard-to-spot bug.
  - **New AWS infrastructure added to `template.yaml`** (validates clean with `sam validate
    --lint`, fixed two real issues it caught: an em-dash in a resource description AWS's naming
    pattern rejects, and `nodejs20.x` — already deprecated as of this environment's "today",
    April 2026 — bumped to `nodejs24.x` project-wide): ECR repo, ECS cluster, a Fargate task
    definition (2 vCPU / 4GB — Chromium + ffmpeg need real headroom), a security group
    (outbound-only), and IAM roles scoped to exactly S3 get/put + ECS RunTask + the two task
    roles' PassRole, nothing broader. VpcId/SubnetIds are template Parameters (account's default
    VPC — looked up via CLI, no new VPC needed) rather than hardcoded, since they're
    account/region-specific.
  - **Extensively validated locally before ever touching Docker**, since the Docker daemon on
    this machine needs `sudo` to start and isn't running yet (asked the user to start it,
    still pending as of this note): confirmed the Shiki decorations API behaves exactly as
    assumed (0-indexed, half-open range) with a standalone script; confirmed the *entire* ffmpeg
    pipeline (per-scene image+audio assembly, then final stream-copy concat) produces valid,
    correctly-timed MP4s using synthetic test assets; installed Playwright's Chromium locally
    (browser binary only, no `--with-deps`, worked without needing the sudo it wanted) and ran
    the real `beatVisualHtml` + `screenshotHtml` integration for both `code_highlight` and
    `slide` beats against real inputs — actually looked at the resulting PNGs. Caught and fixed
    a real cosmetic bug this way: Shiki's per-line `<span class="line">` elements need
    `display: block` set on *all* lines, not just highlighted ones, or the newline text nodes
    between spans create visible gaps between consecutive highlighted lines instead of one
    continuous block. **The only genuinely untested pieces are the Docker image build itself and
    an actual `ecs:RunTask` execution** — but every individual piece of logic inside that
    container has now been proven correct in isolation, so that remaining risk is much smaller
    than it would otherwise be.
- **Deployed for real — Docker came up, and the whole thing went from "locally validated" to
  "actually running on AWS" in one session.**
  - **Real bug found deploying Lambda from an npm-workspaces monorepo, worth remembering:**
    `CodeUri: .` zipping `backend/` as-is would have shipped Lambda code with no `node_modules`
    at all — npm workspaces hoists every dependency to the *repo root*, not `backend/`. `sam
    build`'s default Node builder doesn't know about workspaces either. Fixed by switching every
    function to `Metadata: BuildMethod: esbuild` (bundles the resolved workspace deps, including
    `@vaani/shared`, straight into one file per function — no separate npm install needed at
    build time). Needed `esbuild` explicitly as a `backend` devDependency and on `PATH` for `sam
    build` to find it (`node_modules/.bin` from the repo root, since that's where hoisting put
    it). One non-obvious gotcha: esbuild's output flattens `handlers/ingest.ts` → `ingest.js` at
    the build dir's root, not `handlers/ingest.js` — `Handler:` had to match that (was wrong on
    the first attempt, `sam build` succeeded anyway since it doesn't validate the handler path,
    only `sam deploy`/actual invoke would have caught it).
  - Also bumped `nodejs20.x` → `nodejs24.x` (SAM's linter flagged it as already deprecated as of
    this environment's "today", April 2026) while fixing the template.
  - **Deploy hit a real conflict**: the S3 bucket I'd manually created earlier for local testing
    (`vaani-ai-979973571368-us-east-1`) collided with the one `template.yaml` declares under the
    same deterministic name — CloudFormation's early-validation rejected the changeset outright.
    Asked the user how to resolve it rather than unilaterally deleting real cloud state; they
    chose deleting the test bucket (it only held this session's own throwaway test data) over
    renaming, confirmed contents were just test artifacts before deleting.
  - `sam deploy --stack-name vaani-backend --region us-east-1 --resolve-s3 --capabilities
    CAPABILITY_IAM --parameter-overrides VpcId=... SubnetIds=...` — succeeded, created all 6
    Lambdas, the HTTP API, S3 bucket, ECR repo, ECS cluster, Fargate task definition, security
    group, and IAM roles in one shot. Built and pushed the render image to the new ECR repo.
  - **Ran the real thing end to end against the deployed stack** (not local docker run this
    time): hit the real API Gateway URL for `/ingest` → `/script/lock` → `/narrate` (all real
    Lambda invocations — noticed the presigned URLs came back signed with `ASIA...` temporary
    role credentials, not my own `AKIA...` user creds, confirming the Lambdas' own IAM roles are
    what's actually doing the work) → `/render`. Confirmed via `aws ecs list-tasks` that a real
    Fargate task launched, watched it go `PENDING → DEPROVISIONING/STOPPED` with **exit code 0**,
    polled `/render/:id/status` and got back `"done"` with a working presigned video URL.
    Downloaded and `ffprobe`'d the actual output: valid MP4, duration matched the narration total
    exactly. **This is the full fallback path — repo → script → visuals → Kajal narration →
    rendered video — running for real on deployed AWS infrastructure, not simulated or
    locally-only.**
  - Updated `backend/.env`'s `ECS_*` values from the deployed stack's actual resource IDs so
    local dev can also trigger real renders against the same infrastructure going forward.

- **Two-pointer sync algorithm** (`backend/src/lib/sync/`) — the piece `docs/FEATURES.md` calls
  "the hardest and most novel piece." Built exactly to `docs/SYNC_ALGORITHM.md`'s spec: script
  pointer only advances on a match, transcript pointer always advances, a non-match costs only
  the transcript side (treated as stutter/repeat/filler/mis-hear). Loose word matching
  (`matches.ts`): lowercase + strip punctuation, then a 1-edit Levenshtein fallback for short
  words (≤4 chars) where ASR near-misses are common and proportionally costly. Stall handling
  (word stuck for `stallThreshold` transcript words, default 18 per the doc's "start around
  15-20") force-advances the script pointer past whatever's stuck.
  - **One real gap in the doc, filled in with a documented judgment call, not silently**: the
    spec doesn't say what happens if the *stuck* word is itself a beat boundary — the "advance i
    anyway" fallback as written would silently drop that beat's checkpoint entirely. Decided:
    give it a best-effort checkpoint from the transcript position where the stall resolved
    (documented inline in `index.ts` — a checkpoint landing a fraction late is invisible in the
    final video per the doc's own reasoning; a missing checkpoint would break the render step,
    which expects one per beat). Also added a safety-net pass for the pathological case of a
    beat that never matches at all (transcript ends early) — same reasoning.
  - **Unit-tested per the doc's explicit instruction to verify this in isolation before it ever
    touches a real recording** — "cheap to test in isolation, expensive to debug live." Used
    Node's built-in test runner (`node --import tsx --test`, zero new dependencies) rather than
    one combined mega-transcript: a genuinely dropped word can cascade into skipping several
    subsequent *real* matches while the stall counter runs out, which makes a single
    stutter+drop+filler-in-one scenario genuinely hard to hand-verify correctly. Split into 5
    focused cases instead, each hand-traced before running: stutter recovery, a dropped
    non-boundary word (stall-skip, verified via a small test-only `stallThreshold=3` rather than
    needing an 18-word-long fake transcript), a dropped word that *is* a boundary (exercises the
    fallback-checkpoint judgment call above), scattered filler words with no stall needed, and
    loose case/punctuation matching. All 5 pass (`npm test` in `backend/`).
  - Caught a real `tsc` error `tsx`'s on-the-fly transpilation didn't catch (types aren't
    checked, only stripped) — TS can't narrow `array[i].optionalProp` across two separate reads
    of the same index; fixed by capturing `scriptWords[i]` into a local `const` once per loop
    iteration. Good reminder that `npm test` passing isn't the same guarantee as `npm run build`
    passing in this setup.
  - **Not yet wired to anything real** — no Transcribe integration, no recording UI. Per
    `docs/TASK_SPLIT.md` that's the correct order (build+prove this in isolation first); those
    are still open for whenever the recording path gets picked up.

- **Teleprompter recording UI** (`frontend/src/components/TeleprompterRecorder.tsx`) — the
  headline feature per CLAUDE.md #1/#2, so placed above the Kajal/fallback panels in the UI
  rather than below, even though it was built after them. Scene-by-scene per CLAUDE.md #2 (not
  one long take): shows the current scene's full narration as teleprompter text, `getUserMedia`
  for webcam+mic, `MediaRecorder` to capture, a review step (playback + re-record) before
  confirming, then upload.
  - **Real architectural point, not just an implementation detail:** recordings upload directly
    from the browser to S3 via a presigned PUT URL (new `POST /recording/upload-url`), never
    through our own API. A multi-minute scene at real webcam quality can easily be tens of MB —
    comfortably over API Gateway/Lambda's ~6-10MB payload ceiling. Same presigned-URL pattern
    already used for narration/render, applied to uploads instead of downloads this time.
  - **Verified with an actual real recording in a real browser, not simulated** — drove the full
    flow through Claude in Chrome: generated a script, locked it, enabled the camera (confirmed
    via `navigator.mediaDevices.enumerateDevices()` that this session runs against the user's
    real physical hardware, not a headless/CI stub — real device labels like "Integrated Webcam"
    only resolve that way), recorded an actual scene, and hit a real bug: "Confirm & upload"
    failed with "Failed to fetch." Root cause: the S3 CORS config added to `template.yaml`
    earlier this session (needed for the browser to PUT cross-origin) had never actually been
    deployed — `sam deploy`'d it, retried, upload succeeded. Downloaded the result from S3 and
    verified with `ffprobe`: a genuine 640x480 WebM, ~25s, real audio+video streams — pulled one
    frame to visually confirm it wasn't corrupted. **Deleted the test recording from S3 and all
    local copies immediately after verifying** — it was real footage of the user captured
    incidentally through testing, not something to leave sitting around.
  - `POST /api/recording/upload-url` and its Lambda are deployed and confirmed working against
    the real stack (not just local dev).
  - **Not yet tested: continuing across multiple scenes in one live session** (only scene 1 of 5
    was actually recorded+uploaded in the live test; the "next scene" advance logic reviewed by
    reading the code but not re-verified live — low risk, it's just resetting local state and
    reusing the same already-open camera stream, but flagging the difference between "read and
    reasoned about" and "actually watched happen" honestly).
  - Tab-picker (`getDisplayMedia`) for UI-demo scenes not attempted — explicitly a good-to-have
    per `docs/FEATURES.md`, and `docs/SCOPE_PLAN.md` phrases it as conditional ("if attempting
    that feature"). Correct to skip given must-haves remain (Transcribe integration, wiring sync
    to a real recording) — see Sunday's plan.

- **Transcribe integration** (`backend/src/lib/transcribe/`): `StartTranscriptionJob` with
  `IdentifyMultipleLanguages` + `LanguageOptions: [hi-IN, en-IN]` (code-switched speech, same
  reasoning as Kajal's voice choice, CLAUDE.md #5), output routed to our own S3 key via
  `OutputBucketName`/`OutputKey` rather than Transcribe's default location, parsed into
  `TranscriptWord[]` (`parse.ts` — filters to `type: "pronunciation"` items, converts
  seconds-as-strings to `start_ms`/`end_ms`). New `POST /transcribe` +
  `GET /transcribe/:scriptId/:sceneId/status`, wired into `TeleprompterRecorder.tsx` — fires
  automatically right after a scene's recording uploads.
  - **Verified live, mechanically**: recorded a real (silent — no actual speech, just room
    ambience) scene through the browser, watched it auto-trigger transcription, confirmed via
    the deployed Lambda + real `aws transcribe get-transcription-job` that the job completed and
    the frontend correctly showed "0 word(s) recognized" without crashing on empty output.
  - **Verified against real speech content — and this is the important part**: generated known
    Hinglish audio via Polly ("Toh yahan pe dekho, humne ek async function banaya hai jo API se
    data fetch karta hai.") and ran it through our actual `startTranscription`/
    `getTranscriptionStatus` code (not just raw CLI). Word-level timestamps were accurate and
    the transcription itself was excellent — but it came back entirely in **Devanagari script**
    ("तो यहाँ पे देखो हमने एक एसिंक फंक्शन..."), not the Latin-script Hinglish locked scripts are
    written in. This is a real discovery, not an assumption: the two-pointer sync algorithm's
    text matching cannot work across scripts as-is.
  - **Fix implemented (user decided: add transliteration, not chase a Transcribe output-format
    setting or accept the limitation unfixed):** `backend/src/lib/sync/transliterate.ts` using
    `@indic-transliteration/sanscript` (ITRANS scheme, `syncope: true` for Hindi-style schwa
    deletion, tuned `preferred_alternates` for casual Hinglish spelling conventions).
    `transliterateTranscript()` applied once per scene before `syncScene()` ever sees the words,
    keeping the two-pointer algorithm itself script-agnostic. `npm audit` flagged a high-severity
    transitive dep (`toml`, via `@indic-transliteration/common_maps`) — verified before accepting
    it: `toml` parses that package's *bundled* scheme-definition files at the package's own
    *build/publish* time only; grepped the actual runtime file we `import` (`sanscript.js`,
    10k lines) and confirmed zero references to `toml` anywhere in it — not reachable through
    anything our code calls, so the vulnerability isn't actually exploitable via our usage.
  - **Also fixed while testing this**: `wordsMatch()`'s fuzzy tolerance was a fixed "1 edit,
    words ≤4 chars only" — too narrow for real transliteration noise, where longer words like
    "yahaan" (transliterated) vs. "yahan" (script) or "karataa" vs. "karta" commonly differ by
    1-2 edits. Replaced with a proportional threshold (`max(1, floor(length * 0.34))`) — fixes
    all the pure-Hindi transliteration mismatches found, verified not to introduce false
    positives against the loanword cases below (their edit distances are far larger). All
    existing sync tests still pass unchanged.
  - **Real, deeper problem found that transliteration + better matching does NOT fix:**
    consecutive English CS/programming loanwords ("async function") get phonetically respelled
    in Devanagari as a unit ("एसिंक फंक्शन" → "esimka phamkshana") — nowhere close to the
    original English spelling even after transliteration (edit distance far exceeds any
    reasonable fuzzy threshold, correctly so — a looser threshold here would risk false-matching
    unrelated words instead). Added `backend/src/lib/sync/real-data.test.ts` using the exact
    real Transcribe output captured this session as a fixture, proving the failure mode
    precisely: once the script pointer sticks on "async", the transcript pointer advances
    looking for it and **consumes "function"'s real transcript position along the way** — by
    the time the script pointer reaches "function", its actual timestamp is already gone. In
    the test scene, this made a beat's checkpoint land at the very end of the scene (a ~1.9s
    miss) instead of its real position — not "a fraction of a second late" (which
    `docs/SYNC_ALGORITHM.md` accepts as invisible) but a visibly broken cut. This is a
    structural property of the two-pointer design when it hits *consecutive* unmatchable words,
    not something a stall-threshold value alone resolves (confirmed: lowering the threshold to 4
    still didn't recover the correct timestamp, for exactly this reason).
  - **Tried Transcribe Custom Vocabulary next (user's choice, over testing with real human
    speech or accepting the limitation) — result: no effect, root cause identified, not fixed by
    this approach.** Created `vaani-tech-terms` (en-IN, common CS/programming terms:
    function, async, API, component, React, TypeScript, etc.), wired via `LanguageIdSettings`
    on `StartTranscriptionJob` (confirmed via `aws transcribe start-transcription-job help` that
    this combination with `IdentifyMultipleLanguages` is actually supported before writing any
    code). Re-ran the *identical* known-audio test with the vocabulary active: **output was
    byte-for-byte identical** to the run without it — same words, same millisecond timestamps.
    Working theory: Transcribe's multi-language identification appears to classify a whole
    single-sentence utterance as one dominant language (here, hi-IN, since Hindi function words
    outnumber the English loanwords) rather than switching per-word, so an en-IN-attached
    vocabulary never actually gets consulted for any word in a segment classified as Hindi. The
    vocabulary and the `TRANSCRIBE_VOCABULARY_NAME` env-var wiring are left in place (harmless,
    opt-in, unset by default) in case it proves useful for different content shapes, but this
    specific fix did not work and stopped here rather than continuing to guess at variations.
  - **Not yet tried: real human speech instead of Polly TTS.** This whole loanword-cascade
    problem was found using Polly-synthesized audio. A real bilingual speaker's natural
    code-switch pronunciation of "async"/"API"/"function" may transcribe differently (better or
    worse — genuinely unknown) than Kajal's TTS rendering of the same words. This is the
    cheapest remaining way to learn more, and costs nothing extra beyond the recording Sunday's
    plan already requires — worth checking specifically when the first real scene is recorded
    and transcribed, before deciding whether this needs more engineering effort or should just
    be accepted as a known limitation given the deadline.
  - **Decision needed before "wire sync to a real recording" (Sunday morning):** current state
    is transliteration + improved matching (solid wins, keep), custom vocabulary (built, wired,
    unproven for this pattern), and an open question on how much the loanword-cascade issue
    actually matters once real human speech is in the loop.

## Sunday, Sept 20 (early) — real-human-speech test, answered

- **Tested with the user's actual voice, not Polly** — locked a scene with the identical known
  sentence ("Toh yahan pe dekho, humne ek async function banaya hai jo API se data fetch karta
  hai."), recorded it live through the real teleprompter UI (camera/mic, MediaRecorder, direct S3
  upload, auto-triggered Transcribe), pulled the real completed job result via the deployed API.
  **Result: the cascade problem is not better with real speech — if anything it's worse.** Real
  Transcribe output: "तो यहाँ पर देखो हमने एक ट्रेसिंग फंक्शन बनाया है जो एपीआई से डाटा सर्च करता
  है" — "async" came back as "ट्रेसिंग" ("tracing", transliterates to "Tresimga") and "fetch" came
  back as "सर्च" ("search"). These aren't phonetic mangles of the intended word like Polly's
  "एसिंक"/"esimka" was — Transcribe heard genuinely different real words, not a garbled attempt at
  the right one. Ran the real transliterated output through the actual `syncScene()` (not
  hand-simulated): the script pointer sticks on "async", the transcript pointer races past both
  "function"'s and "fetch"'s real positions while waiting it out, and the transcript ends before
  the 18-word stall threshold is ever reached — beat-2's checkpoint falls all the way to the
  end-of-scene safety net (11920ms) instead of its real position (10279ms, where "jo" actually
  starts), a ~1.64s miss, not "a fraction late."
  - **Conclusion: this needs the safety-net fallback fixed, not a chase for a better matching
    threshold or vocabulary trick — those are already proven not to help this failure mode.**
    Cheapest real fix given the deadline: when multiple beats end up uncovered at the end of a
    scene, distribute their fallback checkpoints proportionally across the remaining transcript
    time (weighted by each beat's word count) instead of collapsing all of them onto the exact
    same final timestamp — turns "several beats flash simultaneously at the very end" into "beats
    land at reasonable, spread-out times," which is a real, shippable improvement without touching
    the core two-pointer logic or the deadline-risky idea of a bigger rework.
  - Test artifacts (recording, transcript, locked script) deleted from S3 immediately after
    extracting the transcript JSON needed for this analysis — same privacy handling as the
    Saturday recording-UI test.
  - Also noted while driving this test: the Claude-in-Chrome browser automation tooling used for
    verification hit a genuine, repeated `Page.captureScreenshot` CDP failure this session (not
    the page itself — `get_page_text`/`read_network_requests`/`javascript_tool` all worked fine
    throughout). Worked around by avoiding screenshots entirely for this test and driving via
    `find`/`read_page`/direct DOM `javascript_tool` calls instead. Separately, `get_page_text`
    against the script-review page turns out very token-expensive: `VisualPreview.tsx` renders
    each `code_highlight` beat's **entire source file** into the DOM (confirmed in PROGRESS.md's
    Saturday notes as an intentional scroll-into-view design), so a full-page text extraction
    pulls every beat's whole file, repeated per beat — fine for the app itself, worth knowing if
    debugging this page via any text-dump tool again.

## Sunday, Sept 20 — STT provider switch (AWS Transcribe → Whisper/Groq), cascade problem solved

- **User's call, and it worked**: given the real-speech test above proved the cascade problem was
  fundamental to AWS Transcribe (not a Polly artifact), the user asked to switch the sync
  pipeline's STT to Whisper — via the Groq API for now (`whisper-large-v3`), with a note that
  production should eventually self-host Whisper on AWS instead. This is a genuine architecture
  change, not in the original docs, made explicitly by the user with reasoning (Whisper's
  code-switching handling is well known to be stronger than AWS Transcribe's), not something this
  session decided on its own.
  - `backend/src/lib/transcribe/` restructured to match the existing `llm/` provider-switch
    pattern: old AWS implementation moved to `aws.ts` unchanged, new `groq.ts` added, `index.ts`
    is now a thin `STT_PROVIDER` switch (defaults to `"groq"`, `"aws"` kept as a fallback/
    comparison path). Groq's transcription API is a single synchronous call (no job polling like
    AWS) — `groq.ts` just does the whole call inline and writes the completed result straight to
    the same S3 key AWS Transcribe would have used, so `getTranscriptionStatus()` and the
    frontend's existing poll loop needed zero changes. `GroqApiKey` added to `template.yaml`
    (`NoEcho`, same pattern as `GeminiApiKey`) and wired to `TranscribeFunction`'s environment;
    `TranscribeStatusFunction` gets `STT_PROVIDER` only (its Groq path just reads S3, no API key
    needed). `.env.example` updated. `groq-sdk` added as a backend dependency — the only new
    `npm audit` finding it could have introduced was checked and is unrelated (same pre-existing
    `toml`-via-`sanscript` false positive already documented above).
  - **Verified against real human speech, not assumed**: restarted the local backend so the new
    env vars took effect, then re-ran the same kind of test as the AWS/real-speech test above —
    this time the Claude-in-Chrome extension itself dropped mid-session (`tabs_context_mcp`
    stopped responding, then "Selected Chrome extension disconnected" — a step beyond the earlier
    per-tab screenshot flakiness), so the user drove the actual recording through their own
    browser instead of this session automating it. Pulled the resulting job's real output
    straight from S3/the backend API once uploaded.
  - **Result: decisively better.** Real Whisper output rendered English CS/programming loanwords
    as literal English — `"function"`, `"API"`, `"data"`, `"fetch"` all came back exactly as
    spelled, not phonetically respelled into unrelated Devanagari the way AWS Transcribe did with
    "async" → "ट्रेसिंग"/"tracing". This is the actual mechanism difference: Whisper handles
    code-switching token-by-token; AWS Transcribe's `IdentifyMultipleLanguages` classifies whole
    segments into one language, which is what caused the original cascade failure no amount of
    vocabulary/threshold tuning could fix (see Saturday's notes).
  - **Found and fixed a real bug this surfaced, invisible until now**: `transliterateTranscript()`
    was calling `Sanscript.t()` on every word regardless of script, on the documented (but never
    actually verified) assumption that it safely no-ops on already-Latin text. False — confirmed
    directly against the library: `"API"` came back as `"aaPii"`, because ITRANS treats capital
    `A`/`I` as long-vowel codes and this project's own `preferred_alternates` table remaps them.
    This bug existed the whole time transliteration has been in the pipeline but was silent under
    AWS Transcribe, which never produced clean Latin acronyms in the first place — Whisper's much
    better output is what exposed our own post-processing corrupting it. Fixed in
    `backend/src/lib/sync/transliterate.ts`: `transliterateTranscript()` now only runs a word
    through Sanscript if it actually contains a Devanagari code point (`/[ऀ-ॿ]/`);
    anything already Latin passes through completely untouched.
  - **Found and fixed a second real gap**: even after that fix, the sync algorithm still missed
    beat-2's checkpoint on the real test data. Root cause, confirmed directly against the
    transliteration library (not assumed): `syncope: true` does not reliably strip the trailing
    schwa on short words — `"हम"` ("hum", 2 letters) transliterates to `"hama"`, not `"ham"`,
    landing 2 edits from the script's spelling on a 4-character word. The existing proportional
    fuzzy-match threshold (`max(1, floor(length * 0.34))`) only allowed 1 edit for words this
    short. Raised `MIN_EDIT_DISTANCE_ALLOWANCE` from 1 to 2 in `backend/src/lib/sync/matches.ts`
    — full existing test suite (6 tests, including the AWS/Polly real-data fixture) still passes
    unchanged with the wider floor, so this didn't introduce the false-positive risk the original
    tight threshold was deliberately guarding against.
  - **With both fixes, the real Whisper transcript syncs exactly** — added
    `backend/src/lib/sync/whisper-real-data.test.ts` as a permanent regression test (same pattern
    as the AWS `real-data.test.ts`) using the real captured Whisper output: beat-2's checkpoint
    lands at 20660ms, precisely `"jo"`'s real start time — not a fallback, not "close enough," an
    exact match. `npm test` (7/7) and `npm run build` both clean after these changes.
  - Test recording/transcript/script deleted from S3 immediately after extracting what was needed
    for the regression test, same privacy handling as every other real-footage test this session.
  - **Not yet done**: this is proven at the unit/algorithm level against one real recording, not
    yet re-verified end-to-end through the actual UI with the fixes in place (the extension
    disconnect cut that short). Worth a quick live re-check if time allows before submission, but
    the algorithmic proof (real captured data → real code path → exact checkpoint) is strong
    evidence on its own given the deadline.

## Sunday, Sept 20 — real-recording render path (didn't exist at all until now)

- **Real gap found: the render stage only ever supported the Polly fallback.** There was no code
  anywhere that turned a real recorded scene + its sync checkpoints into a final video — the
  actual headline feature (CLAUDE.md #1) had no way to produce a submittable video at all. This
  matches Sunday's still-open tasks ("sync wired to a real recording," "render stage... full
  pipeline"). Confirmed with the user before building it (a real architecture addition, not a
  tweak) — agreed scope: must-have baseline only, full-screen visual per beat cut at checkpoints
  with the real recorded audio, no picture-in-picture face overlay (that's explicitly cosmetic per
  `docs/FEATURES.md`).
  - **New pieces**: `shared` gets `SyncResultSchema`/`SyncRequestSchema` + `syncResultKey()`.
    Backend gets `src/lib/sync/computeSync.ts` (loads the locked script, requires every scene's
    transcription already `"completed"`, runs `transliterateTranscript` + `syncScene` per scene,
    persists the result to S3 — throws a clear error, doesn't persist anything, if any scene isn't
    ready) behind a new `POST /sync` handler/route/Lambda (`SyncFunction` in `template.yaml`,
    mirrors the existing `TranscribeStatusFunction`'s permissions). Render gets
    `render/src/realRender.ts` (`renderSceneFromRecording`) — downloads the scene's real recorded
    webm, gets its true duration via a new `ffprobe`-based `getMediaDurationMs()` in `ffmpeg.ts`,
    computes each beat's on-screen duration as the gap between consecutive checkpoints (last beat
    runs to the recording's real end), screenshots each beat's visual exactly like the fallback
    path already does, and muxes the image sequence with the *real recording's audio track*
    (`-map 0:v:0 -map 1:a:0`, not a separate synthesized file). `render/src/index.ts`'s `main()`
    now checks for a completed `SyncResult` in S3 first and uses the real path if present, falling
    back to the original Polly path (renamed `renderSceneFromNarration` for clarity) exactly as
    before if not — real-recording is primary, Polly is the safety net, per CLAUDE.md #1, decided
    by what's actually in S3 rather than a flag anyone has to remember to set.
  - Frontend: `TeleprompterRecorder.tsx`'s old "not built yet" placeholder message (literally
    hardcoded) replaced with a real "Sync recordings" button once every scene is uploaded, calling
    the new `api.syncRecordings()`; the result is lifted to `App.tsx` state. `RenderPanel.tsx`
    now unlocks from *either* a narration result or a sync result (previously gated on narration
    only, which meant there was no UI path to render a real recording even after this backend/
    render work existed) and labels the button "Render video" vs. "Render fallback video"
    depending on which path is actually available.
  - **A cheap, defense-in-depth robustness fix done alongside this**: the sync algorithm's
    safety-net fallback (for beats the two-pointer walk never reaches before the transcript runs
    out) used to collapse *every* uncovered beat onto the exact same final timestamp. Changed to
    spread them proportionally by word count across the time between the last real checkpoint and
    the transcript's end (`backend/src/lib/sync/index.ts`) — with exactly one uncovered beat (the
    common case, and the AWS/Whisper real-data test fixtures) this is provably identical to the
    old behavior; with multiple, it turns "several beats flash simultaneously at the very end"
    into "beats land at reasonable, spread-out times." New regression test added
    (`index.test.ts`, 8th test) with hand-verified round numbers. Full suite still 8/8.
  - **Verified for real, not just by code review**: no real multi-scene recording was re-done live
    for this (would have cost significant time for marginal extra proof beyond what's below) —
    instead, built a synthetic-but-real end-to-end test: generated an actual 6s test video with
    ffmpeg (`testsrc` + `sine` tone standing in for a webcam recording), a 3-beat locked script,
    and a hand-built `SyncResult` with checkpoints at 0/2000/4000ms, uploaded all three to the real
    S3 bucket, and ran `render/src/index.ts`'s actual `main()` directly (same code the Fargate
    container runs, just invoked locally with `tsx` instead of via Docker/ECS — Playwright
    Chromium and ffmpeg/ffprobe were already available locally from Saturday's validation work).
    **This caught a real, previously-invisible bug**: the render succeeded and reported `"done"`
    with a `final.mp4` whose container metadata claimed the correct 6.02s duration — but
    re-decoding the actual output (`ffmpeg -vf fps=1 ...` frame-by-frame, then confirmed harder
    with `-vsync cfr` resampling) showed the video content actually stopped being decodable around
    3-4 seconds, well before the audio ended. Root cause: `-vsync vfr` on a concat of sparse still
    images (one frame every ~2s, zero motion) produces a stream that real decoders don't reliably
    hold to its declared end, even though the container-level duration (matched to the audio via
    `-shortest`) looks correct at a glance — a bug that would have been very easy to ship
    undetected, since `ffprobe`'s format-level duration check (the exact check Saturday's Polly
    path verification relied on) doesn't catch it, and the earlier Polly-path manual playback
    check only confirmed sound worked, not that every visual actually held through to the end.
    **This exact same bug was already present in the original Polly fallback path** (identical
    `-vsync vfr` usage) — fixed in both places, not just the new code: switched to
    `-vsync cfr -r 5` (a new `OUTPUT_FPS` constant in `ffmpeg.ts`), which explicitly duplicates
    each still image into real frames spanning its full duration. Re-ran the same synthetic
    end-to-end test after the fix and confirmed by re-decoding: all 6 seconds present, correct
    beat colors at exactly the right second (0-1s beat-1, 2-3s beat-2, 4-5s beat-3). 5fps is
    trivially cheap to encode for static screenshots (libx264 skip-codes near-identical duplicate
    frames) and plenty of granularity given the new 0.8s minimum-hold floor below.
  - **A second brag-inspired polish item, scoped narrowly to the new real-recording path only**:
    added a minimum on-screen hold per beat (`MIN_BEAT_HOLD_SECONDS = 0.8` in `realRender.ts`,
    per /brag's pacing rule — see the design-inspiration research earlier this session) so a
    checkpoint gap that's pathologically small (e.g. from a stall-skip firing close together)
    doesn't flash a visual for an imperceptible instant; `-shortest` still caps the whole scene to
    the real audio length, so inflating one beat only ever eats into later beats' slack, never
    desyncs from the real voice. Deliberately *not* applied to the already-proven Polly fallback
    path (its durations come from real synthesized audio, essentially never near-zero — no reason
    to add risk to a working path for near-zero benefit there).
  - Test S3 artifacts (recording, sync result, locked script, render output) and local temp files
    deleted immediately after verifying — synthetic data this time (no real user footage involved,
    since this test used a generated `testsrc`/`sine` clip, not a real webcam recording).
  - `npm run build` clean across `shared`/`backend`/`frontend`/`render`; `npm test` in `backend`
    still 8/8 after all of the above.
  - **/brag research → shared slide design system.** Read `latent-spaces/brag`'s actual
    `skills/brag/references/step-2-plan.md` / `step-3-compose.md` (not just its README). Its
    rendering engine (Hyperframes, external + proprietary) isn't adoptable, but its planning rules
    are portable. Applied: (1) "Visual Identity" — one exact bg/text/accent palette + fonts applied
    consistently, instead of per-scene improvisation. Vaani's slide/graph beats previously got
    zero design guidance (each beat's HTML independently LLM-styled, some white, some dark) while
    code_highlight beats were fixed one-dark-pro. Now `render/src/visuals.ts` has a shared
    `DESIGN_SYSTEM_STYLE` (one-dark-pro-matched tokens, type scale, `.slide/.card/.accent/.mono`
    classes) wrapping every slide/graph beat in a `.slide` container; the script-gen prompt
    (`scriptGen.ts`) now tells the model to write inner content only and use those classes, plus
    /brag's "real specifics from this project, never generic filler" rule. (2) The frontend
    review preview (`VisualPreview.tsx`) previously showed LLM HTML on plain white — it now uses
    the same tokens (manually duplicated CSS; frontend/render are separate workspaces) so review
    matches the final render. Verified by rendering a sample slide through the real
    `beatVisualHtml` + Playwright and looking at the PNG. (3) Deliberately did NOT copy /brag's
    word-count pacing rule (0.3s/word): it would inflate beats for fast speakers and drift later
    beats off the real voice — documented in `realRender.ts` so it isn't "fixed" later.
    System font stack, no web font, so a headless Fargate render can't degrade on font loading.
  - **UI redesign (impeccable + frontend-design skills, shadcn-heavy).** User chose: dark,
    editor-like, calm; a focused stepper, one stage open at a time; "make it like a real product."
    Replaced the single long page with an app shell: sticky header, left rail `Stepper` (Repo,
    Script, Record, Sync, Video; horizontal on mobile; locked steps explain themselves in a
    tooltip), and one stage at a time. Theme is now one cool blue-slate token family in
    `index.css` matching the one-dark look of the rendered videos (blue = actions, amber =
    highlight), Geist + Geist Mono, themed selection/caret/scrollbar/focus, reduced-motion
    respected. New shadcn components added: accordion, tabs, progress, tooltip, scroll-area,
    sonner, spinner, kbd (all the earlier shadcn CLI quirks recurred: files land in `./@/` and
    import `cn` from `"cn"`; moved them to `src/` and pointed them at `@/lib/utils`, which
    re-exports it). Stage rewrites: `RepoForm` (phase-aware progress while ingesting/drafting),
    `ScriptReview` (scene accordion, narration beside its visual preview, sticky lock bar),
    `TeleprompterRecorder` (big prompter text, camera frame, progress; sync moved out of it),
    new `SyncPanel` (per-scene transcription status polled every 3s, then sync; Polly fallback
    shown as a clearly secondary card), `RenderPanel` (progress, player, download). The recorder
    stays mounted while other steps are open so leaving mid-session doesn't drop the camera stream
    or the uploaded-scenes list. Verified with Playwright screenshots (mocked API, fake camera) at
    desktop and mobile, one batched round plus one fix round, then the impeccable detector once
    (clean). **Real bugs caught by that round**: the empty live `<video>` sat over the "Enable
    camera" button and swallowed clicks (would have blocked recording entirely), and on mobile the
    stepper stretched the grid column so the page was ~700px wide in a 390px viewport. Both fixed.
    `PRODUCT.md` added for impeccable. Not done: no DESIGN.md (impeccable `document`), and the
    whole flow hasn't been driven with the real backend/webcam after the redesign (mocked only).
  - **Landing page + dashboard + real routes.** The user said it still didn't look like a real
    product. Researched cap.so, screen.studio and resend.com for structure: a real product opens
    on the product doing its actual job, earns credibility through specifics (real specs, honest
    FAQ), and has a dashboard where work persists. No invented testimonials, customer logos or
    pricing (PRODUCT.md forbids it; FAQ says "no pricing yet"). Built with react-router and the
    `motion` library: `/` landing, `/app` dashboard, `/app/studio/:id?` studio (one route for both
    new and reopened projects so locking a new script, which puts the id in the URL, doesn't
    remount), and a 404. Landing (`pages/Landing.tsx`, direction contract in its header comment):
    hero with a live `HeroDemo` (a spoken line advances word by word and the visual cuts on the
    exact word, using the real vercel/ms take and its real beat boundaries), an auto-advancing
    five-step `PipelineTabs`, a `SyncExplainer` that animates the actual two-pointer match on the
    real transcript with the real cut times (16.16s / 18.26s / 20.66s, fuzzy matches marked),
    Hinglish showcase with English terms highlighted, an honest "under the hood" list, FAQ
    accordion, CTA, footer. Motion is restrained: one headline reveal plus the two demos, all
    paused off-screen (`useInView`) and static under `prefers-reduced-motion`. The claim that AWS
    Transcribe heard "async function" as "tracing function" is from our own real-speech test.
    Dashboard: shadcn `Sidebar` shell, projects table with status, mini progress, recorded count,
    per-stage action ("Start recording", "Watch video"), filter tabs, empty and loading states,
    polls while anything renders. **Backend**: `GET /api/projects` and `GET /api/projects/:id`
    (`backend/src/lib/projects.ts`) derive a project's stage purely from which S3 artifacts exist
    (recordings, `sync/`, `renders/status.json`) so no extra state is stored; three prefix
    listings, not one request per project. Reopening a project hydrates the studio (locked
    script, uploaded scenes, sync flag, render status) and opens on the right step; the recorder
    resumes at the first unrecorded scene. SAM template got the two new GET Lambdas and `GET`
    in the API's CORS methods (it only allowed POST before, which would have broken the
    existing GET status calls from a separately hosted frontend). Verified against the real dev
    servers and real bucket (5 real projects listed, a finished project reopened to its video).
    **Bugs caught by the inspection round**: the pipeline tab list was clipped to one item by the
    shadcn tabs' fixed height, a finished Polly-voice project showed "Nothing to render yet" when
    reopened, and Base UI warned that link-rendered Buttons weren't native buttons (Button now
    passes `nativeButton={!render}`). **Known limits, stated plainly**: there is no auth, so the
    dashboard lists every project in the bucket (fine for a single-user hackathon deploy, not for
    production); the frontend isn't hosted anywhere yet, and as a SPA it needs a
    fallback-to-index.html rule wherever it goes (CloudFront/S3 error page mapping); the SAM
    changes are not deployed; no DESIGN.md.
  - **Video styling + animation polish (render stage).** Both render paths (real recording and
    Polly fallback) now build each beat as an animated clip instead of a static screenshot with a
    hard cut. `visuals.ts`: deeper editor-dark background (radial vignette plus a faint masked
    blueprint grid), a persistent bottom chrome bar (Vaani mark, "scene n/N" and title, one
    progress segment per beat), slide content staggered in with a blur-rise, cards pop in, and
    code beats are a rounded window with a file-path/line-range title bar that dims context lines
    and sweeps the highlight band in. Code lines are tagged by a Shiki per-line transformer
    (`hl`/`ctx`) rather than a range decoration, because the class has to be on the line element
    for the dimming to work. `screenshot.ts` `captureBeatFrames` pauses every CSS animation and
    steps its clock (`document.getAnimations()`), capturing 1.1s at 30fps as real frames, so the
    animation is exact and independent of machine speed. New `beatClip.ts`: encodes those frames
    plus the settled last frame held with `tpad` clone into a genuine constant-30fps clip (the
    same reason as the earlier vfr fix: never sparse timestamps), `frameCounts()` rounds cumulative
    beat boundaries so cuts never drift from the audio, `assembleScene()` concats clips (video
    stream-copied) and lays the scene audio underneath. Verified on a real render through
    `main()` with a synthetic recording: 210 frames at exactly 30fps, 7.01s, ~15s wall time;
    extracted frames show the staggered entrance, the dim/sweep on code, and the beat progress.
    **Bug caught by looking at the frames**: code lines were double-spaced with gaps in the
    highlight band (whitespace text nodes between Shiki line spans); fixed with a flex column.
    **Deployed**: rebuilt and pushed the Fargate image to ECR (`vaani-render:latest`), then ran a
    real render of an existing 5-scene project on Fargate: done in ~1m45s, 1280x720 at exactly
    30fps, 1:56, animated frames and chrome bar confirmed by extracting frames. (That old project
    predates the new slide prompt, so its slides still carry their own boxed backgrounds; new
    scripts follow the design contract.) The frontend's slide preview still uses the earlier flat style (no vignette or
    animation), which is fine for review but no longer pixel-identical to the video.
  - **Automated end-to-end run through the real UI, and three real bugs it found.** Built a
    harness (Playwright + Chromium fake mic playing Amazon Polly speech of a controlled 3-beat
    script via `--use-file-for-fake-audio-capture`), then drove the actual app: reopen a saved
    project, record, upload to S3, Groq Whisper transcription, sync, Fargate render. Polly's
    per-beat durations gave ground truth for the cuts. The chain ran with no errors in ~100s.
    (1) **Whisper wrote English terms in Devanagari** on that speech ("फंक्शन", "स्ट्रिंग"),
    which can never match the script's Latin spellings, so two of three checkpoints were 1-5s
    late. Fixed in `backend/src/lib/transcribe/groq.ts` by passing the scene's own script text as
    Whisper's `prompt` and forcing `language: "en"` (overridable via `WHISPER_LANGUAGE`): output is
    now pure Latin Hinglish identical to the script's spelling, no Devanagari at all (also what the
    user asked for: everything in English letters). Re-transcribing the same recording put every
    checkpoint within ~70ms of Polly's ground truth. Tradeoff to know: with a prompt, Whisper leans
    toward the script's words, so it is a little less able to reveal that the speaker said
    something different (sync only needs timing, so this is acceptable); with no script to prompt
    with, `language: "en"` on Hindi speech could translate rather than romanize (only reachable for
    loose recordings, not the app's flow). The Devanagari transliteration step stays as a harmless
    fallback for `WHISPER_LANGUAGE=hi`. (2) **Cuts landed ~1.5s early**: beat 1's duration was
    measured from its first spoken word instead of from the start of the recording, so the
    silence between pressing record and speaking was dropped from the video while the audio kept
    it. Fixed in `render/src/realRender.ts` (first beat starts at 0); verified on a fresh Fargate
    render by extracting frames on both sides of each cut. (3) My own first comparison looked like
    a 1-5s error partly because Whisper reports the first word's start as 0 after leading
    silence; the true timeline was used for the final check. Added
    `backend/src/lib/sync/e2e-real-data.test.ts` (real transcript, checkpoints within 150ms of
    truth). Backend suite 9/9. Fargate image rebuilt and pushed again with the fix. Test project's
    S3 data deleted afterward.
  - **From-scratch end-to-end test on a small repo, and two more sync bugs it found.** Ran the
    whole product through the real UI on a repo it had never seen (`sindresorhus/p-map`): draft a
    script with real Gemini (asked for 3 short scenes; got 3 scenes, 6 beats), lock, then record
    every scene (a fresh browser per scene with a fake mic playing that scene's Polly speech, which
    also exercises reopening a saved project), transcribe with Whisper, sync, render on Fargate.
    3m22s wall time, 43s video. Scenes 1 and 3 landed within 116ms of Polly ground truth, but
    scene 2 was 5.5s off. Two causes, both in the sync code: (1) Whisper heard the opening word
    "Ye" as "This", the script pointer stuck on it, and it later false-matched an unrelated "hi"
    because my earlier widening of the fuzzy tolerance to 2 edits let "ye" match "hi" (2 edits on
    2 letters is a different word) — now words with 2 or fewer letters get at most 1 edit
    (`matches.ts`); (2) the algorithm could only recover from one misheard or unsaid word by waiting
    out the 18-word stall threshold — added a look-ahead (`classifyMismatch` in `sync/index.ts`):
    if the next two script words match the next two transcript words it's a substitution (consume
    the transcript word, use its time for a beat opener), and if they match starting at the
    current transcript word it's a drop (don't consume it). One existing test's expectation moved
    from 1000ms to 800ms for a legitimate reason (the filler "arre" now stands in for the unsaid
    word), documented in the test. Added two tests (misheard first word from this real run, and
    the two-letter false match); suite 11/11. Re-syncing the same stored recordings: worst beat
    error 444ms (Whisper starting a word early after a sentence pause), the other five within
    116ms. Also fixed a cosmetic bug seen in the render: code snippets cut from deeply nested,
    tab-indented code were pushed far to the right; snippets are now dedented and use a 2-wide tab
    stop (`visuals.ts`). Fargate image rebuilt and pushed with this. The test project stays in S3
    (visible on the dashboard) and its speech is Polly, not a person.
  - **Video formats: Vaani now makes hackathon demos and product demos, not only code
    walkthroughs.** The user's feedback: the output felt like a code explanation, but a
    hackathon-winning demo needs balance: problem, live product, diagrams, a little code, results.
    Built five formats as data in `shared/src/formats.ts` (`code_walkthrough`, `hackathon_demo`,
    `product_demo`, `architecture_overview`, `launch_teaser`): each has an outline of scenes with
    their purpose, a visual-mix rule, a tone, a length, and whether it shows the product. One
    source of truth for the picker (`RepoForm`, radio cards), the script prompt (`scriptGen.ts`
    builds it from the chosen format) and the studio. Script has a `format` field (defaults to
    `code_walkthrough` for old scripts).
    - **New visual types, as data not HTML**: `diagram` (nodes + edges, validated by zod) and
      `chart` (bar chart; `source` is required). The renderer lays out and animates them itself
      (`shared/src/visualDesign.ts`): layered left-to-right layout, wrapped labels, oriented
      arrowheads, edges drawing in, bars growing. The model returns them as JSON in the beat's
      `content` (the tool schema is capped at few properties, see the Gemini note above); it is
      validated and falls back to a plain slide if unusable, so a bad diagram can't break a script.
      **Honesty guardrail**: the prompt forbids invented metrics; charts only use numbers found in
      the README/repo or the user's notes, and show their source. On a real run the model
      correctly skipped a chart because the repo had no numbers.
    - **Product demo footage** (this fulfils CLAUDE.md #4's getDisplayMedia, previously
      "good-to-have"): a scene containing `ui_demo` beats is recorded with `getDisplayMedia` (screen
      as video) plus the mic (audio); the prompter marks demo beats ("On screen: ..."), and a
      "Pop out prompter" button opens a small window to keep beside the app being demoed.
      `renderFootageClip` cuts each demo beat's window out of the recording at its synced time
      and frames it in a window over the same dark background/bottom bar. The AI-voice fallback
      has no footage and shows a labeled placeholder. Not agent-driven: per CLAUDE.md the user
      drives the demo themselves.
    - **Shared visual code**: the design system, slide/diagram/chart/demo-frame HTML now live in
      `@vaani/shared` and both the renderer and the browser use them. The review page renders the
      same page at 1280x720 in a sandboxed iframe scaled down (`VisualPreview.tsx`), so preview
      equals video (only code beats differ: Shiki vs a JS highlighter). This retires the
      "preview no longer identical" caveat above. Slides gained a `.statement` class for hooks.
    - **Verified end to end through the real UI** on `sindresorhus/p-map` with the Hackathon demo
      format: 5 scenes, 12 beats (statement slides, 3 live-demo beats, 2 diagrams, code, close),
      recorded per scene with a fake mic (Polly) and a fake animated screen share (the app's
      own `getDisplayMedia` path, faked by overriding it with a canvas stream), synced, rendered on
      Fargate (~110s, 1:43). Extracted frames confirm the footage frame counter advancing through
      the three demo beats, the diagram, and code windows. The result stays in S3 (dashboard).
    - **Bugs the run found, all fixed** (17 backend tests now, up from 9):
      (1) `language: "en"` on Whisper, my earlier setting, is fragile: on the same audio it gave a
      hallucinated one-liner, an English *translation*, or a truncation. Now: auto-detect with the
      script as prompt, Devanagari transliterated to Latin before storing (so stored/displayed
      text is English letters, as the user asked), and a retry chain (auto+prompt, en+prompt,
      hi+prompt, en) driven by `scriptCoverage` (share of script words the transcript reproduces
      in order, under 50% means retry). A word-count check was not enough because a fluent
      translation is full length but matches nothing. `pickTranscript` returns the best if all
      fail. (2) Sync stalled on punctuation-only tokens (a "—" in the script, echoed back by
      Whisper); those are now ignored on both sides. (3) Added `phoneticKey` (long vowels, z/j,
      v/w, ph/f, trailing schwa folded) so Latin spelling variants of one Hindi word match
      ("cheez" and "chiija"). Final result: all 12 beats within 440ms of Polly ground truth
      (first beats start at 0 by design).
    - **Not done / to know**: the recorder's real `getDisplayMedia` picker was not exercised (a
      faked stream stood in; the browser-native picker and "stop sharing" bar are untested);
      formats beyond the five aren't offered; `hackathon_demo` quality depends on the user's note
      (real results only if given). Fargate image is current (footage renderer pushed).
  - **Target length, bring-your-own script, and edit-then-regenerate.** Three features the user
    asked for. (1) **Length**: choose 30 sec / 1 / 2 / 3 / 5 min (default per format).
    `shared/src/duration.ts` holds the pace (135 words/min, measured from Polly's Kajal at ~137)
    and the estimators; `scriptGen.ts` turns the target into a word budget in the prompt and, if
    the draft lands outside 75-125% of it, retries once with the count fed back and keeps the closer
    draft. Real results: 1 min target gave 147 words (~65s), 3 min gave 401 words (~178s).
    Gemini rejects the tool schema (bare INVALID_ARGUMENT) if the array limits go past 8 scenes x 5
    beats, confirmed by trying 10 x 6 — 8 x 5 = 40 beats still covers 5 minutes, so the UI stops
    there. (2) **Your own script**: paste narration into the form; the visuals are built around it.
    The prompt says to keep their wording, and `wordPreservation` measures it; if under 85% of their
    words survive it retries once, then falls back to `scenesFromText` (paragraphs become scenes,
    sentences become beats, plain slides) so the result is always exactly their script. A real run
    kept 79/79 words while adding slides, a diagram and demo beats. When a script is present the
    length control switches off (the script sets the length) and the form shows its word count and
    spoken time. (3) **Edit then regenerate**: new `POST /api/script/scene` (`generateScene`), mode
    `beat` (one beat) or `scene` (split edited scene text into beats), wording kept verbatim, same
    faithfulness check and fallback. The review page shows per-beat words/seconds and per-scene and
    total length; changing a beat's wording flags it ("Wording changed", button becomes "Update
    visual to match"); "Rewrite scene" opens a scene-level editor and "Rebuild scene" regenerates its
    beats and visuals. The teleprompter reads the same beat text, so it follows the edit. Verified
    through the real UI with real Gemini: editing beat 1 to talk about a live demo changed its visual
    from Slide to Product demo (wording kept, flag cleared); rewriting scene 2 as an architecture
    description produced one beat with a Diagram; after locking, the prompter showed the edited
    wording. New SAM function `SceneGenFunction` (not deployed); `ScriptGenFunction` timeout raised to
    120s since a length/faithfulness retry can double the call. Also fixed the backend `test`
    script: the unquoted glob got shell-expanded as soon as one test file existed at src/lib/, so
    only 4 of 21 tests ran; it is quoted now and all 21 pass.
  - **Script generation is now two-stage: plan, then one call per scene.** The user's suggestion
    (share the repo context once, give each scene its own prompt), and it fixes real problems with
    the single giant call: the Gemini nested-array cap (8 scenes x 5 beats), whole-script retries for
    a length miss, and one bad scene meaning regenerate everything. `planScript` (a short flat
    "outline" call, no nesting so no size cap) returns one entry per scene with a title, a purpose
    naming the concrete repo material to use, and a word budget rescaled to sum to the requested
    length; `writePlannedScene` writes one scene with the shared repo context plus the full outline
    (so scenes don't repeat or contradict each other) and retries that scene alone if its length is
    off (`< 65%` or `> 140%` of its own budget). A user-written script skips the model for planning
    (`planFromSourceScript` splits paragraphs, or groups sentences, into scenes, capped at 14) and each
    scene's wording is verified separately by `generateScene`. New endpoints `POST /api/script/plan`
    and `POST /api/script/write-scene` (Lambda handlers + SAM functions, not deployed); the old
    `POST /api/script` still works and runs plan plus parallel writes (3 at a time). The web app calls
    the two steps itself (`frontend/src/lib/generate.ts`), so it shows real progress ("Planning the
    scenes", "Writing scene 3 of 6"), writes 3 scenes at once, and retries a failed scene on its own.
    Real numbers on Gemini: 3 min video = 6 scenes / 407 words vs a 405 budget in 26s; 5 min video =
    10 scenes / 30 beats / 663 words vs 675 in 43s (previously a 5 minute script could barely fit
    the beat cap); in the UI a 3 min draft took 34s and showed 2:55 estimated. Every scene landed
    within ~10% of its own budget. The 8 x 5 limit noted above no longer applies to generation (the
    UI still stops at 5 min; longer is now possible). Left on Gemini; the provider abstraction
    means a GPT client could be added later. Backend suite 24/24.
  - **Not yet done**: a live, real-microphone/webcam run through this exact new path (real
    recording → real Whisper transcript → real sync → real render) hasn't happened yet — Saturday
    night's Whisper test proved the STT+sync half against real speech, and today's synthetic test
    proved the render half against real code, but the two haven't been chained together end-to-end
    with an actual human recording. Worth doing once if time allows before submission, but each
    half is now independently proven against real inputs through the real code paths, which is
    strong evidence on its own given the deadline.

## Sunday, Sept 20: after the first live camera test

- **Script language option** (English or Hinglish, picked before drafting; both in Latin letters).
  `Script.language` (default `hinglish`, so old locked scripts still load) is threaded through plan,
  write-scene, scene regenerate and the handlers. The prompt's register block comes from
  `registerLines(language)`; English has its own example lines
  (`backend/src/lib/prompts/englishExamples.ts`). Polly still uses Kajal, pinned to `en-IN` for
  English. Whisper's first attempt is forced to `en` for English scripts (auto-detect stays for
  Hinglish, where forcing `en` hallucinated); `attemptsFor()` in `groq.ts` drops the duplicate retry.
  Sync needed no change (transliteration only touches Devanagari).
- **Presenter's face in the final video.** Before this, `realRender.ts` used only the recording's
  audio (plus its video on `ui_demo` beats), so the person never appeared. Now: a round camera
  bubble, bottom-right, on every scene, taken from the narration take's own video (camera + mic).
  `render/src/faceOverlay.ts` masks a centered square crop to a circle with `geq` and overlays it
  (`fps=30` forced, since webcam webm is variable frame rate). No video track = no bubble, never an
  error.
- **Screen recording redone: one silent clip per demo step, recorded apart from the narration.**
  Recording the screen and the narration together collided with apps that use the mic (Hosty's
  voice bot), needed the app in the right state on cue, and made talking-while-clicking the norm.
  Now a scene with `ui_demo` beats shows `DemoClipsPanel` first: share the tab once, then record
  each step separately (pause/resume skips waits, retake freely, skip a step and it renders as a
  text card). Clips upload to `clips/<script>/<beat>.webm` (`clipKey`, outside `recordings/` so
  they're never mistaken for a narration take). The narration take is always camera + mic, so the
  separate face recorder from earlier today was removed. Render fits each clip to its beat:
  longer clips are sped up so the WHOLE clip fits and ends on its last frame (`clipSpeed`: squeezed into 85% of the beat, no cap, never cut, since the end is usually the result), shorter ones hold their last
  frame. Checked with real ffmpeg: a 12s clip over a 5s beat showed source time 10.2s at 4.5s
  (2.4x), a 2s clip held its last frame, both beats exactly 5.0s.
  **Breaking for old projects**: a scene recorded with the old screen-as-video method has no
  clips, so its demo beats now render as text cards (only test projects were made that way).
  The clip panel times each take itself (a browser webm reports no duration) and shows, per
  step, clip length vs the estimated narration length and what the render will do ("sped up 2.8x,
  ends on the result", or a warning above 6x to pause through the wait and re-record). Checked
  with real ffmpeg: a 12s clip over a 5s beat sped up 2.82x and was on its final frame (11.96s)
  at 4.7s. Not done: cutting or fast-forwarding a section out of an already-recorded clip (pause
  while recording is the workaround); a per-clip trim UI plus an endpoint to store the ranges.
  Not done: the bot's audio is not captured (no tab audio), so viewers see the app but don't
  hear a voice bot reply; on-screen transcript is the workaround.
- **Layout leaves room for the bubble** (`hasFace` on `BeatChrome`, `pageHtml` in
  `shared/src/visualDesign.ts`): the stage is drawn at 82% inside the space left of the bubble
  (scaling keeps diagrams and code undistorted), and the demo window moves left and shrinks to
  960x540 (`demoWindow(hasFace)`). The browser preview does not show the bubble.
- Tests: backend suite now 35 (register per language, Whisper attempt order, bubble geometry,
  clip speed and key).
- **Still to prove**: a full run through the UI with a real webcam, and the Fargate image needs a
  rebuild and push (deferred with the rest of hosting).

- **Humanised scripts.** The first drafts read like a press release: long clause-stacked sentences,
  hype words ("solves this instantly", "nightmare", "trusted worldwide"), code read as syntax
  (`ms('2 days')`), dashes and colons the speaker has to improvise. New
  `backend/src/lib/prompts/spokenStyle.ts`: spoken-style rules in the writer prompt for both
  languages (one idea per sentence, 8 to 18 words, no dashes/colons/parentheses/symbols, everyday
  words, code described not read, small numbers as words, banned hype list, no rule-of-three,
  contractions for English, simple spoken Hindi plus English only for technical terms for
  Hinglish), rewritten example lines in the same style, and `cleanNarration()` as a safety net
  (dashes, colons and markdown become commas) on narration Vaani writes. A user's own script and
  edited wording are never touched. Same repo (vercel/ms), before vs after: "Vercel's ms solves
  this instantly: it converts human strings like two days into exact milliseconds..." became "The
  ms package turns strings like two days directly into milliseconds. It converts human time into
  numbers and back again." Length still on budget (143 and 136 words for a 1 minute target).
  Backend suite 37. Not measured with real speakers; judge by reading a scene aloud.
  **Second pass: patterns from the open-source `humanizer` skill** (MIT, built on Wikipedia's
  "Signs of AI writing"; 33 patterns). It is a Claude Code skill, so it can't run inside the
  deployed backend; instead its useful patterns went into our own prompt and a checker. Added to
  `spokenStyle.ts`: "Do not sound machine-written" rules (plain is/has over serves as/boasts; no
  inflated importance, no fake-depth "-ing" tails, no "not just X but Y" or "no guessing" tags, no
  rule-of-three or false ranges, no vague authorities, no signposting or theatrical openers, no
  aphorisms or staccato drama, no upbeat closers, no filler or hedging, and its AI-vocabulary
  list), plus `machineWritingHits()`: a whole-word check over the scene's title and narration.
  A hit (or a length miss) triggers ONE retry naming the offending words, keeping the better
  draft. The skill flagged two of our own example lines as signposting ("let's walk through",
  "give me a second to break this down"), so those were rewritten. vercel/ms, 3 runs: before had
  "instantly", "under the hood" and "worldwide"; the latest en and hinglish scripts have zero hits
  and no dashes or colons. Kept ours, not the skill's: the skill is English prose editing, so
  sentence length, pronounceability and all Hinglish rules stay our own. Suite 39.

- **Wiring check after the first real test (found: stale Fargate image).** The user's test video
  had no face bubble and the demo scene showed their camera instead of the screen clip. Cause: the
  app triggered a render on Fargate, whose ECR image was last pushed Sept 19 19:11, before the
  bubble and per-step clip code existed, so it still ran the old "use the recording's video as
  demo footage" logic. Everything else was correct against the real data (recordings have video,
  both clips uploaded and ffprobe-able, beats 3 and 4 are the demo steps). Ran the new render
  code locally on that project: bubble on slide, demo and diagram frames, and the demo window
  shows the real DinoSprint screen clip. **Fix for testing**: `RENDER_MODE=local` (in
  `backend/.env`) makes `triggerRenderTask` run the worker from this checkout instead of Fargate
  (`render/trigger.ts`), so a render can never run older code than the app; ~50s for a 3 scene
  project. **Still needed before deploying**: rebuild and push the Fargate image. An attempt failed
  because the Docker daemon wasn't running (`sudo systemctl start docker`; the build itself was
  not tried, only login succeeded). Hosted mode must not set `RENDER_MODE`.

- **Hosted end to end (Sept 20, ~07:20 to 08:10 IST).** Live at
  https://10jlhtgcih.execute-api.us-east-1.amazonaws.com (site + API, one https origin, API under
  `/api`). Stack `vaani-backend` updated with every new function (sync, projects, plan,
  write-scene, scene) and a `GroqApiKey`. **CloudFront failed**: "Your account must be verified
  before you can add new CloudFront resources" (needs AWS Support; the update rolled back cleanly).
  Workaround, all on AWS: `backend/site/index.mjs` is a small Lambda that serves the built frontend
  (`npm run build:site` copies `frontend/dist` to `backend/site/dist`) behind the same HTTP API;
  API routes moved under `/api/...` to match the frontend and local server; SPA fallback for
  extension-less paths, gzip, immutable caching for fingerprinted assets, path-traversal guarded
  and tested. API throttled (50 rps, burst 100) since it is public and every call can spend
  Gemini/Groq/Polly/Fargate money. `GithubToken` parameter added (empty; unauthenticated GitHub
  allows 60 requests an hour per IP, and Lambda IPs are shared).
  **Found on the live API, fixed**: transcription took 22s for an 18s scene, too close to API
  Gateway's 30s cutoff. `/api/transcribe` now only marks the scene in progress and starts a
  background run of the same function (async invoke, no retries, 180s timeout); the app already
  polls. Stored status is in_progress / completed / failed, a dead worker's marker counts as
  failed after 5 min, and re-recording clears the old transcript. Live timings: plan 6s,
  write-scene 8 to 14s, transcribe call 1.8s (done ~18s later), sync 1.9s, Lambda-triggered
  Fargate render 108s (63.2s video, identical to local). Checked in a real browser: secure
  context (camera, mic, screen capture available), dashboard lists the project, deep link
  reopens it on the video step. Suite 47.
  **Not yet done**: a real-webcam run on the live URL (user's test); no auth; GitHub token.

- **GitHub ingest limit (deployed).** Unauthenticated GitHub allows 60 API requests an hour per
  IP and Lambda IPs are shared. An ingest now spends ONE API request (the file tree): `HEAD`
  replaces the default-branch lookup in both the tree API and raw.githubusercontent.com (file
  contents were already off the API limit). A repo is remembered in S3 for 15 minutes
  (`ingest-cache/<owner>/<repo>.json`, best-effort), so retries and repeat demos cost nothing:
  5.7s then 0.5s locally. Rate-limit and not-found errors now say what happened ("try again in
  about 17 minutes", "check the URL and that it's public"). Suite 51. Still open: a GitHub token
  (empty `GithubToken` param) would lift the limit to 5,000/hour; user creates it and adds
  `GITHUB_TOKEN` to `backend/.env`.

- **Documentation brought up to date (Sept 20).** `README.md` rewritten (what it does, features,
  pipeline, where AWS fits and what is honestly not on AWS, run locally, deploy, known limits, live
  link). `docs/ARCHITECTURE.md` rewritten to the as-built pipeline, deployment shape, S3 layout and
  config. `docs/FEATURES.md` now says built / added / not built for every item.
  `docs/SYNC_ALGORITHM.md` keeps the original spec and gains an "As built" section (phonetic keys,
  proportional edit distance, look-ahead, Whisper retry chain, render rules, measured accuracy).
  `docs/SCOPE_PLAN.md` ticked and dated; `TASK_SPLIT`, `HACKATHON_RULES`, `PRODUCT.md`,
  `CLAUDE.md` (decisions 6 to 8 and a "where things stand" section) and `backend/.env.example`
  (RENDER_MODE, us-east-1) corrected. Still to write: the submission writeup.

- **Gated access for the blog (Sept 20).** Two shared tester accounts and one private judge
  account, no sign-up. Testers get 5 drafts, 3 locks and ONE render in total (strict, the user's
  choice); the judge is unlimited and sees every project. Design decisions: built-in accounts
  (salted scrypt hashes in `AUTH_ACCOUNTS`, HMAC-SHA256 session tokens, tester 6h / judge 24h)
  rather than Cognito, on this account's already-restricted CloudFront lesson; one deployment, two
  entry pages: `/` is the tester sign-in (no landing page), `/judge` is the private judge sign-in
  and shows the landing page and a dashboard with a "Made by" column. All access is enforced on the
  server by one `guard()` (sign-in, then project ownership, then quota) shared by every Lambda
  route and the local server; a project that isn't yours is a 404, the same as a missing one; a
  quota spent by a call that then fails on our side is given back. Projects carry an `owner`;
  older ones have none and are the judge's only. Frontend: `AuthProvider`, `SignIn`, `Home`,
  `RequireAuth`, account chip with "1 video left" in the sidebar. Verified with curl locally and
  live (wrong password 401, isolation 404s, judge sees legacy project, lock counts, tester on the
  judge page refused) and in a real browser. **Found on the way**: SAM's command line stripped the
  quotes from the JSON accounts parameter (live login answered 500); accounts are now base64.
  Test data was cleaned up afterwards. Suite 63.
  **Then: the judge has no password to be given, only a link.** Added a private judge link,
  `/j/<key>`: `POST /api/auth/judge-link` checks the key (an HMAC of `AUTH_SECRET`, so nothing
  new to store; rotate the secret to revoke) and returns a 72h judge session; the page then
  removes the key from the URL, and every page sends `Referrer-Policy: no-referrer`. Same generic
  refusal for a wrong, short or missing key. `backend/scripts/judge-link.mjs <site> --save` writes
  the link to `backend/.accounts.txt` without printing it. Tested locally and live (right key 200,
  wrong 401, an earlier-displayed key dead after rotating `AUTH_SECRET` and redeploying), and in a
  real browser (link opens the landing page as the judge, bad link shows "This link isn't
  valid"). `/judge` password sign-in stays as a backup. Suite 66. Still open: sharing a tester account means
  sharing its one project; no reset UI (`aws s3 rm s3://<bucket>/quota/<user>.json`).

- **More of the Ship It table, all live (Sept 20).** The user asked to use other AWS services that
  were available and easy. Checked first: every service answered a read call, but read is not
  create (CloudFront answered reads and still refused to create), so each was proven by creating
  it. All three worked. (1) **DynamoDB** (`<stack>-usage`, on demand): testers' usage moved from an
  S3 read-modify-write file to atomic conditional updates. Live concurrency test: 8 simultaneous
  lock requests against a limit of 3 gave exactly 3 x 200 and 5 x 403. (2) **Step Functions**
  (`backend/statemachine/render.asl.json`): `ecs:runTask.sync` with a 20 minute timeout and a
  catch into `RenderFailedFunction`, which marks a stuck render failed, gives a tester their
  render back, adds "It didn't use up your one video" to the message, and publishes to SNS.
  Live: happy path SUCCEEDED (113s render); failure path (a project with no recordings)
  FAILED with the tester's usage going 1 -> 0. This replaces "a failed render isn't refunded".
  Found and fixed: the error shown in the app included an AWS role ARN (the worker's raw S3
  AccessDenied text), so the worker now shows AWS and ffmpeg errors as "The render failed on our
  side." and keeps the detail in logs and the alert. Fargate image rebuilt and pushed
  (10:34 IST). (3) **SNS + CloudWatch**: topic `<stack>-alerts`, alarms `render-failed`
  (ExecutionsFailed) and `api-5xx` (5 in 5 minutes); email subscription is the optional
  `AlertEmail` parameter (empty until an address is given; AWS then emails a confirmation link).
  Suite 72. Left out on purpose: Cognito (would replace the sign-in just built; decision pending),
  SageMaker/Bedrock (not available here), CloudFront (blocked).

- **Cognito replaced the hand-built sign-in (Sept 20).** Committed the previous working state first
  as a rollback point (`aefd4de`). User pool with admin-created users only, groups `tester` and
  `judge`, two app clients (tester refresh 1 day, judge 30 days). Judge link design, decided after
  weighing three options: our Lambda checks the link key (an HMAC of `AUTH_SECRET`, unchanged, so the
  link itself did not change) BEFORE Cognito is asked, then gives the `judge` user a fresh random
  password and signs in with it, so nothing is stored and wrong keys can never trigger Cognito's
  lockout (rejected: putting the password in the link, which lets anyone lock the judge out; and a
  custom-auth challenge, which is more moving parts). Password sign-in refuses the `judge`
  username for the same reason. API: `aws-jwt-verify` on every route (signature, issuer, audience,
  expiry, ID token, group), refresh via `POST /api/auth/refresh`; the frontend renews the ID token
  quietly on a 401 and retries once. Removed the custom token and account code, `AUTH_ACCOUNTS`
  and the `/judge` password page. Tested with real RS256-signed tokens (expired, forged group,
  wrong key, wrong pool, wrong client, access token, no group all rejected) and live: wrong
  password 401, `judge` username 401, forged and re-signed tokens 401, judge link 200, refresh 200,
  bad refresh 401, judge still signs in after many wrong attempts. Browser on the live site:
  tester sign-in, silent refresh after a corrupted token (stayed signed in), judge link ->
  landing page + all projects. **Found**: an early "tampered token" test passed only because the
  last base64 character of a signature carries unused bits; re-tested by altering the middle of
  the signature and the payload. Suite 71. Cognito creation was allowed on this account.
  There is no sign-up path, by design (see README); `provision-users.mjs` can make more testers.

- **Rate limits and the 3 minute rule (Sept 20).** Requested by the user: every account except the
  judge makes ONE video of at most 3 minutes, plus a rate limit for all users. Length is enforced on
  the server at drafting (target clamped to 3, pasted script over ~3:18 refused), locking (edited
  script over ~3:18 refused) and rendering (recorded speech over 3:45, from the new
  `duration_ms` in the sync result), via a route `check` that runs BEFORE quota is spent, so a
  refusal costs nothing. Rate limits: per account per minute in DynamoDB (`rate#` keys, TTL),
  30 heavy / 120 normal (judge x5), 10 a minute per IP on sign-in, and a shared 40 renders a day
  cap; fails open. Live: 40 heavy calls -> exactly 30 x 200 then 10 x 429 with "wait 49 seconds";
  ordinary calls unaffected; fresh allowance the next minute; a 600 word pasted script -> 400
  (usage unchanged); a 700 word lock -> 400 (usage unchanged); a 5 minute request came back planned
  as 6 scenes / 405 words = 3.0 minutes. Suite 84. **Found**: this account's Lambda concurrency is
  10 (a first test with 45 simultaneous calls gave 10 x 200 and 35 x 503, which looked like a rate
  limiter bug and wasn't). The Service Quotas API refuses to raise it (applied value below the
  default); needs an AWS Support case. Practical effect: about three people drafting scripts at the
  same time is the ceiling. Not live-tested: the render-time length check against a real
  over-length recording (unit tested only).

- **Google sign-in built, switched off until credentials exist (Sept 20).** Requested by the user;
  it turns "each user makes one video" into per-Google-account allowances. Via Cognito's hosted page
  (code flow + PKCE + `state`), our `POST /api/auth/google` exchanges the code, only this site's
  callback and localhost are accepted as redirect. A Google user has no group, so a federated
  identity makes them role `member` (same one-video / 3 minute limits, own DynamoDB row, refund on a
  failed render now applies to every non-judge role). New template resources are conditional on
  `GoogleClientId` + `GoogleClientSecret` (domain, identity provider, web client); the sign-in page
  asks `GET /api/auth/config` and shows "Continue with Google" only when it is on. Locked scripts
  and projects now carry `owner_name` (a Google username is an opaque id) for the judge's dashboard.
  Tested: member role, group beats federation, forged/no-group tokens, allowed redirects, config
  on/off (87 tests); deployed with Google off and regression-tested live (tester login, judge
  link, `/auth/google` with a bad redirect -> 400). **Not yet tested end to end**: needs Google
  credentials created by the user in Google Cloud Console and a real Google sign-in in a browser.

- **Team account and a public landing page (Sept 20).** `tester3` was created for the user, then made
  unlimited for our own testing. Rather than make it a judge (a password that sees every user's
  projects), added a fourth role, `team` (Cognito group `team`): no allowance, no 3 minute cap, no
  daily render cap, five times the rate limit, own projects only. The rule "limited unless judge"
  had been repeated in eight places, so it is now one function, `hasLimits(role)`, used by the quota,
  length, rate, refund and UI code. Live: 5 locks of a 6:40 script (a tester gets 3 locks and
  3:18), a 900 word pasted script accepted, usage never counted, sees only its own projects, 404
  on the judge's project; browser shows "Team account, no limits" and the 5 minute option.
  Also requested: the landing page is now public. `/` is the landing page for everyone, sign-in
  moved to `/sign-in`, `/app/*` and every API call except sign-in still need an account (verified
  signed out in a real browser: landing visible, `/app` and `/app/studio` redirect to
  `/sign-in`, `/api/projects` is 401). The landing header shows "Sign in / Try Vaani" when signed
  out and "Dashboard / Make a video" when signed in; "Back to site" is in every account's sidebar.
  `provision-users.mjs` gained `--add tester4` and `--team tester4`. Suite 94.

- **Google sign-in switched on (Sept 20).** The user created the OAuth client (Web application) and put
  the id and secret in `backend/.env`; deployed with them (redaction filter; only the client id, which
  is public, appeared in the log). Created: Cognito domain `vaani-979973571368`, the Google identity
  provider, and the `web` app client (callbacks: live site and `http://localhost:5173`). Verified
  without a real login: `/api/auth/config` reports Google on; Cognito answers the authorize request
  for BOTH the live and the localhost callback with a 302 to accounts.google.com; an unregistered
  callback is refused (`redirect_mismatch`); Google itself accepts the client and redirect (a 302
  to its sign-in page, no `redirect_uri_mismatch` or `invalid_client`); the live sign-in page shows
  "Continue with Google" and clicking it sends the browser to Cognito with the PKCE challenge,
  state, client and callback all correct. **Not verified**: completing a real Google login and the
  code exchange (`POST /api/auth/google`), which needs a real Google account. **Gotcha found**: a
  brand-new Cognito domain returned NXDOMAIN to the first lookups (before its DNS existed), and the
  zone's SOA negative-cache TTL is 86400 seconds, so any resolver that asked in that first minute
  (here: the user's home router, 192.168.29.1) keeps saying "doesn't exist" for up to 24 hours,
  while Google's 8.8.8.8 resolves it. It affects only networks that queried early. Workarounds:
  Chrome "Use secure DNS" with Google, another network (phone hotspot), or a temporary
  `/etc/hosts` line. Lesson: don't probe a brand-new Cognito domain from the machine that will
  use it until it has resolved elsewhere.

- **Google login confirmed working; alerts subscribed; concurrency measured (Sept 20).** The user
  signed in with Google successfully (after working around the DNS cache). Alert email set to the
  address the user gave (the `AlertEmail` parameter; the subscription is PendingConfirmation until the
  link in AWS's email is clicked). **Every deploy must pass every parameter** (Gemini, Groq,
  AuthSecret, GoogleClientId, GoogleClientSecret, AlertEmail, VpcId, SubnetIds): leaving Google's
  out would delete its Cognito resources. **Lambda concurrency (10) measured for real visitors**:
  a page load is 6 requests at once (the page plus 5 files, all served by the site Lambda); 1, 2, 3
  and 5 visitors loading at the same instant gave 0 failures out of 6, 12, 18 and 30 requests; 8 at
  once gave 12 failures (503) out of 48. So about 5 truly simultaneous visitors are fine and only a
  burst beyond that breaks (a blank page until reload). Worth a free AWS Support case; not a blocker.

- **Repo audit and cleanup (Sept 20, afternoon).** Method: knip (unused files, exports, packages)
  plus the compiler's `--noUnusedLocals`, then evidence for every removal. Removed: the legacy
  one-shot `/api/script` route (Lambda, handler, local route, `generateScript`,
  `mapWithConcurrency`, the frontend wrapper; the app uses plan then write-scene); the Bedrock
  provider and the AWS Transcribe provider with their parser, `transcriptionJobName`, npm packages
  (`client-bedrock-runtime`, `client-transcribe`, `@smithy/types`) and IAM permissions
  (`transcribe:*`), so `LLM_PROVIDER` / `STT_PROVIDER` / `BEDROCK_MODEL_ID` are gone and the two
  switches became direct implementations; the legacy `graph` visual type (schema, generator, renderer,
  preview; no stored script used it); `scriptWordCount`, `stepMeta`, two unused shadcn files, and the
  unused `next-themes` and render `zod` packages; dead re-exports and needless `export` keywords.
  De-duplicated `formatDuration` (now shared) and `findFileContent` (now `findIngestedFile` in
  shared, used by the renderer and the preview). Left alone on purpose: the generated shadcn
  component exports and Poorvanshi's landing components (she is editing them), and knip's false
  positives (the fonts, `tw-animate-css`, `shadcn` and `tailwindcss` are imported from CSS). Net:
  about 570 fewer lines, no behaviour change, suite still 95.

## Sunday, Sept 20

- [x] Sync algorithm wired to a real recorded scene
- [x] Render stage working, full pipeline run start to finish
- [x] Good-to-haves (only if must-haves are done): slide themes and richer slides, dashboard and Studio redesign, landing page
- [ ] Demo video recorded (3 min max)
- [ ] Writeup written
- [ ] Repo public, README current
- [ ] Submitted before 8:00 PM IST

Notes:
- **Slide themes and richer slides (Sept 20 evening).** A script now has a
  `theme` (`dark` default, `light`), picked in the script review step and saved with the locked
  script, so old scripts stay dark. The light theme uses the website's own tokens and Geist Mono
  (embedded as base64 in `shared/src/geistMonoFont.ts`, since neither the renderer nor the
  sandboxed preview iframe can load a font file). All frame colors in `visualDesign.ts` are now
  CSS variables, so slides, diagrams, charts, the demo frame, the face ring and code beats all
  follow the theme (code uses Shiki `github-light`). Slides gained building blocks styled by the
  design system: bullets (`ul.points`), table (`table.data`), stat cards (`.stats`), two columns
  (`.cols`) and inline bars (`.hbars`), and the script prompt teaches the model when to use them
  (one block per slide, real numbers only). Checked by rendering every block in both themes with
  Playwright (no overflow outside the frame). Suite is 99. Deployed with a
  rebuilt Fargate image (see the deploy entry below). Not built: line or pie charts (bars only).
  The theme is chosen in the repo form and can still be changed in script review before locking.
- **Dashboard redesign (Sept 20 evening, frontend only).** `/app` is now a
  full-width page: a horizontal five-step progress bar on top (Repo, Script, Record, Sync, Video)
  with the next action directly under it, a stats strip (videos left, in progress, finished),
  and a card grid instead of a table. Cards show the repo owner's GitHub avatar, a slim stepper,
  the status and what is next ("Record scene 2 of 3"), and a dashed "New video" tile fills the
  grid. Finished videos have a Watch button that opens a dialog and plays the video (fetched once
  through `api.getProject`, no backend change). Skeleton matches the final layout, the error
  alert has Try again, and the last list is cached so coming back from the Studio is instant.
  New: `components/app/ProjectStepper.tsx`, `ProjectCard.tsx`, `WatchDialog.tsx`; helpers in
  `lib/stage.ts` (`nextStepText`, `allowanceText`, `repoParts`). Checked on desktop width against
  the live API. Not checked: phone width, the Watch dialog (no finished project to open), the
  judge view. Left out on purpose: delete/rename, search, format badges, thumbnails.
- **Studio redesign (Sept 20 evening, frontend only).** `/app/studio` now
  matches the dashboard: the vertical stepper is a horizontal bar across the top (same look, but
  each step opens once reachable, blocked ones keep their tooltip), the `max-w-3xl` column and
  side gutters are gone, and each step has a compact header (step count, title, the repo name and
  a Draft/Script locked badge). The repo step is a two-column form: numbered sections, all five
  video types across, language, length and the new slide theme choice side by side, "Already have
  a script?" collapsed, and a sticky "Your video" summary with the Draft button so it is never
  below the fold. The chosen theme now goes onto `Script.theme` from the form (still changeable in
  script review). Sync and AI narration sit side by side, the render card has a max width. Copy
  no longer says "Hinglish script" only. No Studio logic changed. New: `StudioHeader.tsx`,
  `VideoSummary.tsx`; rewritten `Stepper.tsx`; `RepoForm.tsx` layout. Checked on desktop: repo
  step, and a reopened project on the Record step. Not checked: phone width, drafting a script
  end to end with the theme set, the Sync and Video steps.
- **Deploy of all of the above, Sept 20 about 6 PM IST, and what was checked.** Order: `npm run
  build:site`, Fargate image built and pushed (confirmed a real push: Login Succeeded, the new
  digest in ECR), `sam build` and `sam deploy` with every parameter (values read from
  `backend/.env` into shell variables, log redacted; stack `UPDATE_COMPLETE`, the Google outputs
  still present, so no parameter reverted). Checks after it: the live page chunks (main, Dashboard,
  Studio) are byte-identical to the local build; every POST route answers 401 without a token;
  no errors in any Lambda log over the following 15 minutes; both CloudWatch alarms OK. The new
  image was also run on its own to render a light frame (Geist Mono loads, theme applied). Then
  one real render on the live stack as the judge (link key derived from `AUTH_SECRET`, nothing
  printed): a hand-built light-theme script with bullets, a table, stat cards and a diagram, locked,
  voiced by Polly and rendered on Fargate in 67 s. The frames show the light theme correctly. That
  test project ("vercel/ms", judge account) is still in the judge's dashboard and used one of the
  shared daily renders. Not checked live: a full Gemini draft with the theme set from the form, the
  Watch dialog on a finished project in the browser, phone widths.
- **Local-dev fix.** `frontend/vite.config.ts` only read `API_PROXY_TARGET` from the shell, so the
  `frontend/.env.local` option in `docs/LOCAL_DEV.md` did nothing, and a teammate who skipped the
  variable silently got the default (`localhost:4000`, an unconfigured local backend, so sign-in
  failed with `USAGE_TABLE env var is not set`). The config now also reads `.env.local` (the shell
  variable still wins), and the doc says what that error means. Tested with a dead address in the
  file (fails), the variable over the file, the file alone, and the default.
- **Docs brought up to date** in one pass: README (features, dashboard and Studio, test count 99,
  limits), `docs/ARCHITECTURE.md` (themes, slide blocks, the web app section, script contract, a
  duplicated line in the render diagram), `docs/FEATURES.md`, `docs/SCOPE_PLAN.md`,
  `docs/TASK_SPLIT.md`, `docs/LOCAL_DEV.md`, `PRODUCT.md` (the "dark look" brand line was stale),
  `CLAUDE.md` (decision 10, themes). `docs/HACKATHON_RULES.md` and `docs/SYNC_ALGORITHM.md` needed
  no change. Still open before 8 PM: the demo video, the writeup, making the repo public, the
  submission, confirming the SNS alert email, rotating the judge link right before submitting.
- **Landing polish and grid marks (Sept 20, about 6:45 PM).** The page column is 1480px instead of
  1200px (smaller side gaps on wide screens; the footer word scales up at 2xl so the gap between
  "Vaani" and the Devanagari word stays small), section labels ("02 / How it works" and so on) are
  16px on a 48px strip, and the "+" crosshairs are drawn from two 1px lines placed from the real
  border geometry: measured 0px off the line intersections on both axes, hero included. New shared
  `components/ui/corner-marks.tsx`: L-shaped corner brackets, always on for the main panels (hero
  card, How it works, Sync, FAQ list, dashboard progress panel, Studio stepper, the summary card)
  and on hover or focus for the stack cards, dashboard stat tiles and project cards. Frontend
  only; redeployed with a site rebuild, no image rebuild.
- **Judge link rotated, Sept 20 about 6:20 PM.** A new random `AUTH_SECRET` went into `backend/.env`
  (not printed), and the stack was redeployed with every parameter. Checked: the old key answers
  401, the new key signs in as the judge, a made-up key answers 401. The new link is saved on the
  `judge_link` line of the git-ignored `backend/.accounts.txt`. Rotate again only if it leaks,
  because the link given to the judges stops working when the secret changes.
- **Second deploy, Sept 20 about 6:55 PM** (site only, no image rebuild): the wider column, section
  labels, crosshairs and corner marks. All 7 live JS and CSS files are byte-identical to the local
  build, the judge link still answers 200, the API still answers 401 without a token, no Lambda
  errors in the following 10 minutes, both alarms OK. Everything up to the commit "wider landing
  column, bigger section labels, exact crosshairs, corner marks" is pushed to `origin/main`.

- **Docs reorganised around features (Sept 20 evening).** The README now leads with what a judge can see and try, grouped by what a person does (repo to script, review, visuals, record, cuts, finished video, workspace, sign-in), then how it works and where AWS fits, and links to the deeper docs. `docs/FEATURES.md` is a feature guide (what it does, where to find it in the app, what it is built with) instead of a status table. Everything about running the app moved, unchanged, to the new `docs/OPERATIONS.md`: accounts and roles, running locally, deploying, operational limits, the test command. The build log, debugging notes and decisions stay in `PROGRESS.md` and `docs/ARCHITECTURE.md`. `CLAUDE.md` and `docs/SCOPE_PLAN.md` now point at "Not built yet" in the features doc, since the old good-to-have table is gone.
