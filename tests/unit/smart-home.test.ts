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
