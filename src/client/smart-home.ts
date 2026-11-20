import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import { AuthProvider } from "../auth/auth-provider.js";
import {
  SmartHomeDevice,
  DeviceStats,
} from "../types/smarthome.js";
import {
  FritzDeviceNotFoundError,
  FritzInvalidParameterError,
} from "../types/errors.js";

const AIN_PATTERN = /^[\d ]+$/;

/**
 * Smart Home client using the AHA-HTTP interface (homeautoswitch.lua).
 * This is the stable interface available since FRITZ!OS 5.53.
 * Returns XML responses parsed to JSON.
 */
export class SmartHomeClient {
  private readonly baseUrl: string;
  private readonly parser = new XMLParser({
    parseTagValue: false,
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });

  constructor(
    private readonly host: string,
    private readonly auth: AuthProvider
  ) {
    this.baseUrl = `http://${host}`;
  }

  async listDevices(): Promise<SmartHomeDevice[]> {
    const xml = await this.command("getdevicelistinfos");
    const parsed = this.parser.parse(xml);
    const devicelist = parsed.devicelist;
    if (!devicelist?.device) return [];
    const devices = Array.isArray(devicelist.device)
      ? devicelist.device
      : [devicelist.device];
    return devices.map((d: any) => this.mapDevice(d));
  }

  async setThermostat(
    ain: string,
    temperature: number | "ON" | "OFF"
  ): Promise<{ ain: string; temperature: number | "ON" | "OFF" }> {
    this.validateAin(ain);
    const param = this.encodeTemperature(temperature);
    await this.command("sethkrtsoll", ain, `&param=${param}`);
    return { ain, temperature: typeof temperature === "number" ? Math.round(temperature * 2) / 2 : temperature };
  }

  async toggleSwitch(ain: string, state: boolean): Promise<{ ain: string; state: boolean }> {
    this.validateAin(ain);
    const cmd = state ? "setswitchon" : "setswitchoff";
    await this.command(cmd, ain);
    return { ain, state };
  }

  async getDeviceStats(ain: string): Promise<DeviceStats> {
    this.validateAin(ain);
    const xml = await this.command("getbasicdevicestats", ain);
    const parsed = this.parser.parse(xml);
    return {
      ain,
      name: "",
      stats: parsed,
    };
  }

  private async command(cmd: string, ain?: string, extra = ""): Promise<string> {
    const ainParam = ain ? `&ain=${encodeURIComponent(ain)}` : "";
    const buildUrl = (sid: string) =>
      `${this.baseUrl}/webservices/homeautoswitch.lua?switchcmd=${cmd}${ainParam}&sid=${sid}${extra}`;

    const sid = await this.auth.getSid();
    try {
      const { data } = await axios.get(buildUrl(sid), { timeout: 10_000 });
      return String(data);
    } catch (error) {
      // 401/403 on the AHA interface means the cached SID is expired or invalid.
      // Re-authenticate once and retry, mirroring the TR-064 client interceptor.
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      if (status !== 401 && status !== 403) throw error;
      const newSid = await this.auth.reauth();
      const { data } = await axios.get(buildUrl(newSid), { timeout: 10_000 });
      return String(data);
    }
  }

  private validateAin(ain: string): void {
    if (!AIN_PATTERN.test(ain)) {
      throw new FritzInvalidParameterError(
        `Invalid AIN format "${ain}" — must be digits and spaces only`
      );
    }
  }

  private encodeTemperature(temp: number | "ON" | "OFF"): number {
    if (temp === "ON") return 254;
    if (temp === "OFF") return 253;
    if (typeof temp !== "number" || temp < 8.0 || temp > 28.0) {
      throw new FritzInvalidParameterError(
        `Temperature must be between 8.0 and 28.0°C, or "ON"/"OFF". Got: ${temp}`
      );
    }
    return Math.round(temp * 2);
  }

  private mapDevice(raw: any): SmartHomeDevice {
    const functionbitmask = Number(raw["@_functionbitmask"] ?? 0);
    const hasThermostat = !!(functionbitmask & (1 << 6)); // Bit 6 = HKR
    const hasSwitch = !!(functionbitmask & (1 << 9));      // Bit 9 = switch
    const hasPowermeter = !!(functionbitmask & (1 << 7));  // Bit 7 = power meter

    const device: SmartHomeDevice = {
      ain: raw["@_identifier"]?.trim() ?? "",
      name: raw.name ?? "",
      productname: raw["@_productname"] ?? "",
      manufacturer: raw["@_manufacturer"] ?? "",
      present: raw.present === "1",
      type: hasThermostat ? "thermostat" : hasSwitch ? "switch" : "unknown",
    };

    if (hasThermostat && raw.hkr) {
      device.thermostat = {
        currentTemperature: raw.temperature
          ? Number(raw.temperature.celsius) / 10
          : 0,
        targetTemperature: this.decodeTsoll(Number(raw.hkr.tsoll)),
        comfort: Number(raw.hkr.komfort) / 2,
        economy: Number(raw.hkr.absenk) / 2,
      };
      if (raw.hkr.battery !== undefined) {
        device.battery = {
          level: Number(raw.hkr.battery),
          low: raw.hkr.batterylow === "1",
        };
      }
    }

    if ((hasSwitch || hasPowermeter) && raw.switch) {
      device.switch = {
        on: raw.switch.state === "1",
        power: Number(raw.powermeter?.power ?? 0),
        energy: Number(raw.powermeter?.energy ?? 0),
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
