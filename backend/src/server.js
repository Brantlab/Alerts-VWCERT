import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8080);
const dataDir = process.env.DATA_DIR || path.resolve(__dirname, "../data");
const cacheDir = process.env.CACHE_DIR || path.resolve(__dirname, "../cache");
const stateFile = path.join(dataDir, "state.json");
const allowedOrigins = (process.env.PUBLIC_FRONTEND_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const adminToken = process.env.ADMIN_TOKEN || "";

function jsonResponse(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function corsHeaders(request) {
  const origin = request.headers.origin || "";
  const allowOrigin = allowedOrigins.includes("*")
    ? "*"
    : allowedOrigins.includes(origin)
      ? origin
      : "";
  if (!allowOrigin) return {};
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,PUT,OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "vary": "Origin",
  };
}

function requireWriteAccess(request, response, headers) {
  if (!adminToken) return true;
  const authorization = request.headers.authorization || "";
  if (authorization === `Bearer ${adminToken}`) return true;
  jsonResponse(response, 401, { error: "Unauthorized" }, headers);
  return false;
}

async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function readRequestJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const headers = corsHeaders(request);

  if (request.method === "OPTIONS") {
    response.writeHead(204, headers);
    response.end();
    return;
  }

  if (url.pathname === "/health" && request.method === "GET") {
    jsonResponse(response, 200, {
      ok: true,
      service: "vwcert-alerts-backend",
      time: new Date().toISOString(),
    }, headers);
    return;
  }

  if (url.pathname === "/api/config" && request.method === "GET") {
    jsonResponse(response, 200, {
      frontendOrigins: allowedOrigins,
      writesRequireToken: Boolean(adminToken),
      dataDir,
      cacheDir,
    }, headers);
    return;
  }

  if (url.pathname === "/api/state/current" && request.method === "GET") {
    const state = await readJsonFile(stateFile, {
      updatedAt: null,
      activeCounty: null,
      activeIncident: null,
      alerts: [],
      notes: "",
    });
    jsonResponse(response, 200, state, headers);
    return;
  }

  if (url.pathname === "/api/state/current" && request.method === "PUT") {
    if (!requireWriteAccess(request, response, headers)) return;
    const body = await readRequestJson(request);
    const state = {
      ...body,
      updatedAt: new Date().toISOString(),
    };
    await mkdir(dataDir, { recursive: true });
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
    jsonResponse(response, 200, state, headers);
    return;
  }

  jsonResponse(response, 404, { error: "Not found" }, headers);
}

await Promise.all([
  mkdir(dataDir, { recursive: true }),
  mkdir(cacheDir, { recursive: true }),
]);

createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    jsonResponse(response, 500, {
      error: "Internal server error",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message,
    }, corsHeaders(request));
  });
}).listen(port, "0.0.0.0", () => {
  console.log(`vwcert-alerts-backend listening on :${port}`);
});
