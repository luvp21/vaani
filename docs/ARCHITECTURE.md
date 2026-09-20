# Architecture

How Vaani works as built and deployed. The original design lives in `docs/SYNC_ALGORITHM.md` (the sync spec) and `PROGRESS.md` (every decision that changed, and why).

## Pipeline, stage by stage

```
GitHub URL + notes + format + language + length (or the user's own script)
        │
        ▼
┌─────────────────────┐
│ 1. Ingest            │  file tree via the GitHub API (1 request), README + package files +
│ Lambda               │  up to 12 source files from raw.githubusercontent.com, each capped
│ backend/lib/ingest   │  at 20 KB. Result cached in S3 for 15 minutes.
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ 2. Script generation │  PLAN: one call returns an outline (scene titles, purpose, word budget
│ Gemini, function     │  from the target length at 135 words/minute).
│ calling              │  WRITE: one call per scene, three at a time, each seeing the shared
│ backend/lib/scriptGen│  repo context and the whole outline. Beats carry narration text plus
└──────────┬──────────┘  a visual: code_highlight | slide | diagram | chart | ui_demo.
           ▼             Narration follows spoken-style rules and a machine-writing check.
┌─────────────────────┐
│ 3. Review and lock   │  Edit any words. "Update visual" regenerates one beat from its new
│ app + Lambda         │  wording; "Rewrite scene" rebuilds a scene from edited text, keeping
│                      │  the wording (checked). Lock stores the script + ingest in S3.
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ 4. Record            │  Per scene, in the browser: camera + mic against a teleprompter
│ getUserMedia /       │  (MediaRecorder, webm). Scenes with ui_demo beats first get a
│ getDisplayMedia      │  Demo clips panel: one silent screen clip per step, uploaded on its own.
└──────────┬──────────┘  Uploads go straight to S3 with presigned PUT URLs.
           ▼
┌─────────────────────┐
│ 5. Transcribe        │  Whisper large-v3 via Groq, word timestamps. The API call only marks
│ Lambda, background   │  the scene in progress and starts a background run of the same
│ backend/lib/         │  function (API Gateway gives up at 30 s); the app polls status.
│ transcribe           │  Attempts are scored against the script and retried (see below).
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ 6. Sync              │  Two-pointer match of the known script against the transcript ->
│ plain code           │  a timestamp for every beat. See docs/SYNC_ALGORITHM.md.
│ backend/lib/sync     │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ 7. Render            │  Step Functions runs an ECS Fargate one-off task (never Lambda) and waits
│ Fargate + ffmpeg     │  for it. Per beat: Playwright captures
│ render/src           │  the animated visual frame by frame, in the script's theme; ffmpeg builds constant-30fps clips,
│                      │  fits demo clips to their beats, joins the scene with the recorded
└──────────┬──────────┘  audio, overlays the face bubble, and concatenates scenes to final.mp4.
           ▼
      Finished video (presigned S3 URL)
```

The whole flow is driven by the app's stepper (Repo, Script, Record, Sync, Video) and by artifacts in S3. Only the render is a Step Functions workflow (see below); everywhere else each stage's state is derived from which objects exist in S3, which is also how the dashboard knows where a project stands.

### The render workflow

`POST /api/render` spends the tester's render, then starts a Step Functions execution (`backend/statemachine/render.asl.json`) with the project id, owner and role. `RunRender` uses the `ecs:runTask.sync` integration, so the workflow waits for the Fargate task and fails if the task exits non-zero or takes over 20 minutes. Any failure goes to `TidyUp` (the `RenderFailedFunction` Lambda, logic in `lib/render/failure.ts`): mark the render as failed if the worker couldn't (a crash or timeout leaves it on "running"), give a tester their render back in DynamoDB, add a note to the message the tester sees, and publish the reason to the SNS alerts topic. The execution then ends in a `Fail` state, which the `render-failed` CloudWatch alarm also watches. The worker's message to the app is sanitized: AWS and ffmpeg errors (role names, account ids, command output) go to the logs and the alert, not the page. In local dev (`RENDER_MODE=local`) the worker runs directly and none of this applies.

