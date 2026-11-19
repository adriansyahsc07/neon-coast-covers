// Neon Coast Cover Studio — hand-in program for gta6-cover-art-01.
// Written for this entry: it gathers the finished pieces (the offline
// web app under app/ and the four review screenshots under screenshots/),
// drops them into the output directory the grader points at, and asks
// the vendored make.fun library to summarise the lot as dossier.json.
// Node 22, standard library only. Run it with:
//   MAKEFUN_OUTPUT_DIR=/tmp/cover-out node main.ts
// Local preview of the app itself lives in serve.ts (`node serve.ts`).

import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-app.ts";

const rootDir = dirname(fileURLToPath(import.meta.url));
const targetDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

function copyTree(name: string): void {
  const from = join(rootDir, name);
  if (!existsSync(from)) return;
  cpSync(from, join(targetDir, name), { recursive: true });
}

mkdirSync(targetDir, { recursive: true });
copyTree("app");
copyTree("screenshots");

// Caps mirror the grader's own gate so a bad hand-in fails here first,
// on my machine, instead of failing quietly on the server.
const dossierBytes = buildDossier(targetDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 50331648,
  app_path_max_bytes: 1000,
});
writeFileSync(join(targetDir, "dossier.json"), dossierBytes);
console.log(`dossier.json written to ${targetDir} (${dossierBytes.length} bytes)`);
