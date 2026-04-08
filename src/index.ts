#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "http";
import { resolveConfig } from "./types/config.js";
import { AuthProvider } from "./auth/auth-provider.js";
import { SmartHomeClient } from "./client/smart-home.js";
import { TR064Client } from "./client/tr064.js";
import { createHttpClient } from "./client/http.js";
import { createMcpServer } from "./server.js";

async function main() {
  const config = resolveConfig(process.argv.slice(2));

  if (!config.fritzbox.username || !config.fritzbox.password) {
    console.error(
      "Error: FRITZBOX_USERNAME and FRITZBOX_PASSWORD must be set " +
        "(via environment variables or --user / --pass flags)"
    );
    process.exit(1);
  }

  const authProvider = new AuthProvider(config.fritzbox);
  const httpClient = createHttpClient(config.fritzbox.host, authProvider);
  const smartHome = new SmartHomeClient(httpClient, authProvider);
  const tr064 = new TR064Client(config.fritzbox.host, authProvider);
  const server = createMcpServer(smartHome, tr064);

  if (config.transport === "stdio") {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } else {
    let sseTransport: SSEServerTransport | null = null;
    const httpServer = createServer(async (req, res) => {
      if (req.url === "/sse") {
        sseTransport = new SSEServerTransport("/messages", res);
        await server.connect(sseTransport);
      } else if (req.url === "/messages" && req.method === "POST") {
        if (sseTransport) {
          await sseTransport.handlePostMessage(req, res);
        } else {
          res.writeHead(400);
          res.end("No SSE connection established");
        }
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    httpServer.listen(config.httpPort, () => {
      console.error(`MCP FRITZ!Box server listening on http://localhost:${config.httpPort}`);
      console.error(`SSE endpoint: http://localhost:${config.httpPort}/sse`);
    });
  }
}

main().catch((error) => {
  console.error("Fatal error:", error.message);
  process.exit(1);
});