### Fallback path

Instead of recording, `POST /narrate` has Amazon Polly (Kajal, `en-IN` for English scripts) voice every beat, and the render uses the resulting exact durations as its timing. It is a complete video with no dependency on recording or sync. It is the safety net, never the primary path.

### Choices worth knowing about

- **Whisper, not AWS Transcribe** (the AWS Transcribe and Bedrock code was removed once it was clear neither would be used). Transcribe's per-segment language ID mangled code-switched Hindi and English. Whisper is faithful when primed with the scene's own script. Retry order for Hinglish: auto-detect + script prompt, English + prompt, Hindi + prompt, English alone. Each attempt is scored by how much of the script it reproduces (threshold 0.5), because Whisper sometimes hallucinates a stock phrase or translates. English scripts start with `language: "en"`. Devanagari output is transliterated to Latin before it is stored.
- **Constant frame rate everywhere.** Sparse still-image video and webcam webm are variable frame rate, and decoders cut such streams off early. Every clip is forced to 30 fps (`tpad` clones, `fps` filters).
- **First beat starts at 0.** It owns the silence before the first spoken word, so later cuts don't land early by that long.
- **Demo clips fit their beat.** A longer clip is sped up so all of it fits (squeezed into 85% of the beat, so the result stays on screen); a shorter one holds its last frame.
- **Face bubble.** Circular mask via ffmpeg `geq`, bottom-right. Visuals are drawn at 82% when a face is present so nothing runs under it (scaling the stage keeps diagrams undistorted); the demo window moves left and shrinks to 960x540.
- **Shared visual code.** `shared/src/visualDesign.ts` produces the HTML for every visual. The renderer screenshots it and the browser preview shows the same HTML in a scaled iframe, so what you review is what renders. Only code beats differ (Shiki in the renderer, a lighter highlighter in the browser).
- **Themes.** A script has a `theme`, `dark` (default) or `light` (`shared/src/theme.ts`), chosen in the repo form or in script review and saved with the locked script (old scripts have none and stay dark). Every color in the design system is a CSS variable, and the light theme is one block of overrides using the website's own tokens plus Geist Mono. The font is embedded as base64 (`shared/src/geistMonoFont.ts`, 23 KB) because neither the renderer nor the sandboxed preview iframe can load a font file. The theme travels on `BeatChrome.theme`; `previewChrome(theme)` is a chrome with no bottom bar, for the review page. Code beats switch Shiki between `one-dark-pro` and `github-light`.
- **Slide blocks.** Besides `h1`, `h2`, `p` and `.statement`, the slide CSS styles `ul.points` (bullets), `table.data`, `.stats` and `.stat` (stat cards), `.cols` (two columns) and `.hbars` (inline bars). The script prompt (`VISUAL_RULES` in `backend/src/lib/scriptGen.ts`) tells the model when to use each: one block per slide, small sizes, real numbers only, never hardcoded colors. Every animation still finishes inside the intro window the renderer captures.

## Deployment

```
Browser ──https──> API Gateway HTTP API ──┬─ GET /, /{proxy+}   -> SiteFunction (serves frontend/dist)
                   (one origin)           └─ /api/*             -> one Lambda function per route (20 routes)
                                                                    │
            presigned PUT/GET (recordings, clips, video) ───────────┤
                                                                    ▼
                                                              S3 bucket
                                                                    ▲
       RenderTriggerFunction -> Step Functions -> ecs:RunTask -> Fargate ┘  (image in ECR)
                         └─ on failure: RenderFailedFunction -> DynamoDB refund + SNS alert
```

Everything is in `backend/template.yaml`. CloudFront would normally front the site, but this account can't create CloudFront resources until AWS verifies it, so the frontend is served by `backend/site/index.mjs` (gzip, immutable caching for fingerprinted assets, SPA fallback, path-traversal guarded). The API is throttled (50 rps, burst 100) because it is public and each call can spend model, transcription, TTS or Fargate money.

