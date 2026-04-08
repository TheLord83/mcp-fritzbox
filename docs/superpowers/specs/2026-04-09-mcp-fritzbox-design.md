# MCP FRITZ!Box Server — Design Spec

## Overview

A Model Context Protocol (MCP) server in TypeScript that interfaces with a FRITZ!Box router (FRITZ!OS 8.20+). Provides 10 tools for smart home control, network monitoring, and router administration. Supports both stdio and HTTP/SSE transports.

## Architecture

### Layered Design

```
MCP Client (Claude Desktop, Claude Code, etc.)
  | stdio or HTTP/SSE
MCP Server (server.ts)
  | routes tool calls to clients
  |--- SmartHomeClient (REST)  --\
  |--- TR064Client (SOAP)     ---+--> AuthProvider --> axios --> FRITZ!Box
  |                              /
  http.ts (shared axios instance)
```

Three layers with clear responsibilities:

1. **AuthProvider** (`src/auth/auth-provider.ts`) — SID lifecycle via MD5 challenge-response, digest auth for TR-064, lazy re-auth on 403.
2. **SmartHomeClient** (`src/client/smart-home.ts`) — REST calls to `/api/v0/smarthome/` for device control.
3. **TR064Client** (`src/client/tr064.ts`) — SOAP calls for router administration services.
4. **MCP Server** (`src/server.ts`) — thin orchestration layer, registers tools, maps to client methods. No business logic.
5. **Entry Point** (`src/index.ts`) — CLI arg parsing, transport selection, server bootstrap.

### Project Structure

```
mcp-fritzbox/
├── src/
│   ├── index.ts
│   ├── server.ts
│   ├── auth/
│   │   └── auth-provider.ts
│   ├── client/
│   │   ├── smart-home.ts
│   │   ├── tr064.ts
│   │   └── http.ts
│   └── types/
│       ├── smarthome.ts
│       ├── tr064.ts
│       └── config.ts
├── tests/
│   ├── unit/
│   │   ├── auth-provider.test.ts
│   │   ├── smart-home.test.ts
│   │   └── tr064.test.ts
│   ├── fixtures/
│   │   ├── login-challenge.xml
│   │   ├── login-success.xml
│   │   ├── login-failure.xml
│   │   ├── smarthome-devices.json
│   │   ├── soap-wan-status.xml
│   │   ├── soap-device-info.xml
│   │   └── soap-hosts.xml
│   └── integration/
│       └── test-connection.ts
├── package.json
├── tsconfig.json
└── README.md
```

## Configuration

**Primary:** Environment variables
- `FRITZBOX_HOST` (default: `fritz.box`)
- `FRITZBOX_USERNAME`
- `FRITZBOX_PASSWORD`

**Override:** CLI flags
- `--host`, `--user`, `--pass`
- `--http` — enable HTTP/SSE transport (default: stdio)
- `--port` — HTTP port (default: 3000)

CLI flags take precedence over environment variables.

## Authentication

### SID Login (Smart Home REST API)

Uses FRITZ!Box MD5 challenge-response via `login_sid.lua`:

1. `GET /login_sid.lua` → XML with `<Challenge>` and `<SID>` (initially all zeros).
2. Compute response: `challenge + "-" + MD5(challenge + "-" + password_utf16le)`.
   - **Critical:** Password must be encoded as UTF-16LE before MD5 hashing. This is the most common implementation bug — ASCII encoding produces wrong hashes for passwords containing non-ASCII characters (e.g., `ä`, `ü`, `ß`).
3. `POST /login_sid.lua` with `username` + `response` → XML with valid `<SID>`.
4. If returned SID is all zeros → credentials are wrong → throw `FritzAuthError`.

SID is attached to REST requests as query parameter `?sid=xxxx`.

### Digest Auth (TR-064 SOAP)

TR-064 uses HTTP Digest Authentication (same username/password, different mechanism). Implemented manually using Node's built-in `crypto` module (~30 lines) to avoid extra dependencies.

### Session Management — Lazy Re-auth

- SID expires after ~20 minutes of FRITZ!Box inactivity.
- The shared axios instance in `http.ts` has a response interceptor that detects 403 responses.
- On 403: calls `AuthProvider.reauth()` → retries the original request exactly once.
- If retry also fails → propagate error (no infinite loops).

### AuthProvider Interface

```typescript
class AuthProvider {
  private sid: string | null;
  private config: { host: string; username: string; password: string };

  async getSid(): Promise<string>        // Cached SID or acquire new
  async reauth(): Promise<string>        // Force fresh SID
  async validateSid(): Promise<boolean>  // Check SID validity

  getDigestAuth(): { username: string; password: string }  // For TR-064

  private async fetchChallenge(): Promise<string>
  private computeResponse(challenge: string, password: string): string
}
```

## Smart Home Client (REST)

Calls `/api/v0/smarthome/` endpoints on FRITZ!OS 8.20+.

### Supported Device Types

- **Thermostats** (FRITZ!DECT 301/302) — temperature control, battery status
- **Switches** (FRITZ!DECT 200/210) — on/off toggle, power/energy readings

### Tools

**`list_devices`** — no arguments
- `GET /api/v0/smarthome/devices`
- Returns combined response with `smartHomeDevices` (from REST) and `networkDevices` (from TR-064 Hosts:1)

