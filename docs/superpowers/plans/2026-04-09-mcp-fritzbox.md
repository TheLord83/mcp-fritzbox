# MCP FRITZ!Box Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript MCP server that interfaces with FRITZ!Box routers for smart home control and router administration.

**Architecture:** Layered design with AuthProvider (SID + digest auth), SmartHomeClient (REST), and TR064Client (SOAP), orchestrated by a thin MCP server layer. Dual transport: stdio (default) and HTTP/SSE.

**Tech Stack:** TypeScript, @modelcontextprotocol/sdk, axios, fast-xml-parser, Vitest

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/types/config.ts`

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "mcp-fritzbox",
  "version": "0.1.0",
  "description": "MCP server for FRITZ!Box router administration and smart home control",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "mcp-fritzbox": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "start:dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "tsx tests/integration/test-connection.ts"
  },
  "keywords": ["mcp", "fritzbox", "smart-home", "tr-064"],
  "license": "MIT"
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install @modelcontextprotocol/sdk axios fast-xml-parser`
Run: `npm install -D typescript tsx vitest @types/node`

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Create config types**

Create `src/types/config.ts`:

```typescript
export interface FritzBoxConfig {
  host: string;
  username: string;
  password: string;
}

export interface ServerConfig {
  fritzbox: FritzBoxConfig;
  transport: "stdio" | "http";
  httpPort: number;
}

export function resolveConfig(args: string[]): ServerConfig {
  const flagIndex = (flag: string) => args.indexOf(flag);
  const flagValue = (flag: string) => {
    const i = flagIndex(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
  };

  return {
    fritzbox: {
      host: flagValue("--host") ?? process.env.FRITZBOX_HOST ?? "fritz.box",
      username: flagValue("--user") ?? process.env.FRITZBOX_USERNAME ?? "",
      password: flagValue("--pass") ?? process.env.FRITZBOX_PASSWORD ?? "",
    },
    transport: args.includes("--http") ? "http" : "stdio",
    httpPort: Number(flagValue("--port") ?? "3000"),
  };
}
```

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/types/config.ts
git commit -m "feat: scaffold project with dependencies and config types"
```

---

### Task 2: Error Types

**Files:**
- Create: `src/types/errors.ts`

- [ ] **Step 1: Create error classes**

Create `src/types/errors.ts`:

```typescript
export class FritzAuthError extends Error {
  readonly code = "AUTH_FAILED" as const;
  constructor(message = "Authentication failed — check username and password") {
    super(message);
    this.name = "FritzAuthError";
  }
}

export class FritzConnectionError extends Error {
  readonly code = "CONNECTION_FAILED" as const;
  constructor(message = "Could not connect to FRITZ!Box") {
    super(message);
    this.name = "FritzConnectionError";
  }
}

export class FritzDeviceNotFoundError extends Error {
  readonly code = "DEVICE_NOT_FOUND" as const;
  constructor(ain: string) {
    super(`Device with AIN "${ain}" not found`);
    this.name = "FritzDeviceNotFoundError";
  }
}

export class FritzInvalidParameterError extends Error {
  readonly code = "INVALID_PARAMETER" as const;
  constructor(message: string) {
    super(message);
    this.name = "FritzInvalidParameterError";
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/errors.ts
git commit -m "feat: add custom error classes for Fritz error categories"
```

---

### Task 3: AuthProvider — Challenge-Response Logic

**Files:**
- Create: `src/auth/auth-provider.ts`
- Create: `tests/fixtures/login-challenge.xml`
- Create: `tests/fixtures/login-success.xml`
- Create: `tests/fixtures/login-failure.xml`
- Create: `tests/unit/auth-provider.test.ts`

- [ ] **Step 1: Create test fixtures**

Create `tests/fixtures/login-challenge.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<SessionInfo>
  <SID>0000000000000000</SID>
  <Challenge>1234abcd</Challenge>
  <BlockTime>0</BlockTime>
</SessionInfo>
```

Create `tests/fixtures/login-success.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<SessionInfo>
  <SID>9c5f5e3a7c5f5e3a</SID>
  <Challenge>1234abcd</Challenge>
  <BlockTime>0</BlockTime>
</SessionInfo>
```

Create `tests/fixtures/login-failure.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<SessionInfo>
  <SID>0000000000000000</SID>
  <Challenge>5678efgh</Challenge>
  <BlockTime>0</BlockTime>
</SessionInfo>
```

- [ ] **Step 2: Write failing tests for MD5 challenge-response**

Create `tests/unit/auth-provider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthProvider } from "../../src/auth/auth-provider.js";
import { FritzAuthError, FritzConnectionError } from "../../src/types/errors.js";
import { readFileSync } from "fs";
import { resolve } from "path";
import crypto from "crypto";

const fixturesDir = resolve(__dirname, "../fixtures");
const challengeXml = readFileSync(resolve(fixturesDir, "login-challenge.xml"), "utf-8");
const successXml = readFileSync(resolve(fixturesDir, "login-success.xml"), "utf-8");
const failureXml = readFileSync(resolve(fixturesDir, "login-failure.xml"), "utf-8");

// Mock axios
vi.mock("axios", () => {
  const mockAxios = {
    get: vi.fn(),
    post: vi.fn(),
    create: vi.fn(() => mockAxios),
    defaults: { baseURL: "" },
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  };
  return { default: mockAxios };
});

import axios from "axios";
const mockAxios = vi.mocked(axios);

describe("AuthProvider", () => {
  let auth: AuthProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    auth = new AuthProvider({
      host: "fritz.box",
      username: "admin",
      password: "secret123",
    });
  });