Locally, `backend/src/local-server.ts` serves the same routes (`/api/*`) and the Vite dev server proxies to it. With `RENDER_MODE=local` the render worker runs from the checkout instead of Fargate.

## The web app

React 19 + Vite, one bundle served by the site Lambda, pages loaded lazily.

- **Landing** (`/`, public): hero demo, how it works, the sync explainer, the stack, FAQ. Scrolls as one page with a section strip nav. The look is a bordered 1480px column on a hatched ground: each section has a labeled strip ("02 / How it works"), "+" crosshairs drawn from 1px lines sit exactly on the line intersections (`Crosshair` in `components/landing/frame.tsx`), and `CornerMarks` (`components/ui/corner-marks.tsx`) puts L-shaped brackets on boxes, always on for the main panels and on hover for cards. The sign-in and 404 pages use the same column.
- **Dashboard** (`/app`): a horizontal five-step progress bar for the project you would pick up (the judge sees the newest), the next action under it, stat tiles (videos left, in progress, finished), and one card per project. A finished project has a Watch button that opens a dialog and fetches the video address through the project API (the list does not carry it). The list is cached in memory between visits and polled every 5 s while anything renders.
- **Studio** (`/app/studio/:id?`): a horizontal stepper across the top (Repo, Script, Record, Sync, Video; a step opens once it is reachable), a compact header, then the step. The repo step is a two-column form with a sticky "Your video" summary. The recorder stays mounted while another step is open, so the camera stream and the list of uploaded scenes survive switching steps. None of the page layout changes what the handlers do.

## Access control

Sign-in is Amazon Cognito (`backend/src/lib/auth/`). The user pool allows only administrator-created users (`AllowAdminCreateUserOnly`): `tester1`, `tester2` and `judge`, made by `backend/scripts/provision-users.mjs`, with the groups `tester` and `judge` deciding the role. There are two app clients so the two kinds of session last different times (tester refresh token 1 day, judge 30 days); ID and access tokens last an hour.

Our API does the sign-in with Cognito's admin API (`AdminInitiateAuth`), so the browser never talks to Cognito: `POST /api/auth/login` (testers), `POST /api/auth/judge-link` (the judge), `POST /api/auth/refresh` (a new ID token from a refresh token) and `GET /api/auth/me` (the account and its usage). The browser keeps the ID token and refresh token, sends the ID token as `Authorization: Bearer`, and on a 401 renews it once and retries.

