import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The console only needs service addresses and the database name from .env.
let envFile = "";
try {
  envFile = readFileSync(resolve(process.cwd(), ".env"), "utf8");
} catch {
  /* Defaults work locally. */
}
function setting(name: string, fallback: string) {
  if (process.env[name]) return process.env[name] as string;
  const entry = envFile.split(/\r?\n/).find((line) => line.trim().startsWith(name + "="));
  const value = entry
    ?.slice(entry.indexOf("=") + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2");
  return value || fallback;
}
const port = Number(setting("DEMO_PORT", "4173"));
const database = setting("SPACETIME_DATABASE", "pawsafe");
const targets: Record<string, string> = {
  agent: setting("AGENT_SERVICE_URL", `http://127.0.0.1:${setting("PORT", "8080")}`),
  db: setting("SPACETIME_URI", "http://127.0.0.1:3000").replace(/^ws/, "http"),
  vision: setting("VISION_SERVICE_URL", "http://127.0.0.1:8000"),
};
const files: Record<string, [string, string]> = {
  "/": ["../index.html", "text/html; charset=utf-8"],
  "/style.css": ["../style.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/logo.png": ["../../../public/logo.png", "image/png"],
  "/doghead.png": ["../../../public/doghead.png", "image/png"],
  "/daisy-source.png": ["../../../public/daisy-source.png", "image/png"],
  "/fonts/MaterialIcons.ttf": ["../../../node_modules/react-native-vector-icons/Fonts/MaterialIcons.ttf", "font/ttf"],
};

createServer(async (req, res) => {
  const reply = (status: number, body: string | Buffer, type = "application/json") => {
    res.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(body);
  };
  try {
    const host = req.headers.host || "";
    if (
      !/^(127\.0\.0\.1|localhost):\d+$/.test(host) ||
      (req.headers.origin && req.headers.origin !== `http://${host}`)
    )
      return reply(403, JSON.stringify({ error: "Open the demo from localhost" }));
    const url = new URL(req.url || "/", `http://${host}`);
    if (req.method === "GET" && files[url.pathname]) {
      const [file, type] = files[url.pathname];
      return reply(200, await readFile(resolve(__dirname, file)), type);
    }
    if (req.method === "GET" && url.pathname === "/config") return reply(200, JSON.stringify({ database }));
    const match = /^\/proxy\/(agent|db|vision)(\/.*)$/.exec(url.pathname);
    if (!match || !["GET", "POST", "DELETE"].includes(req.method || ""))
      return reply(404, JSON.stringify({ error: "Unknown route" }));
    const base = new URL(targets[match[1]]);
    const destination = new URL(match[2] + url.search, base);
    if (destination.origin !== base.origin) return reply(400, JSON.stringify({ error: "Invalid path" }));
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 12 * 1024 * 1024) return reply(413, JSON.stringify({ error: "Request is too large" }));
      chunks.push(chunk);
    }
    const headers: Record<string, string> = {};
    if (req.headers.authorization) headers.Authorization = req.headers.authorization;
    if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];
    const response = await fetch(destination, {
      method: req.method,
      headers,
      body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
      redirect: "manual",
    });
    reply(
      response.status,
      Buffer.from(await response.arrayBuffer()),
      response.headers.get("content-type") || "text/plain",
    );
  } catch {
    reply(502, JSON.stringify({ error: "Service unavailable. Check that it is running and configured." }));
  }
}).listen(port, "127.0.0.1", () => console.log(`PawSafe demo: http://127.0.0.1:${port}`));
