import { describe, it, expect, vi, beforeEach } from "vitest";
import { SmartHomeClient } from "../../src/client/smart-home.js";
import { AuthProvider } from "../../src/auth/auth-provider.js";
import { FritzInvalidParameterError } from "../../src/types/errors.js";
import { readFileSync } from "fs";
import { resolve } from "path";

const devicesXml = readFileSync(
  resolve(__dirname, "../fixtures/smarthome-devices.xml"),
  "utf-8"
);

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

describe("SmartHomeClient", () => {
  let client: SmartHomeClient;
  let mockAuthProvider: AuthProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthProvider = new AuthProvider({
      host: "fritz.box",
      username: "admin",
      password: "secret",
    });
    (mockAuthProvider as any).sid = "fakesid123";
    client = new SmartHomeClient("fritz.box", mockAuthProvider);
  });

  describe("listDevices", () => {
    it("parses XML device list from homeautoswitch.lua", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: devicesXml });

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
      expect(devices[0].battery).toMatchObject({
        level: 85,
        low: false,
      });
    });

    it("parses switch devices with power meter", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: devicesXml });

      const devices = await client.listDevices();

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

    it("calls homeautoswitch.lua with correct URL", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: devicesXml });

      await client.listDevices();

      const url = mockAxios.get.mock.calls[0][0] as string;
      expect(url).toContain("/webservices/homeautoswitch.lua");
      expect(url).toContain("switchcmd=getdevicelistinfos");
      expect(url).toContain("sid=fakesid123");
    });
  });

  describe("setThermostat", () => {
    it("encodes temperature as param (temp * 2)", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: "OK" });

      await client.setThermostat("11657 0240192", 21.5);

      const url = mockAxios.get.mock.calls[0][0] as string;
      expect(url).toContain("switchcmd=sethkrtsoll");
      expect(url).toContain("param=43"); // 21.5 * 2 = 43
      expect(url).toContain("ain=11657%200240192");
    });

    it("encodes ON as param 254", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: "OK" });

      await client.setThermostat("11657 0240192", "ON");

      const url = mockAxios.get.mock.calls[0][0] as string;
      expect(url).toContain("param=254");
    });

    it("encodes OFF as param 253", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: "OK" });

      await client.setThermostat("11657 0240192", "OFF");

      const url = mockAxios.get.mock.calls[0][0] as string;
      expect(url).toContain("param=253");
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
  });

  describe("toggleSwitch", () => {
    it("calls setswitchon for state=true", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: "1" });

      await client.toggleSwitch("11657 0240193", true);

      const url = mockAxios.get.mock.calls[0][0] as string;
      expect(url).toContain("switchcmd=setswitchon");
    });

    it("calls setswitchoff for state=false", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: "0" });

      await client.toggleSwitch("11657 0240193", false);

      const url = mockAxios.get.mock.calls[0][0] as string;
      expect(url).toContain("switchcmd=setswitchoff");
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