**Google sign-in** (optional, `HasGoogle` in the template). Cognito's hosted page sends the person to Google and back to `/auth/callback` with a code; the browser started it with a PKCE challenge and a `state` it checks on return, and `POST /api/auth/google` swaps the code and verifier for tokens at Cognito's token endpoint (only this site's callback or the local dev one is accepted as the redirect). A Google user has no group; the verifier makes anyone with a federated identity a `member`, with the same one-video allowance and limits as a tester, each on their own DynamoDB row. `GET /api/auth/config` tells the sign-in page whether to show the button, so nothing appears until Google credentials exist. Locked scripts also record the owner's display name, because a Google username is an opaque id.

**The judge link.** Judges get a link, not credentials, and Cognito has no sign-in-by-link, so the link is our own mechanism in front of Cognito. Its key is `HMAC(AUTH_SECRET, "vaani/judge-link/v1")`, compared in constant time by our Lambda *before* Cognito is asked, so a wrong key never touches the judge account and can't lock it out (Cognito locks a user after a few failed passwords). A right key makes the Lambda set a fresh random password on the `judge` user and sign in with it, so that password is never stored or known. Password sign-in refuses the `judge` username for the same lockout reason. Rotating `AUTH_SECRET` replaces the link.

Every other route goes through one function, `guard()` in `access.ts` (used by the Lambda wrapper `handlers/secure.ts` and by the local server), which checks in order: the ID token (`aws-jwt-verify`: signature against the pool's published keys, issuer, audience, expiry, that it is an ID token, and membership of a group), then that the project belongs to the caller (the judge passes; a tester on someone else's project gets a 404, indistinguishable from a missing one), then a quota. Quotas live in a DynamoDB table (`<stack>-usage`, one item per tester) and every change is a single atomic conditional update, so simultaneous requests can't both take the last unit: 5 drafts, 3 script locks and 1 render in total (`TESTER_LIMITS` in `shared/src/auth.ts`); a call that then fails on our side gives its quota back. A locked script records its `owner` (the Cognito username); projects from before accounts have none and are visible to the judge only. The dashboard lists a tester's own projects and every project for the judge.

**Length and rate limits** (`lib/auth/videoLimit.ts`, `lib/auth/rateLimit.ts`). A route can carry an extra `check` that runs after sign-in and ownership but before any quota is spent, so a refused request costs nothing: the 3-minute rule uses it three times (a pasted script when drafting, the script at lock, the recording's length from the sync result's `duration_ms` at render; the target length is clamped inside the draft handler). Rate limits are counted per account per minute in the usage table under `rate#...` keys with a time-to-live, using the same atomic conditional update as the quotas: 30 a minute on routes that spend money, 120 on the rest, five times that for the judge, per-IP for sign-in attempts, and a shared cap of 40 renders a day for everyone but the judge. The limiter fails open: if the table is unavailable the call goes through.

**Roles.** `tester` (shared demo account) and `member` (signed in with Google) have the one-video allowance, the 3 minute cap and the daily render cap; `team` (our own testing accounts, Cognito group `team`) has none of them but sees only its own projects; `judge` has none and sees every project. `hasLimits(role)` in `shared/src/auth.ts` is the single place that decides which apply.

The web app decides what to show by role, but that is presentation: the data is protected by the server checks above. The landing page (`/`) is public; `/app/*` needs sign-in and redirects signed-out visitors to `/sign-in`; only the judge's dashboard lists other accounts' projects.

## Data contracts

All defined once as Zod schemas in `shared/src/index.ts`; the API validates requests and the frontend parses responses with the same schemas.

- **Script**: `{ repo_url, user_context, format, language, theme, scenes[] { id, title, beats[] { id, text, visual_type, visual_spec } } }` (`theme` defaults to `dark`)
- **Transcript** (per scene): `words[] { text, start_ms, end_ms }`, plus a status of in_progress, completed or failed
- **Sync result**: `scenes[] { scene_id, checkpoints[] { beat_id, timestamp_ms } }`

### S3 layout

| Key | Content |
|---|---|
| `scripts/<id>.json` | locked script + ingest |
| `recordings/<id>/<scene>.webm` | the narration take (camera + mic) |
| `clips/<id>/<beat>.webm` | silent screen clip for one demo step |
| `transcripts/<id>/<scene>/output.json` | transcript status and words |
| `sync/<id>/result.json` | checkpoints |
| `narration/<id>/...` | Polly fallback audio and timing |
| `renders/<id>/status.json`, `final.mp4` | render status and the video |
| `ingest-cache/<owner>/<repo>.json` | 15 minute repo cache |

## Configuration

| Variable | Purpose |
|---|---|
| `S3_BUCKET`, `AWS_REGION` | storage |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | script generation (Gemini) |
| `GROQ_API_KEY`, `WHISPER_LANGUAGE` | transcription (Whisper large-v3 via Groq) |
| `GITHUB_TOKEN` | optional, lifts GitHub's 60 requests an hour |
| `USAGE_TABLE` | the DynamoDB table of tester usage (`vaani-backend-usage`) |
| `RENDER_STATE_MACHINE_ARN`, `ALERT_TOPIC_ARN` | set by the stack in Lambda: the render workflow and the alerts topic |
| `USER_POOL_ID`, `TESTER_CLIENT_ID`, `JUDGE_CLIENT_ID` | the Cognito pool and its app clients (stack outputs) |
| `WEB_CLIENT_ID`, `COGNITO_DOMAIN`, `SITE_URL` | Google sign-in: the web app client, the hosted-page domain, and this site's address (empty until Google is switched on) |
| `AUTH_SECRET` | derives the private judge link key (32+ random characters) |
| `RENDER_MODE=local` | dev only: run the render from the checkout |

See `backend/.env.example`.
