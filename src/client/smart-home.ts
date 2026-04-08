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
    return Math.round(temp * 2) / 2;
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
      const rawCelsius = raw.temperature?.celsius ?? 0;
      const offset = raw.temperature?.offset ?? 0;
      device.thermostat = {
        currentTemperature: (rawCelsius + offset) / 10,
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
