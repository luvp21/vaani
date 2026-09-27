# Hackathon rules that actually matter for this build

Full rules: wemakedevs.org/aws/first-commit/rules. This is the condensed version, the parts that can cost you the submission or a prize if missed.

## Event basics

- **First Commit**, WeMakeDevs x AWS, Bharat Builds Tour, event 1 of 6
- Online: Sept 17–20, anywhere in India. Optional in-person day: Sat Sept 19, Polaris School of Technology, Bangalore
- **Submission deadline: Sunday, Sept 20, extended by the organisers from 8:00 PM IST to 12:00 AM (midnight) IST** (check the hackathon page for the final time)
- Team: **codeDKFYDK / cosmosapiens** — Luv Patel (leader), Poorvanshi Kochar

## What disqualifies a team (not just costs points)

- **Old projects don't count.** Must be new code written after the clock started (Thu Sept 17). A repo whose history doesn't match the event dates disqualifies the whole team. This is why the AssemblyAI hackathon idea was kept as a separate, fresh build rather than merged with this one.
- Copying someone else's work or passing an old project off as new
- Judges score **only what's submitted** — no live demo, no call. If the demo video doesn't show a feature, it doesn't count, even if the writeup mentions it.

## Submission requirements

A submission is three things:
1. A **public repository**
2. A **demo video**, up to 3 minutes, uploaded to YouTube, public or unlisted, **checked to open in a signed-out browser before submitting**
3. A short **writeup**: the problem, the build, and where AWS fits

One submission per team, on the hackathon's own submission form, before the deadline. The form closes hard at the deadline — no late entries.

## Judging criteria (what to actually optimize for)

1. **Idea and impact** — is it a real problem, does it matter
2. **Built on AWS** — mandatory to win a prize; Ship It is judged on architecture and cost decisions too
3. **Learning** — what did you learn you didn't know Thursday
4. **Execution** — does it work, not does it look impressive on paper. "One feature that runs beats five that almost do."
5. **The demo video** — since there's no live demo, this is what judges actually see

## Track

This project is deployed on AWS: API Gateway and Lambda, S3, ECS Fargate with ECR for rendering, Polly for the fallback voice, all defined in one SAM/CloudFormation template. Script generation (Gemini) and transcription (Whisper via Groq) are not AWS services; each sits behind one small module so it can be swapped. That makes this a **Ship It** submission, not Build It, and the writeup should say plainly which parts are and are not on AWS.

## Prizes (context, not the point, but good to know)

- Ship It grand prize: ₹2,00,000 + $3,000 AWS credits
- Build It: ₹1,50,000 + $2,000 AWS credits
- Best UI: ₹1,00,000 + $1,000 AWS credits (open to either track — this project's whole pitch is visual polish, worth keeping in mind)
- Four runners-up: $1,000 AWS credits each, every submission is automatically in the running
- Top 5 blogs about the build: Logitech gaming keyboard each

## Fast-track Amazon interview

- Up to 10 per hackathon put forward, not a guarantee
- Only for **Pre-Final Year (2028) and Final Year (2027)** students — check both members' eligibility
- Winning a track prize does not grant this, and not winning doesn't exclude you — separate decision, separate criteria
- Depends on registration details and Builder Center profile being correct and verified **before** the hackathon — this is a reason to get the AWS/Builder Center setup done early, not last-minute

## Money/setup logistics

- AWS credit form: **$100 in credits, one form per team, filled by the team leader only**. Debit cards and RuPay accepted for a new AWS account; verification charge is about ₹2.
- **First Commit check-in is separate from Bharat Builds Tour registration** — both members need to have done the check-in specifically for this event, not just the tour.
