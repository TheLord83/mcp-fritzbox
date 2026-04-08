import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SmartHomeClient } from "./client/smart-home.js";
import { TR064Client } from "./client/tr064.js";
import {
  FritzAuthError,
  FritzConnectionError,
  FritzDeviceNotFoundError,
  FritzInvalidParameterError,
} from "./types/errors.js";

export function createMcpServer(
  smartHome: SmartHomeClient,
  tr064: TR064Client
): McpServer {
  const server = new McpServer({
    name: "mcp-fritzbox",
    version: "0.1.0",
  });

  // --- Smart Home Tools ---

  server.tool(
    "list_devices",
    "List all smart home actors and network devices connected to the FRITZ!Box",
    {},
    async () => {
      try {
        const [smartHomeDevices, networkDevices] = await Promise.all([
          smartHome.listDevices(),
          tr064.listNetworkDevices(),
        ]);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ smartHomeDevices, networkDevices }, null, 2),
            },
          ],
        };
      } catch (error) {
        return handleError(error);
      }
    }
  );

  server.tool(
    "set_thermostat",
    "Set the target temperature on a FRITZ!DECT thermostat",
    {
      ain: z.string().describe("Actor Identification Number of the thermostat"),
      temperature: z
        .union([z.enum(["ON", "OFF"]), z.coerce.number()])
        .describe("Target temperature in °C (8.0–28.0), or 'ON' (boost) / 'OFF'"),
    },
    async ({ ain, temperature }) => {
      try {
        const result = await smartHome.setThermostat(ain, temperature);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return handleError(error);
      }
    }
  );

  server.tool(
    "toggle_switch",
    "Turn a FRITZ!DECT smart plug on or off",
    {
      ain: z.string().describe("Actor Identification Number of the switch"),
      state: z.boolean().describe("true = on, false = off"),
    },
    async ({ ain, state }) => {
      try {
        const result = await smartHome.toggleSwitch(ain, state);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return handleError(error);
      }
    }
  );

  server.tool(
    "get_device_stats",
    "Get temperature history or energy consumption statistics for a smart home device",
    {
      ain: z.string().describe("Actor Identification Number of the device"),
    },
    async ({ ain }) => {
      try {
        const result = await smartHome.getDeviceStats(ain);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return handleError(error);
      }
    }
  );

  // --- TR-064 Tools ---

  server.tool(
    "get_system_info",
    "Get FRITZ!Box system information including model, firmware version, and serial number",
    {},
    async () => {
      try {
        const result = await tr064.getSystemInfo();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return handleError(error);
      }
    }
  );

  server.tool(
    "get_wan_status",
    "Get WAN connection status including external IP, uptime, and link state",
    {},
    async () => {
      try {
        const result = await tr064.getWanStatus();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return handleError(error);
      }
    }
  );

  server.tool(
    "get_bandwidth_stats",
    "Get total bandwidth usage and max line rates",
    {},
    async () => {
      try {
        const result = await tr064.getBandwidthStats();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return handleError(error);
      }
    }
  );

  server.tool(
    "toggle_guest_wifi",
    "Enable or disable the FRITZ!Box guest WiFi network",
    {
      enable: z.boolean().describe("true = enable, false = disable"),
    },
    async ({ enable }) => {
      try {
        const result = await tr064.toggleGuestWifi(enable);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return handleError(error);
      }
    }
  );

  server.tool(
    "get_device_log",
    "Get recent FRITZ!Box system log entries",
    {
      count: z
        .number()
        .optional()
        .default(20)
        .describe("Number of log entries to return (default: 20)"),
    },
    async ({ count }) => {
      try {
        const result = await tr064.getDeviceLog(count);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return handleError(error);
      }
    }
  );

  server.tool(
    "reconnect_wan",
    "Force a WAN reconnect to obtain a new external IP address",
    {},
    async () => {
      try {
        const result = await tr064.reconnectWan();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return handleError(error);
      }
    }
  );

  return server;
}

function handleError(error: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  // Domain errors: structured JSON response
  if (
    error instanceof FritzDeviceNotFoundError ||
    error instanceof FritzInvalidParameterError
  ) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: error.code,
              message: error.message,
              hint:
                error instanceof FritzDeviceNotFoundError
                  ? "Use list_devices to see available devices and their AINs"
                  : "Check the parameter constraints in the tool description",
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Transport/Auth/Protocol errors: MCP-native error
  if (error instanceof FritzAuthError) {
    return {
      content: [
        {
          type: "text",
          text: `Authentication failed: ${error.message}. Check FRITZBOX_USERNAME and FRITZBOX_PASSWORD.`,
        },
      ],
      isError: true,
    };
  }

  if (error instanceof FritzConnectionError) {
    return {
      content: [
        {
          type: "text",
          text: `Connection failed: ${error.message}. Verify FRITZBOX_HOST is reachable.`,
        },
      ],
      isError: true,
    };
  }

  // Unknown errors
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Unexpected error: ${message}` }],
    isError: true,
  };
}
