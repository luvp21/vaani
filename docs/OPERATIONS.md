# Operations

How the app is run: who can sign in and what each account may do, how to run it on a laptop, how it is deployed, and its operational limits. This is the material that is not about the product itself. For what Vaani does, see the [README](../README.md) and [`FEATURES.md`](FEATURES.md).

## Accounts and access

Sign-in is **Amazon Cognito**. There are two ways in: three fixed users created by an administrator (below), and optionally **"Continue with Google"**, which needs Google credentials (see "Google sign-in"; it is on in the live deployment). Nobody can register with a password: the pool only allows administrator-created users. The fixed users are made by `node backend/scripts/provision-users.mjs` (plain passwords for the two testers go to the git-ignored `backend/.accounts.txt`; the judge has no password).

| Account | Sees | Can do |
|---|---|---|
| `tester1`, `tester2` (shared in the blog) | only their own project, after signing in at `/sign-in` | **one video of at most 3 minutes** (one render in total, given back if it fails), plus 5 script drafts and 3 script locks |
| Google accounts ("members", when switched on) | only their own project | the same as a tester, each with their own allowance: **one video of at most 3 minutes** each |
| `tester3` and any other `--team` account (private, for us) | only their own project | **no limits**: no allowance, no length cap, higher rate limits |
| `judge` (private) | the whole site: landing page, every account's projects and videos | no limits. Signs in by opening a **private link** (`/j/<key>`), so judges need no password |

