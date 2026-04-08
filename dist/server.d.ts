import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SmartHomeClient } from "./client/smart-home.js";
import { TR064Client } from "./client/tr064.js";
export declare function createMcpServer(smartHome: SmartHomeClient, tr064: TR064Client): McpServer;
