# Vaani: turn a GitHub repo into a video in your own voice

**Live app: https://10jlhtgcih.execute-api.us-east-1.amazonaws.com**

Built for **First Commit** (WeMakeDevs x AWS, Bharat Builds Tour), Sept 17 to 20, 2026. Track: **Ship It**.
Team **codeDKFYDK / cosmosapiens**: Luv Patel ([@luvvv](https://x.com/luvvv), leader) and Poorvanshi Kochar ([@poorvanshi1375](https://x.com/poorvanshi1375)).

## The problem

Explaining a project out loud, for a hackathon demo, a LinkedIn post or an X video, usually ends up as a talking head over a black terminal. It works, but it doesn't look good, and making code, architecture and a live product look good takes a lot of manual editing.

## What Vaani does

Paste a public GitHub repo. Vaani reads it and drafts a scene-by-scene script, with a visual planned for every line. You review and edit the script, then record yourself reading it, one scene at a time, from a teleprompter. Vaani finds the exact moment you say each line and cuts the matching visual in at that moment, with your face in a bubble on top.

The video uses **your real voice and face**. An AI voice (Amazon Polly) exists only as a fallback if you can't record.

## Features

### From a repo to a script
- **Any public GitHub repo.** Vaani reads the README, the package files and a sample of the source, with one GitHub request per repo.
- **Five video formats:** code walkthrough, hackathon demo, product demo, architecture overview and launch teaser. Each has its own scene outline, tone and mix of visuals.
- **English or Hinglish.** Hinglish is written the way Indian developers talk, in Latin letters, with English terms kept as they are. Both read like speech: short sentences, plain words, no hype.
- **Your length.** Choose 30 seconds to 5 minutes. The script is planned to a word budget, then each scene is written on its own with the repo as shared context.
- **Your notes.** Tell Vaani the audience, the purpose and any real numbers. They are used as given, never invented.
- **Bring your own script.** Paste narration and Vaani keeps your words and builds the slides, diagrams and demo steps around them.

### Review before you record
- **Edit anything.** Change the wording and regenerate that scene's visual to match, or rebuild a whole scene from your text.
- **Preview is the real thing.** The review page shows the same frames the renderer produces, including the entrance animation.
- **Dark or light slides.** Dark is an editor-style look. Light matches this website: the same colors and the same monospace type. The choice applies to slides, diagrams, charts, code and the bottom bar.

### Visuals that fit what is being said
- **Code** with the lines that matter highlighted and the rest dimmed.
- **Informative slides:** a big statement, bullet points, a small table, stat cards, two columns for before and after, or inline bars. The right block is chosen for the content, and numbers only come from the repo or your notes.
- **Architecture diagrams** of the components that really exist in the repo.
- **Bar charts** from real numbers, with the source shown.
- **Product demos:** for a demo step you record a silent screen clip on its own, so the app you are showing can use the microphone. The clip is sped up to fit your narration and ends on its last frame, so the result is never cut off.

### Record in your own voice
- **A teleprompter, scene by scene,** with a pop-out prompter window. Retake any scene as often as you like.
- **Your face in the video:** a round camera bubble, bottom-right, on every scene.

### Cuts land on your words
- **Whisper transcription** with a timestamp for every word.
- **A two-pointer match** of the script you were reading against what you actually said. Stutters, repeats and filler words don't shift a cut, because the script is the authority. Details: [`docs/SYNC_ALGORITHM.md`](docs/SYNC_ALGORITHM.md).

### The finished video
- **Rendered on AWS Fargate** at 1280x720: visuals switch at your words, your voice on the audio, your face on top.
- **Watch it in the app** or download the MP4.
- **A safety net:** if you can't record, an AI voice (Amazon Polly, Kajal) narrates the same script and the same video is made from it.

### A workspace that shows where you are
- **Dashboard:** a progress bar across the top shows the five steps and the next thing to do ("Record scene 2 of 3"). Every project is a card showing where it stands, and a finished video plays in a dialog.
- **Studio:** a horizontal stepper (Repo, Script, Record, Sync, Video) and a repo form that shows your choices, and the Draft button, in a live summary beside it.
- **Landing page** that explains the idea with a working demo of the sync.

### Sign-in and fair use
- **Amazon Cognito** sign-in, plus "Continue with Google". Judges get a private link and need no password.
- **One video of up to 3 minutes** per visitor account, enforced on the server. A failed render is given back automatically.
- **Rate limits** and a shared daily cap on renders keep the live demo affordable. Details in [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

### Not built yet
Auto-zoom on clicks, a timeline editor after recording, line and pie charts, Hindi in Devanagari script, and deleting or renaming a project.

## How it works

```
GitHub URL + notes
   -> Ingest      file tree + a capped sample of files (1 GitHub API request, cached)
   -> Script      plan the scenes, then write each scene (Gemini)     [English | Hinglish]
   -> Review      edit words, regenerate visuals, pick a theme, lock the script
   -> Record      per scene: camera + mic against a teleprompter; demo steps: silent screen clips
   -> Transcribe  Whisper large-v3, word timestamps, runs in the background
   -> Sync        two-pointer match of the known script against the messy transcript
   -> Render      Step Functions -> Fargate: Playwright frames + ffmpeg -> final.mp4
```

The core idea is the sync. The script is known word for word before you record, so Vaani doesn't try to understand your speech. It walks the script and the transcript with two pointers, so stutters, repeats and filler words cost only the transcript pointer. Full pipeline: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Where AWS fits

| Piece | Service |
|---|---|
| API (20 routes) | API Gateway HTTP API + Lambda (Node 24, esbuild bundles) |
| Web app | A small Lambda serving the built frontend behind the same API (one https origin, no CORS) |
| Storage | S3: locked scripts, recordings, clips, transcripts, sync results, videos; presigned URLs so recordings go straight from the browser to S3 |
| Video rendering | ECS Fargate one-off task, image in ECR (never Lambda: it would hit the runtime limit) |
| Render workflow | Step Functions runs the Fargate task and waits for it. On a failure or timeout it marks the render failed, gives the visitor their render back, and raises an alert |
| Sign-in | Cognito user pool (admin-created users, groups for roles, JWT verification in the API) |
| Usage limits and rate limits | DynamoDB: one item per account with atomic conditional updates, and self-expiring per-minute counters (time-to-live) |
| Alerts | SNS topic plus CloudWatch alarms (a failed render workflow, a burst of API 5xx errors) |
| AI-voice fallback | Amazon Polly, Kajal voice (Indian English and Hindi) |
| Infrastructure | One SAM/CloudFormation template: `backend/template.yaml` |

**What is not on AWS, honestly:** script generation uses Google Gemini and transcription uses Whisper large-v3 through Groq. Each sits behind one small module (`backend/src/lib/llm`, `backend/src/lib/transcribe`) so it can be swapped in one place. Bedrock is not available on this AWS account, and AWS Transcribe was tried first and replaced because it mangled code-switched Hindi and English (findings in `PROGRESS.md`). The production plan is a self-hosted Whisper on AWS.

**Why not CloudFront:** this account can't create CloudFront resources until AWS verifies it, so the frontend is served from Lambda instead. It is still https, which the camera and screen capture require.

## Read more

| Document | What is in it |
|---|---|
| [`docs/FEATURES.md`](docs/FEATURES.md) | Every feature, where to find it in the app, and what it is built with |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The pipeline stage by stage, the render workflow, data contracts, access control |
| [`docs/SYNC_ALGORITHM.md`](docs/SYNC_ALGORITHM.md) | The two-pointer match that times every cut |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Accounts and limits, running it locally, deploying, operational limits |
| [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md) | Working on Vaani on your own laptop |
| [`PROGRESS.md`](PROGRESS.md) | The build log: what was tried, what changed and why |

## Repo map

```
├── shared/     Zod schemas (the single source of truth for every API and stored shape),
│               formats, themes, layout and visual design shared by the renderer and the browser preview
├── backend/    Lambda handlers, script generation, sync, transcription, local dev server,
│               template.yaml, site/ (the Lambda that serves the web app)
├── frontend/   React 19 + Vite + Tailwind v4 + shadcn: landing page, dashboard (/app), studio (/app/studio)
├── render/     Fargate worker: Playwright frames, ffmpeg assembly, face bubble, demo clips
├── docs/       features, architecture, sync algorithm, operations, local development, scope plan, hackathon rules
├── CLAUDE.md   decisions that were locked on purpose, for the coding agent
└── PROGRESS.md the build log
```