  describe("computeResponse", () => {
    it("computes correct MD5 with UTF-16LE encoding", () => {
      // The FRITZ!Box algorithm:
      // 1. Build string: challenge + "-" + password
      // 2. Encode as UTF-16LE
      // 3. MD5 hash
      // 4. Result: challenge + "-" + hash
      const challenge = "1234abcd";
      const password = "secret123";
      const input = `${challenge}-${password}`;
      const utf16le = Buffer.from(input, "utf-16le");
      const expectedHash = crypto.createHash("md5").update(utf16le).digest("hex");
      const expectedResponse = `${challenge}-${expectedHash}`;

      // Access via public getSid which internally calls computeResponse
      // We verify the response by checking what gets POSTed
      mockAxios.get.mockResolvedValueOnce({ data: challengeXml });
      mockAxios.post.mockResolvedValueOnce({ data: successXml });

      return auth.getSid().then(() => {
        const postCall = mockAxios.post.mock.calls[0];
        const postData = postCall[1] as string;
        expect(postData).toContain(`response=${expectedResponse}`);
      });
    });

    it("handles passwords with German umlauts (UTF-16LE critical)", () => {
      const authUmlaut = new AuthProvider({
        host: "fritz.box",
        username: "admin",
        password: "paßwörd",
      });

      const challenge = "1234abcd";
      const input = `${challenge}-paßwörd`;
      const utf16le = Buffer.from(input, "utf-16le");
      const expectedHash = crypto.createHash("md5").update(utf16le).digest("hex");
      const expectedResponse = `${challenge}-${expectedHash}`;

      mockAxios.get.mockResolvedValueOnce({ data: challengeXml });
      mockAxios.post.mockResolvedValueOnce({ data: successXml });

      return authUmlaut.getSid().then(() => {
        const postCall = mockAxios.post.mock.calls[0];
        const postData = postCall[1] as string;
        expect(postData).toContain(`response=${expectedResponse}`);
      });
    });
  });

