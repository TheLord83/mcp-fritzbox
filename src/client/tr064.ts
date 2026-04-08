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
  private readonly parser = new XMLParser({ parseTagValue: false });
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
    const [result, sent, rates] = await Promise.all([
      this.soapCall("WANCommonInterfaceConfig:1", "GetTotalBytesReceived", "/igdupnp/control/WANCommonIFC1"),
      this.soapCall("WANCommonInterfaceConfig:1", "GetTotalBytesSent", "/igdupnp/control/WANCommonIFC1"),
      this.soapCall("WANCommonInterfaceConfig:1", "GetCommonLinkProperties", "/igdupnp/control/WANCommonIFC1"),
    ]);
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

    const { data } = await this.http.post(controlUrl, envelope, {
      headers: {
        "Content-Type": 'text/xml; charset="utf-8"',
        SOAPAction: `urn:dslforum-org:service:${service}#${action}`,
      },
      auth: { username, password },
    });
    return this.parseSoapResponse(data, service, action);
  }

  private buildSoapEnvelope(
    service: string,
    action: string,
    args?: Record<string, string>
  ): string {
    const argsXml = args
      ? Object.entries(args)
          .map(([key, value]) => `<${key}>${this.escapeXml(value)}</${key}>`)
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
    if (body["s:Fault"]) {
      const fault = body["s:Fault"];
      const faultString = fault.faultstring ?? fault.detail ?? "Unknown SOAP fault";
      throw new Error(`SOAP fault from ${service}#${action}: ${faultString}`);
    }
    const responseKey = `u:${action}Response`;
    return body[responseKey] ?? body[Object.keys(body)[0]];
  }

  private escapeXml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}