**`set_thermostat`** — `ain: string`, `temperature: number | "ON" | "OFF"`
- `PUT /api/v0/smarthome/devices/{ain}`
- Temperature range: 8.0–28.0°C in 0.5°C steps (rounds to nearest 0.5)
- Special values: `"ON"` = boost mode (max), `"OFF"` = off mode
- Returns updated device state

**`toggle_switch`** — `ain: string`, `state: boolean`
- `PUT /api/v0/smarthome/devices/{ain}`
- Returns updated switch state with current power reading

**`get_device_stats`** — `ain: string`
- `GET /api/v0/smarthome/devices/{ain}/statistics`
- Returns temperature history (thermostat) or energy consumption data (switch)

## TR-064 Client (SOAP)

Each TR-064 call is a SOAP POST with service-specific endpoint and action.

### SOAP Envelope Template

```xml
<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:{Action} xmlns:u="urn:dslforum-org:service:{Service}"/>
  </s:Body>
</s:Envelope>
```

A helper function builds envelopes from service name + action, keeping TR-064 code DRY. XML responses are parsed with `fast-xml-parser`.

### Tools

**`get_system_info`** — no arguments
- Service: `DeviceInfo:1`, Action: `GetInfo`
- Returns: firmware version, model name, serial number

**`get_wan_status`** — no arguments
- Service: `WANIPConnection:1` or `WANPPPConnection:1`, Actions: `GetExternalIPAddress`, `GetStatusInfo`
- Returns: external IP, connection uptime, link status

**`get_bandwidth_stats`** — no arguments
- Service: `WANCommonInterfaceConfig:1`, Actions: `GetTotalBytesReceived`, `GetTotalBytesSent`
- Returns: total bytes up/down, current throughput rates

**`toggle_guest_wifi`** — `enable: boolean`
- Service: `WLANConfiguration:3` (third WLAN = guest network), Actions: `SetEnable`, `GetInfo`
- Returns: guest SSID, enabled state, security type

**`get_device_log`** — `count?: number` (default 20)
- Service: `DeviceLog:1`, Action: `GetDeviceLog`
- Returns: array of recent system log entries (truncated to `count`)

**`reconnect_wan`** — no arguments
- Service: `WANIPConnection:1`, Action: `ForceTermination`
- Returns: confirmation message (new IP available after reconnect)

**`list_network_devices`** (part of `list_devices` response)
- Service: `Hosts:1`, Actions: `GetHostNumberOfEntries`, `GetGenericHostEntry`
- Parallelized iteration over host entries
- Returns: IP, MAC, hostname, active status per host

## Error Handling

### Error Classes

```typescript
class FritzAuthError extends Error      { code = "AUTH_FAILED" }
class FritzConnectionError extends Error { code = "CONNECTION_FAILED" }
class FritzDeviceNotFoundError extends Error { code = "DEVICE_NOT_FOUND" }
class FritzInvalidParameterError extends Error { code = "INVALID_PARAMETER" }
```

### Error Response Strategy

| Category | Detection | MCP Response |
|----------|-----------|-------------|
| Transport | ECONNREFUSED, ETIMEDOUT | MCP-native `isError: true` |
| Auth | SID all zeros, 403 after re-auth | MCP-native `isError: true` |
| Domain | Device not found, invalid AIN, temp out of range | Structured JSON `{ error, message, hint }` |
| Protocol | SOAP fault, malformed XML | MCP-native `isError: true` |

### Retry Policy

- **Auth 403:** Retry once after `reauth()`, then fail.
- **Network errors:** Fail fast, no retry.
- **Domain errors:** Never retry (user input issue).

### Input Validation

- `temperature`: 8.0–28.0°C, or `"ON"` / `"OFF"`
- `ain`: basic format check (digits + optional spaces)
- `state`: boolean only

## Testing

### Framework: Vitest

### Unit Tests

| Test File | Coverage |
|-----------|----------|
| `auth-provider.test.ts` | MD5 challenge-response (including UTF-16LE with umlauts), SID caching, re-auth flow, invalid credentials |
| `smart-home.test.ts` | Device listing, thermostat set (0.5°C rounding), switch toggle, device-not-found |
| `tr064.test.ts` | SOAP envelope construction, XML parsing, WAN status, guest WiFi, network devices |

### Mocking

- Mock axios at adapter level via `vitest.mock('axios')`
- Fixture files in `tests/fixtures/` with canned FRITZ!Box XML/JSON responses
- No real network calls in unit tests

### Integration Test

`tests/integration/test-connection.ts` — standalone script, not part of vitest suite:
- Reads `FRITZBOX_HOST`, `FRITZBOX_USERNAME`, `FRITZBOX_PASSWORD` from env
- Sequence: acquire SID → list smart home devices → get WAN status → report
- Exit 0 on success, exit 1 with diagnostics on failure
- Run via: `npx tsx tests/integration/test-connection.ts`

### Package Scripts

```json
{
  "build": "tsc",
  "start": "node dist/index.js",
  "start:dev": "tsx src/index.ts",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:integration": "tsx tests/integration/test-connection.ts"
}
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP server framework |
| `axios` | HTTP client |
| `fast-xml-parser` | Parse SOAP/XML responses |
| `typescript` | Dev — TypeScript compiler |
| `tsx` | Dev — run TS directly |
| `vitest` | Dev — test framework |

## Transport

- **Default:** stdio (launched by MCP client)
- **Optional:** HTTP/SSE via `--http --port 3000` flags
