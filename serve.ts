// Neon Coast Cover Studio — pocket static server for local previews.
// Serves the app/ folder on http://localhost:8080 with `node serve.ts`
// (pass --port <n> to change the port). Node 22 standard library only.
// It refuses to serve anything outside app/ and sends no-store caching
// headers so edits show up on a plain refresh.

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(fileURLToPath(new URL("./app", import.meta.url)));

const argv = process.argv.slice(2);
const flagAt = argv.indexOf("--port");
const wanted = flagAt >= 0 ? Number(argv[flagAt + 1]) : 8080;
const port = Number.isInteger(wanted) && wanted > 0 && wanted < 65536 ? wanted : 8080;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer((req, res) => {
  let pathPart: string;
  try {
    pathPart = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  } catch {
    res.writeHead(400).end("bad request");
    return;
  }
  if (pathPart.endsWith("/")) pathPart += "index.html";
  const filePath = resolve(join(appRoot, "." + pathPart));
  if (filePath !== appRoot && !filePath.startsWith(appRoot + sep)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  let size: number;
  try {
    const info = statSync(filePath);
    if (!info.isFile()) throw new Error("directory");
    size = info.size;
  } catch {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    "content-length": size,
    "cache-control": "no-store",
  });
  createReadStream(filePath).pipe(res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Neon Coast Cover Studio running at http://localhost:${port}`);
});
