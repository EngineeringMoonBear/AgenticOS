import "server-only";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { MCP_VAULT_TOOLS } from "./tools";
import type { McpToolDef } from "./types";

const PORT = 7610;
const DASHBOARD_BASE = process.env.AGENTICOS_DASHBOARD_BASE ?? "http://127.0.0.1:3000";

let started = false;

export async function bootMcpServer(): Promise<void> {
  if (started) return;
  started = true;
  const server = createServer(handleRequest);
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  console.log(`MCP vault server listening on 127.0.0.1:${PORT}`);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.url === "/tools" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ tools: MCP_VAULT_TOOLS.map(serializeTool) }));
    return;
  }
  if (req.url === "/invoke" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { name, args } = JSON.parse(body) as { name: string; args: Record<string, unknown> };
      const tool = MCP_VAULT_TOOLS.find((t) => t.name === name);
      if (!tool) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `Unknown tool: ${name}` }));
        return;
      }
      const result = await invokeProxy(tool, args);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }
  res.writeHead(404);
  res.end();
}

function serializeTool(tool: McpToolDef) {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}

async function invokeProxy(tool: McpToolDef, args: Record<string, unknown>): Promise<unknown> {
  const { method, path: routePath, query } = tool.proxyTo;
  const url = new URL(routePath, DASHBOARD_BASE);
  if (query && method === "GET") {
    for (const key of query) {
      const v = args[key];
      if (v === undefined || v === null) continue;
      url.searchParams.set(key, Array.isArray(v) ? v.join(",") : String(v));
    }
  }
  const init: RequestInit = { method };
  if (method === "POST") {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(args);
  }
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Proxy ${routePath} returned ${res.status}`);
  return await res.json();
}
