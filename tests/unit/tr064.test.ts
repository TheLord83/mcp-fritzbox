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
