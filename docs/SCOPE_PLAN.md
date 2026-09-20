# Scope plan

**Status, Sunday Sept 20 (evening).** Every must-have is built and deployed, along with the good-to-haves that were picked up (slide themes and richer slides, the redesigned dashboard and Studio, the landing page). The whole pipeline runs on the live app with a real recording, the Polly fallback works, and a light-theme render was checked on Fargate after the last deploy. Remaining today: the demo video, the writeup, making the repo public and submitting. `PROGRESS.md` has the detailed log. The plan below is the original one, with what is done ticked. Where it changed: the LLM is Gemini and transcription is Whisper (not Bedrock and Transcribe), the only Step Functions state machine is the render workflow, and screen recording became one silent clip per demo step.

Deadline: **Sunday, Sept 20, 8:00 PM IST**, submission form on the hackathon's own page. No live demo — judges only see what's in the submission, so the demo video and the writeup matter as much as the code.

This plan assumes today is **Friday, Sept 18** (day 2 — kickoff was Thursday, and idea/architecture work is already done as of writing this). Adjust dates if you're reading this later than expected.

## Friday (today) — setup + fallback path

- [x] AWS account credit form submitted (one per team, team leader only, ~₹2 verification charge) — do this *tonight*, not tomorrow
- [ ] First Commit check-in confirmed for both members (separate from tour registration — easy to miss)
- [ ] AWS Builder Center profiles verified for both members
- [ ] Task split agreed (see `docs/TASK_SPLIT.md`)
- [x] Repo ingest working (stage 1)
- [x] Script generation working, in Hinglish, with beat tagging (stage 2)
- [x] Basic script review UI (stage 3)

**End-of-day target:** you can paste a repo URL and get back a locked, beat-tagged Hinglish script.

## Saturday — the fallback video, then the real differentiator

Morning (whether or not you're at the Bangalore venue):
- [x] Visual generation working per beat (stage 4)
- [x] Polly Kajal narration wired up
- [x] **Fallback video complete, end to end**: repo → script → visuals → AI narration → finished video

This is your insurance. Once this exists, everything below is upside, not risk.

Afternoon/evening:
- [x] Teleprompter recording UI: webcam capture, scene by scene
- [x] Tab-picker capture wired up for UI-demo scenes (if attempting that feature)
- [x] Transcription integration (Whisper via Groq), word-level timestamps confirmed working on a real test recording
- [x] Two-pointer sync algorithm built and unit-tested against a fake transcript with a deliberate stutter and a deliberate dropped word (see `docs/SYNC_ALGORITHM.md`) — **before** wiring it to anything real

**End-of-day target:** the sync algorithm passes its own test in isolation, even if it's not hooked up to the real render yet.

## Sunday — integration, polish, submission

Morning:
- [x] Sync algorithm wired to a real recorded scene, checkpoints verified against actual timestamps
- [x] Render stage: visuals switch at checkpoint timestamps, full-screen face vs. overlay
- [x] Full pipeline run, start to finish, with real recorded voice

Early afternoon (cut off good-to-haves by ~2–3 PM IST regardless of how it's going):
- [x] Good-to-haves from `docs/FEATURES.md` picked up once the must-haves were done: slide themes and richer slides, dashboard and Studio redesign (the rest is under "Not built yet" in that file)

Late afternoon:
- [ ] Record the actual 3-minute demo video (remember: **the video is what judges see, there's no live demo**)
- [ ] Write the submission writeup (problem, build, where AWS fits — required fields)
- [ ] Public repo pushed, README current
- [ ] Submit before 8:00 PM IST — don't wait until the last hour, the form closes hard at the deadline

## Rule for the whole weekend

If something on the must-have list isn't done, no one touches a good-to-have item, no matter how tempting. A finished, submitted must-have list beats an impressive but broken good-to-have.
