# Working on Vaani on your own laptop

Pick the mode that matches what you are changing. Most changes only need the first.

| I want to change... | Use | You need |
|---|---|---|
| The web app (pages, components, styling, copy) | **Mode A**: local frontend, live backend | Node and the repo. No AWS access, no API keys |
| The API, script generation, sync, render, limits | **Mode B**: everything local | Node, AWS access, Gemini and Groq keys, ffmpeg for renders |

Either way you do not need to deploy anything. Deploying (`sam deploy`, the Fargate image) is done by whoever owns the AWS account.

## Both modes

- **Node 24** and **git**. Check with `node -v`.
- Clone the repo and install once from the top folder (it is an npm workspace, so one install covers `shared`, `backend`, `frontend` and `render`):

```bash
git clone <the repo url>
cd <the repo folder>
npm install
```

## Mode A: frontend only, against the live backend

```bash
API_PROXY_TARGET=https://<the live site address> npm run dev:frontend
```

Open http://localhost:5173. The dev server forwards `/api/...` to the live backend, so sign-in, drafting and rendering all work for real.

- **Sign in with** the team account you were given (unlimited). "Continue with Google" also works from localhost.
- Your changes to files under `frontend/src` show up instantly. Nothing you do here changes the live site: only a deploy does.
- You are using the real backend, so what you create is real data (it shows on the judge's dashboard) and counts towards the shared rate limits.
- You can't change or test backend behaviour in this mode. Use Mode B for that.

Set it once instead of every time by putting this line in a file called `frontend/.env.local` (git-ignored, works on every system, including Windows):

```
API_PROXY_TARGET=https://<the live site address>
```

An `API_PROXY_TARGET` set on the command line wins over the file. On Windows use `set API_PROXY_TARGET=...&& npm run dev:frontend` for a one-off.

**If sign-in fails and the terminal says something like `USAGE_TABLE env var is not set`,** the frontend is talking to a backend on your own laptop (`localhost:4000`, the default when `API_PROXY_TARGET` is not set) that has no AWS settings. Either set `API_PROXY_TARGET` as above, or stop `npm run dev:backend` if you didn't mean to run it.

## Mode B: the whole thing on your laptop

The local backend (`npm run dev:backend`, port 4000) is the same code the Lambdas run. It still talks to **real AWS** (S3, DynamoDB, Cognito, Polly), so it needs access and settings.

### 1. What you need

- **AWS access.** Ask the account owner for an IAM user for you (access key id and secret). Do not reuse someone's admin keys. Minimum policy (fill in the values from the stack outputs; the bucket is `vaani-ai-<account id>-us-east-1`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::<BUCKET>", "arn:aws:s3:::<BUCKET>/*"] },
    { "Effect": "Allow", "Action": ["dynamodb:GetItem", "dynamodb:UpdateItem"],
      "Resource": "arn:aws:dynamodb:us-east-1:<ACCOUNT_ID>:table/vaani-backend-usage" },
    { "Effect": "Allow", "Action": ["cognito-idp:AdminInitiateAuth"],
      "Resource": "arn:aws:cognito-idp:us-east-1:<ACCOUNT_ID>:userpool/<POOL_ID>" },
    { "Effect": "Allow", "Action": ["polly:SynthesizeSpeech"], "Resource": "*" }
  ]
}
```

  Then `aws configure` (or export `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`), region `us-east-1`.
- **A Gemini API key** (Google AI Studio) and a **Groq API key** (console.groq.com). Free tiers are enough for development.
- **For renders on your laptop:** `ffmpeg` on your PATH, then `npx playwright install chromium`.

### 2. Settings

```bash
cp backend/.env.example backend/.env
```

Then fill in `backend/.env`. The owner can give you the values; the ones marked (stack output) come from the deployed stack:

| Setting | Where it comes from |
|---|---|
| `S3_BUCKET`, `USAGE_TABLE` | stack outputs `BucketName`, and `vaani-backend-usage` |
| `USER_POOL_ID`, `TESTER_CLIENT_ID`, `JUDGE_CLIENT_ID` | stack outputs |
| `WEB_CLIENT_ID`, `COGNITO_DOMAIN` | only needed to try Google sign-in locally |
| `SITE_URL` | `http://localhost:5173` |
| `GEMINI_API_KEY`, `GROQ_API_KEY` | your own keys |
| `AUTH_SECRET` | only needed for the private judge link; leave it as a random 32+ character string of your own if you don't use that link |
| `RENDER_MODE` | set to `local` so a render runs on your laptop, not on AWS |

### 3. Run it

```bash
npm run dev:backend      # http://localhost:4000  (rebuilds shared, restarts on changes)
npm run dev:frontend     # http://localhost:5173  (a second terminal)
```

Sign in with a team account. Locally you use the real user pool, so the same accounts work.

### Things to know about Mode B

- **It shares data with the live app.** Your local projects, recordings and usage counters go into the same S3 bucket and DynamoDB table. Clean up test projects, and don't run tests against the tester accounts. If that is a problem, ask the owner to deploy a separate stack for you (`sam deploy --stack-name vaani-dev` with its own parameters); it costs almost nothing.
- **The AI keys are yours.** Local script generation and transcription use your Gemini and Groq quota, not the project's.
- **Never commit** `backend/.env`, `backend/.accounts.txt` or any keys. They are git-ignored; keep it that way.

## Making a change

```bash
git switch -c my-change            # work on a branch, not on main
# ...edit...
npm test --workspace backend       # the backend test suite (about 100 tests)
npx tsc --noEmit -p backend        # type-check the backend
(cd frontend && npx tsc -b)        # type-check the frontend
git add -A && git commit -m "feat: what changed"
git push -u origin my-change       # then open a pull request
```

Where things live: `shared/` holds the schemas everything else uses (change a shape there first), `backend/src/lib` the logic, `backend/src/handlers` the API routes, `frontend/src` the app, `render/` the video worker. `README.md` and `docs/ARCHITECTURE.md` explain how it fits together (`docs/OPERATIONS.md` covers accounts, deploys and limits), and `CLAUDE.md` lists decisions that were made on purpose.