How it fits together:
- **Tokens.** The tester or judge gets a Cognito ID token (one hour) and a refresh token; the app renews the ID token quietly. Testers' refresh tokens last a day, the judge's 30 days (two app clients, one per kind of session).
- **Roles** come from Cognito groups (`tester`, `judge`). Every API call verifies the token's signature, issuer, audience and expiry, then checks that the project belongs to the caller, then the quota. A project that isn't yours answers 404, the same as one that doesn't exist. Hiding pages in the UI is only a convenience (the page code is in the public bundle); the data is what's protected.
- **The judge link** is checked by our Lambda before Cognito is involved (the key is derived from `AUTH_SECRET`). If it is right, the Lambda gives the `judge` user a fresh random password and signs in with it, so the judge's Cognito password is never known to anyone and a wrong key can never lock the judge out. `node backend/scripts/judge-link.mjs <site-url> --save` writes the link to `.accounts.txt`; rotating `AUTH_SECRET` (then redeploying) replaces it. Anyone holding the link is the judge, so keep it out of the blog and screenshots. Opening it removes the key from the address bar, and pages send no referrer.
- **Length limit.** Every account except the judge and the team accounts makes one video of at most 3 minutes, enforced on the server at three points, all before any quota is spent: drafting (the target length is capped at 3 minutes, and a pasted script can't be over about 3 minutes of speech), locking (the script after edits must still fit) and rendering (the recorded speech, taken from the transcript timing, must fit). A little slack is allowed because 135 words a minute is an average.
- **Rate limits.** Per account, per minute, counted in DynamoDB: 30 calls on routes that spend money (Gemini, Groq, Polly, Fargate) and 120 on everything else (the judge gets five times that); sign-in attempts are limited per IP address (10 a minute); and everyone except the judge shares a cap of 40 renders a day. A refused call says how long to wait. If the counter itself is unavailable, calls go through rather than breaking the app.
- **Password sign-in refuses the `judge` username** before asking Cognito, because Cognito locks a user out after a few wrong passwords.

**Google sign-in.** It goes through Cognito's hosted page (authorization code flow with PKCE, `state` checked on return). To switch it on: create an OAuth client in Google Cloud Console (type Web application) with the redirect URI from the stack output `GoogleRedirectUri`, then deploy with `GoogleClientId=... GoogleClientSecret=...`. The stack then creates the Cognito domain, the Google identity provider and a web app client, and the sign-in page shows the button. Someone who signs in this way belongs to no group; being federated is what makes them a `member`. All the limits above apply to each of them, so every Google account gets one video, and the shared daily cap of 40 renders bounds the total.

**What is public.** The landing page (`/`) is open to everyone. Everything that does something is behind sign-in: `/app` (the dashboard), `/app/studio` (making a video) and every API call except sign-in itself. Signed-out visitors who open a protected page are sent to `/sign-in`. To make more team accounts: `node backend/scripts/provision-users.mjs --add tester4`, then `--team tester4`.

Reset a tester after a demo: `aws dynamodb delete-item --table-name vaani-backend-usage --key '{"username":{"S":"tester1"}}'`.

## Run it locally

> Working on Vaani on your own laptop (frontend only against the live backend, or the whole stack)? See [`docs/LOCAL_DEV.md`](LOCAL_DEV.md).

Needs Node 24, an AWS account with credentials configured (`aws configure`), and API keys for Gemini and Groq. Rendering locally also needs `ffmpeg` and Playwright's Chromium (`npx playwright install chromium`).

```bash
npm install
cp backend/.env.example backend/.env     # fill in S3_BUCKET, GEMINI_API_KEY, GROQ_API_KEY
# after the first deploy: put the stack outputs UserPoolId, TesterClientId, JudgeClientId in .env as
# USER_POOL_ID, TESTER_CLIENT_ID, JUDGE_CLIENT_ID, set AUTH_SECRET (any 32+ random characters), then:
node backend/scripts/provision-users.mjs  # creates the Cognito users
npm run dev:backend                       # http://localhost:4000
npm run dev:frontend                      # http://localhost:5173  (proxies /api to the backend)
```

Set `RENDER_MODE=local` in `backend/.env` to run the render worker from your checkout instead of on Fargate. That way a render can't run older code than the app you're testing.

```bash
npm test --workspace backend             # 99 tests: sync, script generation, transcription, layout and themes, access control, quotas, render failure handling
```

## Deploy

```bash
npm run build:site                        # builds the frontend into backend/site/dist
cd backend
export PATH="$PWD/../node_modules/.bin:$PATH"   # sam build needs esbuild
sam build
sam deploy --stack-name vaani-backend --region us-east-1 --resolve-s3 \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --parameter-overrides GeminiApiKey=... GroqApiKey=... AuthSecret=... AlertEmail=you@example.com GoogleClientId=... GoogleClientSecret=... VpcId=... SubnetIds=subnet-a,subnet-b
```

Then build and push the render image. Do this again after any change under `render/` or `shared/`, because Fargate runs whatever is in ECR:

```bash
docker build -f render/Dockerfile -t <account>.dkr.ecr.<region>.amazonaws.com/vaani-render:latest .
docker push <account>.dkr.ecr.<region>.amazonaws.com/vaani-render:latest
```

Pass **every** parameter on every deploy: a parameter left out reverts to its default, which for the Google ones removes the Cognito Google resources. Deploy output echoes parameter overrides, so redact keys before sharing a log.  `GithubToken` is an optional parameter that lifts GitHub's unauthenticated limit.

## Known limits

- **No password sign-up.** Sign-in is two shared tester accounts, one judge account, and (when switched on) Google. Whoever uses a shared tester account sees the same project. A tester whose render fails is given it back automatically; an operator can also reset one by deleting their row in the usage table.
- **GitHub ingest** uses one unauthenticated API request per repo (60 an hour per IP, shared on Lambda) unless `GithubToken` is set. Repos are cached for 15 minutes.
- **Lambda concurrency is 10** on this account (the default for a new one), so more than about ten requests in flight at once get a 503. Status polling is short, but a few people drafting scripts at the same time can reach it. Raising it needs an AWS Support case (Service limit increase, Lambda, Concurrent executions); the Service Quotas API refuses because the applied value is below the default.
- **API Gateway's 30 second limit** applies to every call, so transcription runs in the background and long scripts are written scene by scene.
- **A voice bot's replies aren't captured** in demo clips (no tab audio yet); show its text on screen.
- **Charts are bar charts only.** No line or pie charts yet; a slide can also show numbers as a table, stat cards or inline bars.
- **Not built:** auto-zoom on clicks, a post-recording timeline editor, trimming a section out of a recorded clip (pause while recording instead), Hindi in Devanagari, deleting or renaming a project.
