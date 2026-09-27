import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { brotliCompressSync, brotliDecompressSync, gunzipSync } from "node:zlib";

// The handler is plain .mjs (zipped as-is for Lambda), loaded here at runtime.
const siteDir = path.resolve(import.meta.dirname, "../../site");
const distDir = path.join(siteDir, "dist");
const site = (await import(path.join(siteDir, "index.mjs"))) as {
  handler: (e: { rawPath: string; headers?: Record<string, string> }) => Promise<{
    statusCode: number;
    headers: Record<string, string>;
    body: string;
    isBase64Encoded: boolean;
  }>;
  resolveFile: (p: string) => { full: string; file: string } | null;
};

const created: string[] = [];
before(() => {
  mkdirSync(path.join(distDir, "assets"), { recursive: true });
  for (const [rel, body] of [
    ["index.html", "<html>app</html>"],
    ["assets/app-abc123.js", "console.log('hi')"],
    ["logo.png", "png-bytes"],
    ["assets/pre-def456.js", "console.log('pre')"],
  ] as const) {
    const full = path.join(distDir, rel);
    if (!existsSync(full)) {
      writeFileSync(full, body);
      created.push(full);
    }
  }
});
before(() => {
  // The build step (backend/site/precompress.mjs) leaves a .br file next to a text file.
  const br = path.join(distDir, "assets/pre-def456.js.br");
  if (!existsSync(br)) {
    writeFileSync(br, brotliCompressSync(Buffer.from("console.log('pre')")));
    created.push(br);
  }
});
after(() => {
  for (const file of created) rmSync(file, { force: true });
});

const get = (rawPath: string, acceptEncoding = "") =>
  site.handler({ rawPath, headers: acceptEncoding ? { "accept-encoding": acceptEncoding } : {} });

test("the root and app routes (no extension) serve index.html, so deep links work", async () => {
  for (const p of ["/", "/app", "/app/studio/abc-123"]) {
    const res = await get(p);
    assert.equal(res.statusCode, 200, p);
    assert.match(res.headers["content-type"], /text\/html/);
    // Whatever index.html is in site/dist (a real build, or the stub made above).
    assert.equal(Buffer.from(res.body, "base64").toString(), readFileSync(path.join(distDir, "index.html"), "utf8"));
    assert.equal(res.headers["cache-control"], "no-cache", "index.html must be re-checked so a deploy shows up");
  }
});

test("fingerprinted assets are cached for a year and gzip when the browser accepts it", async () => {
  const res = await get("/assets/app-abc123.js", "gzip, deflate, br");
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["cache-control"], /immutable/);
  assert.equal(res.headers["content-encoding"], "gzip");
  assert.equal(gunzipSync(Buffer.from(res.body, "base64")).toString(), "console.log('hi')");
  const plain = await get("/assets/app-abc123.js");
  assert.equal(plain.headers["content-encoding"], undefined);
  assert.equal(Buffer.from(plain.body, "base64").toString(), "console.log('hi')");
});

test("a browser that accepts br gets the precompressed file; others fall back to gzip or plain", async () => {
  const withBr = await get("/assets/pre-def456.js", "gzip, deflate, br");
  assert.equal(withBr.headers["content-encoding"], "br");
  assert.equal(withBr.headers.vary, "accept-encoding");
  assert.equal(brotliDecompressSync(Buffer.from(withBr.body, "base64")).toString(), "console.log('pre')");
  const gzipOnly = await get("/assets/pre-def456.js", "gzip");
  assert.equal(gzipOnly.headers["content-encoding"], "gzip");
  assert.equal(gunzipSync(Buffer.from(gzipOnly.body, "base64")).toString(), "console.log('pre')");
  const noBr = await get("/assets/app-abc123.js", "gzip, deflate, br");
  assert.equal(noBr.headers["content-encoding"], "gzip", "no .br file, so it falls back to gzip");
});

test("binary files are not gzipped", async () => {
  const res = await get("/logo.png", "gzip");
  assert.equal(res.headers["content-type"], "image/png");
  assert.equal(res.headers["content-encoding"], undefined);
});

test("a missing file with an extension is a 404, not index.html", async () => {
  assert.equal((await get("/assets/nope.js")).statusCode, 404);
});

test("paths that try to escape the site folder never leave it", () => {
  for (const p of ["/../../etc/passwd", "/..%2f..%2fetc/passwd", "/assets/../../../secret.js", "/a\0b.js", "/%E0%A4%A"]) {
    const target = site.resolveFile(p);
    assert.ok(target === null || target.full.startsWith(distDir + path.sep), `${p} escaped: ${target?.full}`);
  }
});

test("pages never send a referrer, so the judge link's key can't leak to another site", async () => {
  const res = await get("/j/some-key");
  assert.equal(res.statusCode, 200, "the judge link route serves the app");
  assert.equal(res.headers["referrer-policy"], "no-referrer");
});
