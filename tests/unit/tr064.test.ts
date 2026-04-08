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

/**
 * Helper: simulates the digest auth flow.
 * First call to post() rejects with 401 + WWW-Authenticate header.
 * Second call succeeds with the given response data.
 */
function mockDigestAuth(mockPost: any, responseData: string) {
  mockPost
    .mockRejectedValueOnce({
      response: {
        status: 401,
        headers: {
          "www-authenticate":
            'Digest realm="HTTPS Access",nonce="TEST_NONCE",algorithm=MD5,qop="auth"',
        },
      },
    })
    .mockResolvedValueOnce({ data: responseData });
}

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
    (client as any).http = mockHttpClient;
  });

  describe("buildSoapEnvelope", () => {
    it("constructs correct SOAP XML", () => {
      const envelope = (client as any).buildSoapEnvelope(
        "WANIPConnection:1",
        "GetExternalIPAddress"
      );
      expect(envelope).toContain(
        'xmlns:u="urn:dslforum-org:service:WANIPConnection:1"'
      );
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
    it("returns parsed device info via digest auth", async () => {
      mockDigestAuth(vi.mocked(mockHttpClient.post), deviceInfoXml);

      const info = await client.getSystemInfo();

      expect(info).toEqual({
        modelName: "FRITZ!Box 7590 AX",
        firmwareVersion: "8.20",
        serialNumber: "A1B2C3D4E5F6",
      });
      // Digest flow: 1st call = 401, 2nd call = success with Authorization header
      expect(mockHttpClient.post).toHaveBeenCalledTimes(2);
    });
  });

  describe("getWanStatus", () => {
    it("returns external IP and connection info", async () => {
      // getWanStatus calls Promise.all with two soapCalls concurrently.
      // Each soapCall does: 1st post (401) → 2nd post (success).
      // With concurrent execution, mock calls interleave unpredictably.
      // Use mockImplementation to route based on the SOAP action in the body.
      const mockPost = vi.mocked(mockHttpClient.post);
      const callCounts: Record<string, number> = {};

      mockPost.mockImplementation(async (_url: string, body: string, _config?: any) => {
        const action = body.match(/<u:(\w+)/)?.[1] ?? "unknown";
        callCounts[action] = (callCounts[action] ?? 0) + 1;

        // First call for each action → 401 (digest challenge)
        if (callCounts[action] === 1) {
          const error: any = new Error("401");
          error.response = {
            status: 401,
            headers: {
              "www-authenticate":
                'Digest realm="HTTPS Access",nonce="TEST_NONCE",algorithm=MD5,qop="auth"',
            },
          };
          throw error;
        }

        // Second call → success with data
        if (action === "GetExternalIPAddress") return { data: wanIpXml };
        if (action === "GetStatusInfo") return { data: wanStatusXml };
        throw new Error(`Unexpected action: ${action}`);
      });

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
      // GetHostNumberOfEntries (401 + success)
      mockDigestAuth(vi.mocked(mockHttpClient.post), hostCountXml);
      // GetGenericHostEntry index 0 (401 + success)
      mockDigestAuth(vi.mocked(mockHttpClient.post), hostsXml);

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

  describe("digest auth", () => {
    it("sends correct Authorization header", async () => {
      mockDigestAuth(vi.mocked(mockHttpClient.post), deviceInfoXml);

      await client.getSystemInfo();

      const secondCall = vi.mocked(mockHttpClient.post).mock.calls[1];
      const headers = (secondCall[2] as any).headers;
      expect(headers.Authorization).toMatch(/^Digest /);
      expect(headers.Authorization).toContain('username="admin"');
      expect(headers.Authorization).toContain('realm="HTTPS Access"');
      expect(headers.Authorization).toContain('nonce="TEST_NONCE"');
      expect(headers.Authorization).toContain("qop=auth");
    });
  });
});