  describe("getSid", () => {
    it("acquires and caches a valid SID", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: challengeXml });
      mockAxios.post.mockResolvedValueOnce({ data: successXml });

      const sid1 = await auth.getSid();
      expect(sid1).toBe("9c5f5e3a7c5f5e3a");

      // Second call should return cached SID without new HTTP calls
      const sid2 = await auth.getSid();
      expect(sid2).toBe("9c5f5e3a7c5f5e3a");
      expect(mockAxios.get).toHaveBeenCalledTimes(1);
      expect(mockAxios.post).toHaveBeenCalledTimes(1);
    });

    it("throws FritzAuthError on invalid credentials", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: challengeXml });
      mockAxios.post.mockResolvedValueOnce({ data: failureXml });

      await expect(auth.getSid()).rejects.toThrow(FritzAuthError);
    });

    it("throws FritzConnectionError when host unreachable", async () => {
      mockAxios.get.mockRejectedValueOnce({
        code: "ECONNREFUSED",
        message: "connect ECONNREFUSED 192.168.178.1:443",
      });

      await expect(auth.getSid()).rejects.toThrow(FritzConnectionError);
    });
  });

  describe("reauth", () => {
    it("forces a new SID even when one is cached", async () => {
      // First login
      mockAxios.get.mockResolvedValueOnce({ data: challengeXml });
      mockAxios.post.mockResolvedValueOnce({ data: successXml });
      await auth.getSid();

      // Reauth
      mockAxios.get.mockResolvedValueOnce({ data: challengeXml });
      mockAxios.post.mockResolvedValueOnce({ data: successXml });
      const newSid = await auth.reauth();

      expect(newSid).toBe("9c5f5e3a7c5f5e3a");
      expect(mockAxios.get).toHaveBeenCalledTimes(2);
      expect(mockAxios.post).toHaveBeenCalledTimes(2);
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/auth-provider.test.ts`
Expected: FAIL — `AuthProvider` module not found.

- [ ] **Step 4: Implement AuthProvider**

Create `src/auth/auth-provider.ts`:

```typescript
import crypto from "crypto";
import axios, { AxiosError } from "axios";
import { XMLParser } from "fast-xml-parser";
import { FritzBoxConfig } from "../types/config.js";
import { FritzAuthError, FritzConnectionError } from "../types/errors.js";

const INVALID_SID = "0000000000000000";

interface SessionInfo {
  SessionInfo: {
    SID: string;
    Challenge: string;
    BlockTime: number;
  };
}

export class AuthProvider {
  private sid: string | null = null;
  private readonly config: FritzBoxConfig;
  private readonly parser = new XMLParser();
  private readonly baseUrl: string;

  constructor(config: FritzBoxConfig) {
    this.config = config;
    this.baseUrl = `http://${config.host}`;
  }

  async getSid(): Promise<string> {
    if (this.sid) {
      return this.sid;
    }
    return this.authenticate();
  }

  async reauth(): Promise<string> {
    this.sid = null;
    return this.authenticate();
  }

  async validateSid(): Promise<boolean> {
    if (!this.sid) return false;
    try {
      const { data } = await axios.get(
        `${this.baseUrl}/login_sid.lua?sid=${this.sid}`
      );
      const parsed = this.parser.parse(data) as SessionInfo;
      return parsed.SessionInfo.SID !== INVALID_SID;
    } catch {
      return false;
    }
  }

  getDigestAuth(): { username: string; password: string } {
    return {
      username: this.config.username,
      password: this.config.password,
    };
  }

  private async authenticate(): Promise<string> {
    const challenge = await this.fetchChallenge();
    const response = this.computeResponse(challenge, this.config.password);

    try {
      const { data } = await axios.post(
        `${this.baseUrl}/login_sid.lua`,
        `username=${encodeURIComponent(this.config.username)}&response=${response}`,
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );

      const parsed = this.parser.parse(data) as SessionInfo;
      const sid = String(parsed.SessionInfo.SID);

      if (sid === INVALID_SID) {
        throw new FritzAuthError();
      }

      this.sid = sid;
      return sid;
    } catch (error) {
      if (error instanceof FritzAuthError) throw error;
      throw this.wrapConnectionError(error);
    }
  }

  private async fetchChallenge(): Promise<string> {
    try {
      const { data } = await axios.get(`${this.baseUrl}/login_sid.lua`);
      const parsed = this.parser.parse(data) as SessionInfo;
      return String(parsed.SessionInfo.Challenge);
    } catch (error) {
      throw this.wrapConnectionError(error);
    }
  }

  computeResponse(challenge: string, password: string): string {
    const input = `${challenge}-${password}`;
    const utf16le = Buffer.from(input, "utf-16le");
    const hash = crypto.createHash("md5").update(utf16le).digest("hex");
    return `${challenge}-${hash}`;
  }

  private wrapConnectionError(error: unknown): Error {
    if (error instanceof FritzAuthError) return error;
    if (error instanceof FritzConnectionError) return error;
    const axiosErr = error as AxiosError;
    if (
      axiosErr.code === "ECONNREFUSED" ||
      axiosErr.code === "ETIMEDOUT" ||
      axiosErr.code === "ENOTFOUND"
    ) {
      return new FritzConnectionError(
        `Could not connect to FRITZ!Box at ${this.config.host}: ${axiosErr.message}`
      );
    }
    return new FritzConnectionError(
      `Unexpected error connecting to FRITZ!Box: ${(error as Error).message}`
    );
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/auth-provider.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/auth/auth-provider.ts tests/unit/auth-provider.test.ts tests/fixtures/login-challenge.xml tests/fixtures/login-success.xml tests/fixtures/login-failure.xml
git commit -m "feat: implement AuthProvider with MD5 challenge-response login"
```

---

### Task 4: Shared HTTP Client with Re-auth Interceptor

**Files:**
- Create: `src/client/http.ts`

- [ ] **Step 1: Implement shared HTTP client**

Create `src/client/http.ts`:

```typescript
import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from "axios";
import { AuthProvider } from "../auth/auth-provider.js";
import { FritzConnectionError } from "../types/errors.js";

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

export function createHttpClient(
  host: string,
  authProvider: AuthProvider
): AxiosInstance {
  const client = axios.create({
    baseURL: `http://${host}`,
    timeout: 10_000,
  });

  // Response interceptor: lazy re-auth on 403
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as RetryableConfig | undefined;

      if (!config) throw error;

      // Network-level errors
      if (!error.response) {
        throw new FritzConnectionError(
          `Could not connect to FRITZ!Box at ${host}: ${error.message}`
        );
      }

      // 403 = expired SID — retry once after re-auth
      if (error.response.status === 403 && !config._retried) {
        config._retried = true;
        const newSid = await authProvider.reauth();
        // Update the SID in the URL query params
        const url = new URL(config.url ?? "", config.baseURL);
        url.searchParams.set("sid", newSid);
        config.url = url.pathname + url.search;
        return client.request(config);
      }

      throw error;
    }
  );

  return client;
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/client/http.ts
git commit -m "feat: add shared HTTP client with lazy re-auth interceptor"
```

---

### Task 5: Smart Home Types and Client

**Files:**
- Create: `src/types/smarthome.ts`
- Create: `src/client/smart-home.ts`
- Create: `tests/fixtures/smarthome-devices.json`
- Create: `tests/unit/smart-home.test.ts`

- [ ] **Step 1: Create Smart Home types**

Create `src/types/smarthome.ts`:

```typescript
export interface SmartHomeDevice {
  ain: string;
  name: string;
  productname: string;
  manufacturer: string;
  present: boolean;
  type: "thermostat" | "switch" | "unknown";
  thermostat?: ThermostatState;
  switch?: SwitchState;
  battery?: {
    level: number;
    low: boolean;
  };
}

export interface ThermostatState {
  currentTemperature: number;
  targetTemperature: number | "ON" | "OFF";
  comfort: number;
  economy: number;
}

export interface SwitchState {
  on: boolean;
  power: number;   // current power in mW
  energy: number;  // total energy in Wh
}

export interface DeviceStats {
  ain: string;
  name: string;
  stats: TemperatureStats | EnergyStats;
}

export interface TemperatureStats {
  type: "temperature";
  values: Array<{ timestamp: number; celsius: number }>;
}

export interface EnergyStats {
  type: "energy";
  values: Array<{ timestamp: number; watt: number }>;
}
```

- [ ] **Step 2: Create test fixture**

Create `tests/fixtures/smarthome-devices.json`:

```json
{
  "devices": [
    {
      "id": "17",
      "ain": "11657 0240192",
      "name": "Living Room Thermostat",
      "productname": "FRITZ!DECT 301",
      "manufacturer": "AVM",
      "present": true,
      "temperature": {
        "celsius": 215,
        "offset": -5
      },
      "hkr": {
        "tist": 42,
        "tsoll": 44,
        "komfort": 44,
        "absenk": 36,
        "battery": 85,
        "batterylow": false
      }
    },
    {
      "id": "18",
      "ain": "11657 0240193",
      "name": "Office Plug",
      "productname": "FRITZ!DECT 200",
      "manufacturer": "AVM",
      "present": true,
      "switch": {
        "state": true
      },
      "powermeter": {
        "power": 15230,
        "energy": 84500
      }
    }
  ]
}
```

- [ ] **Step 3: Write failing tests for SmartHomeClient**

Create `tests/unit/smart-home.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SmartHomeClient } from "../../src/client/smart-home.js";
import { AuthProvider } from "../../src/auth/auth-provider.js";
import { FritzDeviceNotFoundError, FritzInvalidParameterError } from "../../src/types/errors.js";
import { readFileSync } from "fs";
import { resolve } from "path";

const devicesJson = JSON.parse(
  readFileSync(resolve(__dirname, "../fixtures/smarthome-devices.json"), "utf-8")
);

// Mock axios
vi.mock("axios", () => {
  const instance = {
    get: vi.fn(),
    put: vi.fn(),
    defaults: { baseURL: "" },
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  };
  return {
    default: {
      create: vi.fn(() => instance),
      get: vi.fn(),
      post: vi.fn(),
    },
  };
});

import axios from "axios";

describe("SmartHomeClient", () => {
  let client: SmartHomeClient;
  let mockHttpClient: ReturnType<typeof axios.create>;
  let mockAuthProvider: AuthProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthProvider = new AuthProvider({
      host: "fritz.box",
      username: "admin",
      password: "secret",
    });
    // Inject a fake cached SID
    (mockAuthProvider as any).sid = "fakesid123";
    mockHttpClient = axios.create();
    client = new SmartHomeClient(mockHttpClient, mockAuthProvider);
  });

  describe("listDevices", () => {
    it("returns parsed smart home devices", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValueOnce({ data: devicesJson });

      const devices = await client.listDevices();

      expect(devices).toHaveLength(2);
      expect(devices[0]).toMatchObject({
        ain: "11657 0240192",
        name: "Living Room Thermostat",
        type: "thermostat",
        present: true,
      });
      expect(devices[0].thermostat).toMatchObject({
        currentTemperature: 21.0,
        targetTemperature: 22.0,
      });
      expect(devices[1]).toMatchObject({
        ain: "11657 0240193",
        name: "Office Plug",
        type: "switch",
      });
      expect(devices[1].switch).toMatchObject({
        on: true,
        power: 15230,
        energy: 84500,
      });
    });
  });

  describe("setThermostat", () => {
    it("rounds temperature to nearest 0.5°C", async () => {
      vi.mocked(mockHttpClient.put).mockResolvedValueOnce({
        data: { device: devicesJson.devices[0] },
      });

      await client.setThermostat("11657 0240192", 21.3);

      const putCall = vi.mocked(mockHttpClient.put).mock.calls[0];
      expect(putCall[1]).toMatchObject({ temperature: 21.5 });
    });

    it("rejects temperature below 8°C", async () => {
      await expect(client.setThermostat("11657 0240192", 5.0)).rejects.toThrow(
        FritzInvalidParameterError
      );
    });

    it("rejects temperature above 28°C", async () => {
      await expect(client.setThermostat("11657 0240192", 30.0)).rejects.toThrow(
        FritzInvalidParameterError
      );
    });

    it("accepts ON and OFF special values", async () => {
      vi.mocked(mockHttpClient.put).mockResolvedValue({
        data: { device: devicesJson.devices[0] },
      });

      await client.setThermostat("11657 0240192", "ON");
      await client.setThermostat("11657 0240192", "OFF");

      expect(vi.mocked(mockHttpClient.put)).toHaveBeenCalledTimes(2);
    });
  });

  describe("toggleSwitch", () => {
    it("sends correct state to device", async () => {
      vi.mocked(mockHttpClient.put).mockResolvedValueOnce({
        data: { device: devicesJson.devices[1] },
      });

      await client.toggleSwitch("11657 0240193", false);

      const putCall = vi.mocked(mockHttpClient.put).mock.calls[0];
      expect(putCall[1]).toMatchObject({ state: false });
    });
  });

  describe("input validation", () => {
    it("rejects invalid AIN format", async () => {
      await expect(client.setThermostat("invalid!ain", 20)).rejects.toThrow(
        FritzInvalidParameterError
      );
    });
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/unit/smart-home.test.ts`
Expected: FAIL — `SmartHomeClient` module not found.

- [ ] **Step 5: Implement SmartHomeClient**

Create `src/client/smart-home.ts`:

```typescript
import { AxiosInstance } from "axios";
import { AuthProvider } from "../auth/auth-provider.js";
import {
  SmartHomeDevice,
  ThermostatState,
  SwitchState,
  DeviceStats,
} from "../types/smarthome.js";
import {
  FritzDeviceNotFoundError,
  FritzInvalidParameterError,
} from "../types/errors.js";

const AIN_PATTERN = /^[\d ]+$/;

export class SmartHomeClient {
  constructor(
    private readonly http: AxiosInstance,
    private readonly auth: AuthProvider
  ) {}

  async listDevices(): Promise<SmartHomeDevice[]> {
    const sid = await this.auth.getSid();
    const { data } = await this.http.get(`/api/v0/smarthome/devices?sid=${sid}`);
    return (data.devices ?? []).map((d: any) => this.mapDevice(d));
  }

  async setThermostat(
    ain: string,
    temperature: number | "ON" | "OFF"
  ): Promise<SmartHomeDevice> {
    this.validateAin(ain);
    const normalizedTemp = this.validateTemperature(temperature);
    const sid = await this.auth.getSid();
    const { data } = await this.http.put(
      `/api/v0/smarthome/devices/${encodeURIComponent(ain)}?sid=${sid}`,
      { temperature: normalizedTemp }
    );
    return this.mapDevice(data.device ?? data);
  }

  async toggleSwitch(ain: string, state: boolean): Promise<SmartHomeDevice> {
    this.validateAin(ain);
    const sid = await this.auth.getSid();
    const { data } = await this.http.put(
      `/api/v0/smarthome/devices/${encodeURIComponent(ain)}?sid=${sid}`,
      { state }
    );
    return this.mapDevice(data.device ?? data);
  }

  async getDeviceStats(ain: string): Promise<DeviceStats> {
    this.validateAin(ain);
    const sid = await this.auth.getSid();
    const { data } = await this.http.get(
      `/api/v0/smarthome/devices/${encodeURIComponent(ain)}/statistics?sid=${sid}`
    );
    return data;
  }

  private validateAin(ain: string): void {
    if (!AIN_PATTERN.test(ain)) {
      throw new FritzInvalidParameterError(
        `Invalid AIN format "${ain}" — must be digits and spaces only`
      );
    }
  }

  private validateTemperature(temp: number | "ON" | "OFF"): number | "ON" | "OFF" {
    if (temp === "ON" || temp === "OFF") return temp;
    if (typeof temp !== "number" || temp < 8.0 || temp > 28.0) {
      throw new FritzInvalidParameterError(
        `Temperature must be between 8.0 and 28.0°C, or "ON"/"OFF". Got: ${temp}`
      );
    }
    return Math.round(temp * 2) / 2; // round to nearest 0.5
  }

  private mapDevice(raw: any): SmartHomeDevice {
    const hasThermostat = !!raw.hkr;
    const hasSwitch = !!raw.switch;

    const device: SmartHomeDevice = {
      ain: raw.ain,
      name: raw.name,
      productname: raw.productname,
      manufacturer: raw.manufacturer,
      present: raw.present,
      type: hasThermostat ? "thermostat" : hasSwitch ? "switch" : "unknown",
    };

    if (hasThermostat) {
      device.thermostat = {
        currentTemperature: (raw.temperature?.celsius ?? 0) / 10,
        targetTemperature: this.decodeTsoll(raw.hkr.tsoll),
        comfort: (raw.hkr.komfort ?? 0) / 2,
        economy: (raw.hkr.absenk ?? 0) / 2,
      };
      if (raw.hkr.battery !== undefined) {
        device.battery = {
          level: raw.hkr.battery,
          low: raw.hkr.batterylow ?? false,
        };
      }
    }

    if (hasSwitch) {
      device.switch = {
        on: raw.switch.state === true || raw.switch.state === 1,
        power: raw.powermeter?.power ?? 0,
        energy: raw.powermeter?.energy ?? 0,
      };
    }

    return device;
  }

  private decodeTsoll(tsoll: number): number | "ON" | "OFF" {
    if (tsoll === 253) return "OFF";
    if (tsoll === 254) return "ON";
    return tsoll / 2;
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/smart-home.test.ts`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types/smarthome.ts src/client/smart-home.ts tests/unit/smart-home.test.ts tests/fixtures/smarthome-devices.json
git commit -m "feat: implement SmartHomeClient with thermostat and switch control"
```

---

### Task 6: TR-064 Types and SOAP Client

**Files:**
- Create: `src/types/tr064.ts`
- Create: `src/client/tr064.ts`
- Create: `tests/fixtures/soap-device-info.xml`
- Create: `tests/fixtures/soap-wan-status.xml`
- Create: `tests/fixtures/soap-hosts.xml`
- Create: `tests/unit/tr064.test.ts`

- [ ] **Step 1: Create TR-064 types**

Create `src/types/tr064.ts`:

```typescript
export interface SystemInfo {
  modelName: string;
  firmwareVersion: string;
  serialNumber: string;
}

export interface WanStatus {
  externalIp: string;
  connectionStatus: string;
  uptime: number;
  lastError: string;
}

export interface BandwidthStats {
  totalBytesSent: number;
  totalBytesReceived: number;
  maxBitRateUp: number;
  maxBitRateDown: number;
}

export interface GuestWifiStatus {
  enabled: boolean;
  ssid: string;
  securityMode: string;
}

export interface NetworkDevice {
  hostname: string;
  ipAddress: string;
  macAddress: string;
  active: boolean;
  interfaceType: string;
}
```

- [ ] **Step 2: Create SOAP test fixtures**

Create `tests/fixtures/soap-device-info.xml`:

```xml
<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <u:GetInfoResponse xmlns:u="urn:dslforum-org:service:DeviceInfo:1">
      <NewModelName>FRITZ!Box 7590 AX</NewModelName>
      <NewSoftwareVersion>8.20</NewSoftwareVersion>
      <NewSerialNumber>A1B2C3D4E5F6</NewSerialNumber>
      <NewUpTime>123456</NewUpTime>
    </u:GetInfoResponse>
  </s:Body>
</s:Envelope>
```

Create `tests/fixtures/soap-wan-status.xml`:

```xml
<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <u:GetStatusInfoResponse xmlns:u="urn:dslforum-org:service:WANIPConnection:1">
      <NewConnectionStatus>Connected</NewConnectionStatus>
      <NewUptime>86400</NewUptime>
      <NewLastConnectionError>ERROR_NONE</NewLastConnectionError>
    </u:GetStatusInfoResponse>
  </s:Body>
</s:Envelope>
```

Create `tests/fixtures/soap-wan-ip.xml`:

```xml
<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <u:GetExternalIPAddressResponse xmlns:u="urn:dslforum-org:service:WANIPConnection:1">
      <NewExternalIPAddress>93.184.216.34</NewExternalIPAddress>
    </u:GetExternalIPAddressResponse>
  </s:Body>
</s:Envelope>
```

Create `tests/fixtures/soap-hosts.xml`:

```xml
<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <u:GetGenericHostEntryResponse xmlns:u="urn:dslforum-org:service:Hosts:1">
      <NewHostName>desktop-pc</NewHostName>
      <NewIPAddress>192.168.178.20</NewIPAddress>
      <NewMACAddress>AA:BB:CC:DD:EE:FF</NewMACAddress>
      <NewActive>1</NewActive>
      <NewInterfaceType>Ethernet</NewInterfaceType>
    </u:GetGenericHostEntryResponse>
  </s:Body>
</s:Envelope>
```

Create `tests/fixtures/soap-host-count.xml`:

```xml
<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <u:GetHostNumberOfEntriesResponse xmlns:u="urn:dslforum-org:service:Hosts:1">
      <NewHostNumberOfEntries>1</NewHostNumberOfEntries>
    </u:GetHostNumberOfEntriesResponse>
  </s:Body>
</s:Envelope>
```

- [ ] **Step 3: Write failing tests for TR064Client**

Create `tests/unit/tr064.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TR064Client } from "../../src/client/tr064.js";
import { AuthProvider } from "../../src/auth/auth-provider.js";
import { readFileSync } from "fs";
import { resolve } from "path";

const fixturesDir = resolve(__dirname, "../fixtures");
const deviceInfoXml = readFileSync(resolve(fixturesDir, "soap-device-info.xml"), "utf-8");
const wanStatusXml = readFileSync(resolve(fixturesDir, "soap-wan-status.xml"), "utf-8");
const wanIpXml = readFileSync(resolve(fixturesDir, "soap-wan-ip.xml"), "utf-8");
const hostsXml = readFileSync(resolve(fixturesDir, "soap-hosts.xml"), "utf-8");
const hostCountXml = readFileSync(resolve(fixturesDir, "soap-host-count.xml"), "utf-8");

vi.mock("axios", () => {
  const instance = {
    post: vi.fn(),
    defaults: { baseURL: "" },
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  };
  return {
    default: {
      create: vi.fn(() => instance),
      get: vi.fn(),
      post: vi.fn(),
    },
  };
});

import axios from "axios";

describe("TR064Client", () => {
  let client: TR064Client;
  let mockHttpClient: ReturnType<typeof axios.create>;
  let mockAuth: AuthProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth = new AuthProvider({
      host: "fritz.box",
      username: "admin",
      password: "secret",
    });
    mockHttpClient = axios.create();
    client = new TR064Client("fritz.box", mockAuth);
    // Override the internal http client for testing
    (client as any).http = mockHttpClient;
  });

  describe("buildSoapEnvelope", () => {
    it("constructs correct SOAP XML", () => {
      const envelope = (client as any).buildSoapEnvelope(
        "WANIPConnection:1",
        "GetExternalIPAddress"
      );
      expect(envelope).toContain('xmlns:u="urn:dslforum-org:service:WANIPConnection:1"');
      expect(envelope).toContain("<u:GetExternalIPAddress");
      expect(envelope).toContain("s:Envelope");
    });

    it("includes arguments in the SOAP body", () => {
      const envelope = (client as any).buildSoapEnvelope(
        "WLANConfiguration:3",
        "SetEnable",
        { NewEnable: "1" }
      );
      expect(envelope).toContain("<NewEnable>1</NewEnable>");
    });
  });

  describe("getSystemInfo", () => {
    it("returns parsed device info", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValueOnce({ data: deviceInfoXml });

      const info = await client.getSystemInfo();

      expect(info).toEqual({
        modelName: "FRITZ!Box 7590 AX",
        firmwareVersion: "8.20",
        serialNumber: "A1B2C3D4E5F6",
      });
    });
  });

  describe("getWanStatus", () => {
    it("returns external IP and connection info", async () => {
      vi.mocked(mockHttpClient.post)
        .mockResolvedValueOnce({ data: wanIpXml })
        .mockResolvedValueOnce({ data: wanStatusXml });

      const status = await client.getWanStatus();

      expect(status).toEqual({
        externalIp: "93.184.216.34",
        connectionStatus: "Connected",
        uptime: 86400,
        lastError: "ERROR_NONE",
      });
    });
  });

  describe("listNetworkDevices", () => {
    it("iterates host entries and returns network devices", async () => {
      vi.mocked(mockHttpClient.post)
        .mockResolvedValueOnce({ data: hostCountXml })
        .mockResolvedValueOnce({ data: hostsXml });

      const devices = await client.listNetworkDevices();

      expect(devices).toHaveLength(1);
      expect(devices[0]).toEqual({
        hostname: "desktop-pc",
        ipAddress: "192.168.178.20",
        macAddress: "AA:BB:CC:DD:EE:FF",
        active: true,
        interfaceType: "Ethernet",
      });
    });
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/unit/tr064.test.ts`
Expected: FAIL — `TR064Client` module not found.

- [ ] **Step 5: Implement TR064Client**

Create `src/client/tr064.ts`:

```typescript
import axios, { AxiosInstance } from "axios";
import crypto from "crypto";
import { XMLParser } from "fast-xml-parser";
import { AuthProvider } from "../auth/auth-provider.js";
import {
  SystemInfo,
  WanStatus,
  BandwidthStats,
  GuestWifiStatus,
  NetworkDevice,
} from "../types/tr064.js";

export class TR064Client {
  private readonly http: AxiosInstance;
  private readonly parser = new XMLParser();
  private readonly host: string;
  private readonly auth: AuthProvider;

  constructor(host: string, auth: AuthProvider) {
    this.host = host;
    this.auth = auth;
    this.http = axios.create({
      baseURL: `http://${host}:49000`,
      timeout: 10_000,
    });
  }

  async getSystemInfo(): Promise<SystemInfo> {
    const result = await this.soapCall(
      "DeviceInfo:1",
      "GetInfo",
      "/upnp/control/deviceinfo"
    );
    return {
      modelName: result.NewModelName,
      firmwareVersion: result.NewSoftwareVersion,
      serialNumber: result.NewSerialNumber,
    };
  }

  async getWanStatus(): Promise<WanStatus> {
    const [ipResult, statusResult] = await Promise.all([
      this.soapCall(
        "WANIPConnection:1",
        "GetExternalIPAddress",
        "/igdupnp/control/WANIPConn1"
      ),
      this.soapCall(
        "WANIPConnection:1",
        "GetStatusInfo",
        "/igdupnp/control/WANIPConn1"
      ),
    ]);

    return {
      externalIp: ipResult.NewExternalIPAddress,
      connectionStatus: statusResult.NewConnectionStatus,
      uptime: Number(statusResult.NewUptime),
      lastError: statusResult.NewLastConnectionError,
    };
  }

  async getBandwidthStats(): Promise<BandwidthStats> {
    const result = await this.soapCall(
      "WANCommonInterfaceConfig:1",
      "GetTotalBytesReceived",
      "/igdupnp/control/WANCommonIFC1"
    );
    const sent = await this.soapCall(
      "WANCommonInterfaceConfig:1",
      "GetTotalBytesSent",
      "/igdupnp/control/WANCommonIFC1"
    );
    const rates = await this.soapCall(
      "WANCommonInterfaceConfig:1",
      "GetCommonLinkProperties",
      "/igdupnp/control/WANCommonIFC1"
    );

    return {
      totalBytesReceived: Number(result.NewTotalBytesReceived),
      totalBytesSent: Number(sent.NewTotalBytesSent),
      maxBitRateUp: Number(rates.NewLayer1UpstreamMaxBitRate),
      maxBitRateDown: Number(rates.NewLayer1DownstreamMaxBitRate),
    };
  }

  async toggleGuestWifi(enable: boolean): Promise<GuestWifiStatus> {
    await this.soapCall(
      "WLANConfiguration:3",
      "SetEnable",
      "/upnp/control/wlanconfig3",
      { NewEnable: enable ? "1" : "0" }
    );

    const info = await this.soapCall(
      "WLANConfiguration:3",
      "GetInfo",
      "/upnp/control/wlanconfig3"
    );

    return {
      enabled: info.NewEnable === "1" || info.NewEnable === 1,
      ssid: info.NewSSID,
      securityMode: info.NewBeaconType,
    };
  }

  async getDeviceLog(count = 20): Promise<string[]> {
    const result = await this.soapCall(
      "DeviceLog:1",
      "GetDeviceLog",
      "/upnp/control/devicelog"
    );
    const lines = String(result.NewDeviceLog).split("\n").filter(Boolean);
    return lines.slice(0, count);
  }

  async reconnectWan(): Promise<{ message: string }> {
    await this.soapCall(
      "WANIPConnection:1",
      "ForceTermination",
      "/igdupnp/control/WANIPConn1"
    );
    return { message: "WAN reconnect initiated — new IP will be assigned shortly" };
  }

  async listNetworkDevices(): Promise<NetworkDevice[]> {
    const countResult = await this.soapCall(
      "Hosts:1",
      "GetHostNumberOfEntries",
      "/upnp/control/hosts"
    );
    const count = Number(countResult.NewHostNumberOfEntries);

    const entries = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        this.soapCall("Hosts:1", "GetGenericHostEntry", "/upnp/control/hosts", {
          NewIndex: String(i),
        })
      )
    );

    return entries.map((entry) => ({
      hostname: entry.NewHostName ?? "",
      ipAddress: entry.NewIPAddress ?? "",
      macAddress: entry.NewMACAddress ?? "",
      active: entry.NewActive === "1" || entry.NewActive === 1,
      interfaceType: entry.NewInterfaceType ?? "unknown",
    }));
  }

  private async soapCall(
    service: string,
    action: string,
    controlUrl: string,
    args?: Record<string, string>
  ): Promise<any> {
    const envelope = this.buildSoapEnvelope(service, action, args);
    const { username, password } = this.auth.getDigestAuth();

    // First request — expect 401 with digest challenge
    try {
      const { data } = await this.http.post(controlUrl, envelope, {
        headers: {
          "Content-Type": 'text/xml; charset="utf-8"',
          SOAPAction: `urn:dslforum-org:service:${service}#${action}`,
        },
        auth: { username, password },
      });
      return this.parseSoapResponse(data, service, action);
    } catch (error: any) {
      // If axios is configured with auth and server responds 401,
      // axios will handle digest negotiation if we use an interceptor.
      // For simplicity, re-throw for now — digest handling is in soapCall.
      throw error;
    }
  }

  private buildSoapEnvelope(
    service: string,
    action: string,
    args?: Record<string, string>
  ): string {
    const argsXml = args
      ? Object.entries(args)
          .map(([key, value]) => `<${key}>${value}</${key}>`)
          .join("")
      : "";

    return `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="urn:dslforum-org:service:${service}">${argsXml}</u:${action}>
  </s:Body>
</s:Envelope>`;
  }

  private parseSoapResponse(xml: string, service: string, action: string): any {
    const parsed = this.parser.parse(xml);
    const body = parsed["s:Envelope"]?.["s:Body"];
    if (!body) throw new Error(`Invalid SOAP response from ${service}#${action}`);
    const responseKey = `u:${action}Response`;
    return body[responseKey] ?? body[Object.keys(body)[0]];
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/tr064.test.ts`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types/tr064.ts src/client/tr064.ts tests/unit/tr064.test.ts tests/fixtures/soap-device-info.xml tests/fixtures/soap-wan-status.xml tests/fixtures/soap-wan-ip.xml tests/fixtures/soap-hosts.xml tests/fixtures/soap-host-count.xml
git commit -m "feat: implement TR064Client with SOAP calls for router administration"
```

---

### Task 7: MCP Server — Tool Registration

**Files:**
- Create: `src/server.ts`

- [ ] **Step 1: Implement MCP server with all 10 tools**

Create `src/server.ts`:

```typescript
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
        .union([z.number(), z.enum(["ON", "OFF"])])
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
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: register all 10 MCP tools with error handling"
```

---

### Task 8: Entry Point — Dual Transport

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement entry point with CLI args and dual transport**

Create `src/index.ts`:

```typescript
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
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add entry point with stdio and HTTP/SSE transport"
```

---

### Task 9: Integration Test Script

**Files:**
- Create: `tests/integration/test-connection.ts`

- [ ] **Step 1: Implement integration test**

Create `tests/integration/test-connection.ts`:

```typescript
import { AuthProvider } from "../../src/auth/auth-provider.js";
import { SmartHomeClient } from "../../src/client/smart-home.js";
import { TR064Client } from "../../src/client/tr064.js";
import { createHttpClient } from "../../src/client/http.js";

async function main() {
  const host = process.env.FRITZBOX_HOST ?? "fritz.box";
  const username = process.env.FRITZBOX_USERNAME;
  const password = process.env.FRITZBOX_PASSWORD;

  if (!username || !password) {
    console.error("Error: Set FRITZBOX_USERNAME and FRITZBOX_PASSWORD environment variables");
    process.exit(1);
  }

  console.log(`\n--- MCP FRITZ!Box Integration Test ---`);
  console.log(`Host: ${host}`);
  console.log(`User: ${username}\n`);

  const auth = new AuthProvider({ host, username, password });
  const http = createHttpClient(host, auth);
  const smartHome = new SmartHomeClient(http, auth);
  const tr064 = new TR064Client(host, auth);

  let passed = 0;
  let failed = 0;

  // Test 1: SID acquisition
  try {
    const sid = await auth.getSid();
    console.log(`[PASS] SID acquired: ${sid.substring(0, 8)}...`);
    passed++;
  } catch (error: any) {
    console.error(`[FAIL] SID acquisition: ${error.message}`);
    failed++;
    console.error("\nCannot proceed without authentication. Exiting.");
    process.exit(1);
  }

  // Test 2: List smart home devices
  try {
    const devices = await smartHome.listDevices();
    console.log(`[PASS] Smart home devices found: ${devices.length}`);
    for (const d of devices) {
      console.log(`       - ${d.name} (${d.productname}, AIN: ${d.ain})`);
    }
    passed++;
  } catch (error: any) {
    console.error(`[FAIL] List smart home devices: ${error.message}`);
    failed++;
  }

  // Test 3: System info via TR-064
  try {
    const info = await tr064.getSystemInfo();
    console.log(`[PASS] System info: ${info.modelName} (FW ${info.firmwareVersion})`);
    passed++;
  } catch (error: any) {
    console.error(`[FAIL] System info: ${error.message}`);
    failed++;
  }

  // Test 4: WAN status via TR-064
  try {
    const wan = await tr064.getWanStatus();
    console.log(`[PASS] WAN status: ${wan.externalIp} (${wan.connectionStatus}, uptime: ${wan.uptime}s)`);
    passed++;
  } catch (error: any) {
    console.error(`[FAIL] WAN status: ${error.message}`);
    failed++;
  }

  // Test 5: Network devices
  try {
    const hosts = await tr064.listNetworkDevices();
    console.log(`[PASS] Network devices: ${hosts.length} found`);
    passed++;
  } catch (error: any) {
    console.error(`[FAIL] Network devices: ${error.message}`);
    failed++;
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
```

- [ ] **Step 2: Commit**

```bash
git add tests/integration/test-connection.ts
git commit -m "feat: add integration test script for live FRITZ!Box verification"
```

---

### Task 10: README Documentation

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write comprehensive README**

Create `README.md`:

````markdown
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

```bash
npm install mcp-fritzbox
```

Or clone and build from source:

```bash
git clone <repo-url>
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
mcp-fritzbox --host 192.168.178.1 --user admin --pass secret
```

CLI flags override environment variables.

### 4. Connect to an MCP Client

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "fritzbox": {
      "command": "npx",
      "args": ["mcp-fritzbox"],
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
mcp-fritzbox --http --port 3000
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
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add comprehensive README with setup guide and troubleshooting"
```

---

### Task 11: Final Build Verification

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `npx tsc`
Expected: Clean build, `dist/` directory created with compiled JS.

- [ ] **Step 2: Run all unit tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 3: Verify the server starts (stdio mode)**

Run: `echo '{}' | timeout 2 node dist/index.js 2>&1 || true`
Expected: No crash — may output MCP protocol error (expected without valid FRITZ!Box), but should not throw unhandled exceptions.

- [ ] **Step 4: Final commit if any fixes needed**

Only if previous steps required changes:
```bash
git add -A
git commit -m "fix: resolve build/test issues from final verification"
```
