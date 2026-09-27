// Makes a Brotli copy (`<file>.br`) of every text file in site/dist, once, at
// build time. The site Lambda serves it to browsers that accept br (see
// index.mjs). Run by `npm run build:site` after the frontend is copied in.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { brotliCompressSync, constants } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
const TEXT = /\.(html|js|mjs|css|json|svg|txt)$/i;

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else yield full;
  }
}

let before = 0;
let after = 0;
let count = 0;
for await (const file of files(DIST)) {
  if (!TEXT.test(file)) continue;
  const raw = await readFile(file);
  const packed = brotliCompressSync(raw, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length },
  });
  await writeFile(`${file}.br`, packed);
  before += raw.length;
  after += packed.length;
  count += 1;
}
console.log(`brotli: ${count} files, ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`);
