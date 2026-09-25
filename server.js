import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const UI_URI = "ui://riftbound-card/base-v1.html";
const html = readFileSync(new URL("./public/card.html", import.meta.url), "utf8");
const API = "https://api.riftcodex.com";
const IMAGE_ORIGIN = "https://cmsassets.rgpub.io";

export function chooseCard(items, requestedSet) {
  const base = items.filter(c => c?.metadata?.alternate_art === false &&
    c?.metadata?.overnumbered === false && c?.metadata?.signature === false);
  const candidates = requestedSet
    ? base.filter(c => c.set?.set_id?.toLowerCase() === requestedSet.toLowerCase())
    : base;
  return candidates.sort((a, b) => a.riftbound_id.localeCompare(b.riftbound_id))[0];
}

async function cardsByName(name, fuzzy) {
  const url = new URL("/cards/name", API);
  url.searchParams.set(fuzzy ? "fuzzy" : "exact", name);
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Card lookup service returned " + response.status);
  const data = await response.json();
  return Array.isArray(data.items) ? data.items : [];
}

export async function findCard(name, set) {
  const exact = await cardsByName(name, false);
  let candidates = exact;
  if (!candidates.length) candidates = await cardsByName(name, true);
  const card = chooseCard(candidates, set);
  if (!card) return { error: "No ordinary base printing found for this name and set." };
  // Fuzzy results can contain several different card names. Require an exact name
  // selection before displaying an image when the lookup was ambiguous.
  if (!exact.length && new Set(candidates.map(c => c.name)).size > 1) {
    return { error: "Name is ambiguous: " + [...new Set(candidates.map(c => c.name))].slice(0, 8).join(", ") };
  }
  const image = new URL(card.media?.image_url);
  if (image.origin !== IMAGE_ORIGIN) return { error: "Card image host is not allowed." };
  return {
    name: card.name,
    riftbound_id: card.riftbound_id,
    set: card.set.label,
    image_url: image.href,
    text: card.text?.plain ?? "",
    unofficial_source: "Riftcodex"
  };
}

function makeServer() {
  const server = new McpServer({ name: "riftbound-card-mcp", version: "0.1.0" });
  registerAppResource(server, "riftbound-base-card", UI_URI, {}, async () => ({
    contents: [{
      uri: UI_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: html,
      _meta: {
        ui: {
          prefersBorder: true,
          csp: { resourceDomains: [IMAGE_ORIGIN], connectDomains: [] }
        },
        "openai/ui": { availableDisplayModes: ["inline"] }
      }
    }]
  }));
  registerAppTool(server, "show_base_card", {
    title: "Show Riftbound base card",
    description: "Look up a Riftbound card by printed name in Riftcodex and display its ordinary base printing inline. Call once when a card image is requested, including alongside a ruling. The card database is unofficial; verify disputed wording with official rules.",
    inputSchema: { name: z.string().min(1).max(120), set: z.string().max(20).optional() },
    _meta: { ui: { resourceUri: UI_URI } },
    annotations: { readOnlyHint: true }
  }, async ({ name, set }) => {
    try {
      const card = await findCard(name.trim(), set);
      return {
        structuredContent: card,
        content: [{ type: "text", text: card.error ?? JSON.stringify(card) }],
        isError: Boolean(card.error)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown lookup error";
      return { structuredContent: { error: message }, content: [{ type: "text", text: message }], isError: true };
    }
  });
  return server;
}

const port = Number(process.env.PORT ?? 8787);
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/plain" }).end("Riftbound card MCP");
      return;
    }
    if (url.pathname === "/mcp" && req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "content-type,mcp-session-id", "Access-Control-Expose-Headers": "Mcp-Session-Id" }).end();
      return;
    }
    if (url.pathname !== "/mcp" || !["GET", "POST", "DELETE"].includes(req.method)) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) res.writeHead(500).end("Internal server error");
    }
  }).listen(port, () => console.log(`Riftbound card MCP on http://localhost:${port}/mcp`));
}
