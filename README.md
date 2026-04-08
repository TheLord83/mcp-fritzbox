# mcp-fritzbox

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for interfacing with AVM FRITZ!Box routers (FRITZ!OS 8.20+). Control smart home devices, monitor network status, and administer your router through any MCP-compatible client.

## Design Architecture

```
MCP Client (Claude Desktop, Claude Code, etc.)
  │ stdio or HTTP/SSE
MCP Server (server.ts)
  │ routes tool calls
  ├── SmartHomeClient ──→ REST API (/api/v0/smarthome/)
  ├── TR064Client ──────→ SOAP (TR-064 UPnP)
  └── AuthProvider ─────→ SID login (login_sid.lua) + HTTP Digest
```

### Components

| Component | File | Responsibility |
|-----------|------|----------------|
| **AuthProvider** | `src/auth/auth-provider.ts` | MD5 challenge-response SID login, HTTP digest credentials for TR-064, lazy re-auth on session expiry |
| **SmartHomeClient** | `src/client/smart-home.ts` | REST calls to the FRITZ!Box Smart Home API for thermostats and switches |
| **TR064Client** | `src/client/tr064.ts` | SOAP calls for router administration (WAN status, bandwidth, guest WiFi, etc.) |
| **HTTP Client** | `src/client/http.ts` | Shared axios instance with 403 interceptor for automatic SID renewal |
| **MCP Server** | `src/server.ts` | Tool registration and error handling — maps MCP tool calls to client methods |

## Tools

### Smart Home

| Tool | Arguments | Output |
|------|-----------|--------|
| `list_devices` | none | `{ smartHomeDevices: [...], networkDevices: [...] }` — combined smart home actors and network hosts |
| `set_thermostat` | `ain: string`, `temperature: number \| "ON" \| "OFF"` | Updated thermostat state (target temp, current temp, battery) |
| `toggle_switch` | `ain: string`, `state: boolean` | Updated switch state with current power reading (mW) and total energy (Wh) |
| `get_device_stats` | `ain: string` | Temperature history or energy consumption statistics |

### Router Administration (TR-064)

| Tool | Arguments | Output |
|------|-----------|--------|
| `get_system_info` | none | `{ modelName, firmwareVersion, serialNumber }` |
| `get_wan_status` | none | `{ externalIp, connectionStatus, uptime, lastError }` |
| `get_bandwidth_stats` | none | `{ totalBytesSent, totalBytesReceived, maxBitRateUp, maxBitRateDown }` |
| `toggle_guest_wifi` | `enable: boolean` | `{ enabled, ssid, securityMode }` |
| `get_device_log` | `count?: number` | Array of recent system log lines (default: 20) |
| `reconnect_wan` | none | `{ message: "WAN reconnect initiated..." }` — forces new external IP |

## Setup Guide

### 1. Create a FRITZ!Box User

1. Open your FRITZ!Box web UI at `http://fritz.box`
2. Navigate to **System → FRITZ!Box Users → Add User**
3. Set a username and password
4. Enable these permissions:
   - **Smart Home** — required for thermostat/switch control
   - **FRITZ!Box Settings** — required for TR-064 (WAN status, guest WiFi, etc.)
   - **Access from the Internet** — only if you need remote access
5. Click **Apply**

### 2. Install

**From GitHub:**

```bash
git clone https://github.com/ghbalf/mcp-fritzbox.git
cd mcp-fritzbox
npm install
npm run build
```

### 3. Configure

Set environment variables:

```bash
export FRITZBOX_HOST=fritz.box       # default, or use IP: 192.168.178.1
export FRITZBOX_USERNAME=your_user
export FRITZBOX_PASSWORD=your_pass
```

Or pass CLI flags:

```bash
node dist/index.js --host 192.168.178.1 --user admin --pass secret
```

CLI flags override environment variables.

### 4. Connect to an MCP Client

**Claude Code** — add a `.mcp.json` to your project root:

```json
{
  "mcpServers": {
    "fritzbox": {
      "command": "node",
      "args": ["/path/to/mcp-fritzbox/dist/index.js"],
      "env": {
        "FRITZBOX_HOST": "fritz.box",
        "FRITZBOX_USERNAME": "your_user",
        "FRITZBOX_PASSWORD": "your_pass"
      }
    }
  }
}
```

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "fritzbox": {
      "command": "node",
      "args": ["/path/to/mcp-fritzbox/dist/index.js"],
      "env": {
        "FRITZBOX_HOST": "fritz.box",
        "FRITZBOX_USERNAME": "your_user",
        "FRITZBOX_PASSWORD": "your_pass"
      }
    }
  }
}
```

**HTTP/SSE mode** (for remote clients):

```bash
node dist/index.js --http --port 3000
# SSE endpoint: http://localhost:3000/sse
# Message endpoint: http://localhost:3000/messages
```

### 5. Verify Connection

```bash
FRITZBOX_USERNAME=your_user FRITZBOX_PASSWORD=your_pass npm run test:integration
```

## Development

```bash
npm run start:dev    # Run with tsx (no build needed)
npm run build        # Compile TypeScript
npm test             # Run unit tests
npm run test:watch   # Watch mode
npm run test:integration  # Live FRITZ!Box connection test
```

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `AUTH_FAILED` (SID all zeros) | Wrong username or password | Verify credentials in FRITZ!Box UI under System → FRITZ!Box Users |
| `CONNECTION_FAILED` (ECONNREFUSED) | FRITZ!Box unreachable | Check `FRITZBOX_HOST` — try IP address `192.168.178.1` instead of `fritz.box` |
| `CONNECTION_FAILED` (ETIMEDOUT) | Network issue or wrong port | Ensure you're on the same LAN; check no firewall blocks port 80/49000 |
| `403 Forbidden` (persistent) | User lacks permissions | Enable "Smart Home" and "FRITZ!Box Settings" in the user's FRITZ!Box permissions |
| `DEVICE_NOT_FOUND` | Invalid AIN | Run `list_devices` first to find valid Actor Identification Numbers |
| `INVALID_PARAMETER` (temperature) | Out of range | Temperature must be 8.0–28.0°C, or `"ON"` / `"OFF"` for boost/off mode |
| SOAP fault on guest WiFi | No guest network configured | Set up a guest network in FRITZ!Box UI first (WiFi → Guest Access) |
| TR-064 401 Unauthorized | Digest auth rejected | User needs "FRITZ!Box Settings" permission; some models require explicit TR-064 access |

## License

MIT
