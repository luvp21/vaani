# Features

Everything Vaani does today, where to find it in the app, and what it is built with. The live app is at https://10jlhtgcih.execute-api.us-east-1.amazonaws.com. How the pieces fit together is in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## From a repo to a script

| Feature | What it does | Where to find it | Built with |
|---|---|---|---|
| Repo ingest | Reads any public GitHub repo: the README, the package files and a capped sample of source files, with one API request per repo (cached for 15 minutes) | Studio, step 1 (Repo) | Lambda, GitHub API, S3 |
| Five video formats | Code walkthrough, hackathon demo, product demo, architecture overview, launch teaser. Each has its own scene outline, tone and mix of visuals | Studio, "What kind of video?" | Gemini |
| English or Hinglish | Hinglish is written the way Indian developers talk, in Latin letters, with English terms kept. English is plain conversational English | Studio, "Script language" | Gemini, with example lines for each language |
| Written to be spoken | Short sentences, plain words, no dashes or hype. The output is checked against these rules and retried | Automatic | Prompt rules and a check on the result |
| Target length | 30 seconds to 5 minutes, planned to a word budget at about 135 spoken words a minute | Studio, "How long should it be?" | Two-step generation: plan the scenes, then write each one |
| Your notes | Audience, purpose and real numbers, used as given and never invented | Studio, "Tell Vaani about it" | Gemini |
| Bring your own script | Paste your narration. Vaani keeps your words and builds the visuals around them | Studio, "Already have a script?" | Gemini |

## Review before you record

| Feature | What it does | Where to find it | Built with |
|---|---|---|---|
| Edit the script | Change any word or scene title | Studio, step 2 (Script) | React |
| Regenerate a visual | "Regenerate visual" or "Update visual to match" rebuilds one beat's visual from its new wording | Studio, Script | Gemini |
| Rewrite a scene | "Rewrite scene" rebuilds a whole scene's beats and visuals from text you edited, keeping your wording | Studio, Script | Gemini, with a check that the wording is kept |
| Live preview | Shows the same frames the renderer makes, including the entrance animation | Studio, Script | Shared HTML and CSS in `shared/`, shown scaled in an iframe |
| Dark or light slides | Dark is an editor-style look. Light uses this website's colors and monospace type. Applies to slides, diagrams, charts, code and the bottom bar | Studio, Repo and Script steps ("Slide theme") | CSS variables, Geist Mono embedded in the frame |
| Lock | Saves the script so recording and rendering read from one fixed version | Studio, Script, "Lock script" | S3 |

## Visuals

| Feature | What it does | Built with |
|---|---|---|
| Code | Syntax-highlighted code with the lines that matter lit and the rest dimmed | Shiki |
| Statement slide | One big line, for a hook or a closing | Shared HTML and CSS |
| Bullet points | Three to five short points with the key term in bold | Shared HTML and CSS |
| Table | Up to five rows and four columns, numbers aligned | Shared HTML and CSS |
| Stat cards | Two to four big numbers with a caption | Shared HTML and CSS |
| Two columns | Before and after, or this against that | Shared HTML and CSS |
| Inline bars | A small bar graph inside a slide | Shared HTML and CSS |
| Architecture diagram | Three to seven components that really exist in the repo, with labeled arrows and the key one highlighted | Shared SVG layout |
| Bar chart | Real numbers only, with the source shown | Shared HTML and CSS |
| Product demo | Your own screen clip, framed and sped up to fit the narration | Browser screen capture, ffmpeg |

The script picks the block that fits what is being said, one per slide, and never invents numbers.

## Record in your own voice

| Feature | What it does | Where to find it | Built with |
|---|---|---|---|
| Teleprompter, scene by scene | Read each scene from the prompter. Retake as often as you like before keeping a take | Studio, step 3 (Record) | `getUserMedia`, MediaRecorder |
| Pop-out prompter | The prompter in its own window, so it can sit next to your camera | Record, "Pop out prompter" | Browser window API |
| Product-demo clips | One silent screen clip per demo step, recorded apart from your narration, so the app you show can use the microphone. Pause through waiting and retake one step | Record, "Demo clips for this scene" | `getDisplayMedia` |
| Direct upload | Recordings go from your browser straight to storage | Automatic | S3 presigned URLs |
| Your face in the video | A round camera bubble, bottom-right, on every scene | Automatic | ffmpeg |

## Cuts land on your words

| Feature | What it does | Where to find it | Built with |
|---|---|---|---|
| Transcription | A timestamp for every word you said, in the background | Automatic after each scene | Whisper large-v3 (through Groq) |
| Two-pointer sync | Matches the script you read against what you said, so every visual cuts in on the right word. Stutters, repeats and filler words don't shift a cut | Studio, step 4 (Sync), "Sync my voice to the script" | Plain code, see [`SYNC_ALGORITHM.md`](SYNC_ALGORITHM.md) |

## The finished video

| Feature | What it does | Where to find it | Built with |
|---|---|---|---|
| Render | 1280x720 video: visuals switch at your words, your voice on the audio, your face on top | Studio, step 5 (Video) | Step Functions, ECS Fargate, Playwright, ffmpeg |
| Clip fitting | A demo clip longer than its narration is sped up to fit and ends on its last frame; a shorter one holds its last frame | Automatic | ffmpeg |
| Watch and download | Plays in the app, with an MP4 download | Studio, Video, and the dashboard | S3 presigned URL |
| AI-voice fallback | If you can't record, an AI voice reads the same script and the same video is made from it | Studio, Sync, "Prefer an AI voice?" | Amazon Polly, Kajal voice |
| Failure handling | A failed render is marked failed, the visitor's render is given back and an alert is raised | Automatic | Step Functions, DynamoDB, SNS, CloudWatch |

## The workspace

| Feature | What it does | Where to find it |
|---|---|---|
| Dashboard | A progress bar across the top shows the five steps and the next action ("Record scene 2 of 3"). A stat row shows videos left, in progress and finished. Every project is a card showing where it stands | `/app` |
| Watch dialog | A finished video plays right on the dashboard | `/app`, "Watch" on a finished project |
| Studio | A horizontal stepper across the top, a compact header naming the repo, and a repo form with a live summary and the Draft button beside it | `/app/studio` |
| Reopen anywhere | Any project opens at the right step | `/app`, then a project |
| Landing page | Explains the idea, with a hero demo and an interactive explainer of the sync | `/` |

## Sign-in and fair use

| Feature | What it does |
|---|---|
| Sign-in | Amazon Cognito, plus "Continue with Google". Judges use a private link and need no password |
| One video of up to 3 minutes | Every visitor account gets one video of at most 3 minutes, checked on the server when drafting, locking and rendering |
| Private projects | Each account sees only its own projects. The judge account sees all of them |
| Rate limits | Per account and per minute, with a shared daily cap on renders, so the live demo stays affordable |

Details of accounts, roles and limits are in [`OPERATIONS.md`](OPERATIONS.md).

## Not built yet

- Auto-zoom on clicks in product demos
- A timeline editor after recording (nudging cuts, trimming clips)
- Line and pie charts (bars, tables, stat cards and inline bars are there)
- Captions burned into the video (the word timestamps are already there)
- Other aspect ratios such as 9:16
- Hindi in Devanagari script (English and Hinglish in Latin letters only)
- Deleting or renaming a project
- Tab audio in demo clips, so a voice bot's replies are not captured (show its text on screen)

One thing is left out on purpose: Vaani never drives the app you are demoing. Screen sharing is done by you, so the demo stays real and nothing can break because of automation.
