import { createServer, type IncomingMessage } from "node:http";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ApiError, authenticate, type Actor } from "./db.js";
import { message, confirm, messageInput } from "./orchestrator.js";
import { upload, getPhotoUrl } from "./media.js";
import {
  listScenarios,
  simulation,
  startSimulation,
  startInput,
  step,
  stepInput,
  feedback,
} from "./simulation.js";
import { reportQuery } from "./matching.js";
import {
  id,
  ingestSocial,
  ingestShelters,
  ingestAnimals,
  near,
  officialAlerts,
  point,
  searchMatches,
  socialInput,
  species,
} from "./workflows.js";
import { getDisasterHistory } from "./providers/index.js";

async function json(req: IncomingMessage) {
  if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json")
    throw new ApiError(415, "Use application/json");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32768) throw new ApiError(413, "Request exceeds 32 KiB");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ApiError(400, "Invalid JSON");
  }
}
function queryPoint(params: URLSearchParams) {
  const input = Object.fromEntries(params);
  if (!input.latitude?.trim() || !input.longitude?.trim())
    throw new ApiError(400, "latitude and longitude are required");
  return point.parse({ ...input, latitude: Number(input.latitude), longitude: Number(input.longitude) });
}
const confirmation = z.object({ runId: id, confirmed: z.literal(true) }).strict();
const fema = z
  .object({
    state: z.string().regex(/^[A-Za-z]{2}$/),
    incidentType: z.string().max(80).optional(),
    since: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export function makeServer(auth = authenticate) {
  const busy = new Map<string, number>();
  return createServer(async (req, res) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(body));
    };
    let active: string | undefined;
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const path = url.pathname;
      if (req.method === "GET" && path === "/health") {
        reply(200, { service: "pawsafe-agent", status: "ok" });
        return;
      }
      const actor = await auth(req.headers.authorization);
      if ((busy.get(actor.id) || 0) >= 4) throw new ApiError(429, "Too many concurrent requests");
      busy.set(actor.id, (busy.get(actor.id) || 0) + 1);
      active = actor.id;
      let value: unknown;
      if (req.method === "POST") {
        const input = await json(req);
        switch (path) {
          case "/v1/agent/message":
            value = await message(actor, messageInput.parse(input));
            break;
          case "/v1/agent/confirm-action":
            value = await confirm(actor, confirmation.parse(input).runId);
            break;
          case "/v1/matching/search":
            value = await searchMatches(actor, reportQuery.parse(input).reportId);
            break;
          case "/v1/ingestion/bluesky/search":
            value = await ingestSocial(actor.system, socialInput.parse(input));
            break;
          case "/v1/ingestion/shelters/sync":
            value = await ingestShelters(actor.system, near.parse(input));
            break;
          case "/v1/ingestion/animals/search":
            value = await ingestAnimals(
              actor.system,
              near.extend({ species: species.optional() }).parse(input),
            );
            break;
          case "/v1/uploads/sign":
            z.object({}).strict().parse(input);
            value = upload(actor);
            break;
          case "/v1/simulations":
            value = await startSimulation(actor, startInput.parse(input));
            break;
          default: {
            const match = /^\/v1\/simulations\/([^/]+)\/(choices|feedback)$/.exec(path);
            if (!match) throw new ApiError(404, "Unknown endpoint");
            const runId = z.string().uuid().parse(match[1]);
            if (match[2] === "choices") value = await step(actor, runId, stepInput.parse(input));
            else {
              z.object({}).strict().parse(input);
              value = await feedback(actor, runId);
            }
          }
        }
      } else if (req.method === "GET") {
        if (path === "/v1/weather/alerts") value = await officialAlerts(actor, queryPoint(url.searchParams));
        else if (path === "/v1/disasters/history")
          value = await getDisasterHistory(fema.parse(Object.fromEntries(url.searchParams)));
        else if (path === "/v1/scenarios") value = listScenarios();
        else if (path.startsWith("/v1/simulations/"))
          value = await simulation(actor, z.string().uuid().parse(path.slice(16)));
        else if (/^\/v1\/photos\/[^/]+\/url$/.test(path))
          value = await getPhotoUrl(actor, path.split("/")[3]);
        else if (/^\/v1\/agent\/runs\/[^/]+$/.test(path)) value = await getRun(actor, path.slice(15));
        else throw new ApiError(404, "Unknown endpoint");
      } else throw new ApiError(405, "Unsupported method");
      reply(200, value);
    } catch (e) {
      if (e instanceof z.ZodError)
        reply(400, { error: "Invalid input", fields: e.issues.map((i) => i.path.join(".")) });
      else if (e instanceof ApiError) reply(e.status, { error: e.message });
      else reply(502, { error: "The requested service could not complete the operation" });
    } finally {
      if (active) {
        const n = (busy.get(active) || 1) - 1;
        if (n) busy.set(active, n);
        else busy.delete(active);
      }
    }
  });
}
async function getRun(actor: Actor, id: string) {
  const run = await actor.db.read<Record<string, unknown> | null>("agent_run", id);
  if (!run) throw new ApiError(404, "Run not found");
  return run.result || run;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = makeServer();
  server.requestTimeout = 30000;
  server.listen(Number(process.env.PORT || 8080), () =>
    console.log("PawSafe agent listening on " + (process.env.PORT || 8080)),
  );
}
