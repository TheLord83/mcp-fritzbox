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
    // Use WANPPPConnection for DSL, WANIPConnection for cable/fiber.
    // Try WANPPPConnection first (more common on FRITZ!Box), fall back to WANIPConnection.
    let ipResult: any;
    let statusResult: any;

    try {
      [ipResult, statusResult] = await Promise.all([
        this.soapCall(
          "WANPPPConnection:1",
          "GetExternalIPAddress",
          "/upnp/control/wanpppconn1"
        ),
        this.soapCall(
          "WANPPPConnection:1",
          "GetStatusInfo",
          "/upnp/control/wanpppconn1"
        ),
      ]);
    } catch {
      // Fall back to WANIPConnection (cable/fiber)
      [ipResult, statusResult] = await Promise.all([
        this.soapCall(
          "WANIPConnection:1",
          "GetExternalIPAddress",
          "/upnp/control/wanipconnection1"
        ),
        this.soapCall(
          "WANIPConnection:1",
          "GetStatusInfo",
          "/upnp/control/wanipconnection1"
        ),
      ]);
    }

    return {
      externalIp: ipResult.NewExternalIPAddress,
      connectionStatus: statusResult.NewConnectionStatus,
      uptime: Number(statusResult.NewUptime),
      lastError: statusResult.NewLastConnectionError,
    };
  }

  async getBandwidthStats(): Promise<BandwidthStats> {
    const [received, sent, rates] = await Promise.all([
      this.soapCall("WANCommonInterfaceConfig:1", "GetTotalBytesReceived", "/upnp/control/wancommonifconfig1"),
      this.soapCall("WANCommonInterfaceConfig:1", "GetTotalBytesSent", "/upnp/control/wancommonifconfig1"),
      this.soapCall("WANCommonInterfaceConfig:1", "GetCommonLinkProperties", "/upnp/control/wancommonifconfig1"),
    ]);
    return {
      totalBytesReceived: Number(received.NewTotalBytesReceived),
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
    // GetDeviceLog is an action on DeviceInfo:1, not a separate service
    const result = await this.soapCall(
      "DeviceInfo:1",
      "GetDeviceLog",
      "/upnp/control/deviceinfo"
    );
    const lines = String(result.NewDeviceLog).split("\n").filter(Boolean);
    return lines.slice(0, count);
  }

  async reconnectWan(): Promise<{ message: string }> {
    // Try WANPPPConnection first, fall back to WANIPConnection
    try {
      await this.soapCall(
        "WANPPPConnection:1",
        "ForceTermination",
        "/upnp/control/wanpppconn1"
      );
    } catch {
      await this.soapCall(
        "WANIPConnection:1",
        "ForceTermination",
        "/upnp/control/wanipconnection1"
      );
    }
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
    const headers = {
      "Content-Type": 'text/xml; charset="utf-8"',
      SOAPAction: `"urn:dslforum-org:service:${service}#${action}"`,
    };

    // Step 1: Send request without auth to get the digest challenge
    let wwwAuthenticate: string;
    try {
      const { data } = await this.http.post(controlUrl, envelope, { headers });
      // Some actions don't require auth
      return this.parseSoapResponse(data, service, action);
    } catch (error: any) {
      if (error.response?.status !== 401) throw error;
      wwwAuthenticate = error.response.headers["www-authenticate"] ?? "";
      if (!wwwAuthenticate.startsWith("Digest")) throw error;
    }

    // Step 2: Parse digest challenge and compute response
    const authHeader = this.computeDigestAuth(
      wwwAuthenticate,
      "POST",
      controlUrl
    );

    // Step 3: Retry with digest auth header
    const { data } = await this.http.post(controlUrl, envelope, {
      headers: { ...headers, Authorization: authHeader },
    });
    return this.parseSoapResponse(data, service, action);
  }

  private computeDigestAuth(
    wwwAuthenticate: string,
    method: string,
    uri: string
  ): string {
    const { username, password } = this.auth.getDigestAuth();

    const realm = wwwAuthenticate.match(/realm="([^"]+)"/)?.[1] ?? "";
    const nonce = wwwAuthenticate.match(/nonce="([^"]+)"/)?.[1] ?? "";
    const qop = wwwAuthenticate.match(/qop="([^"]+)"/)?.[1] ?? "auth";

    const ha1 = crypto
      .createHash("md5")
      .update(`${username}:${realm}:${password}`)
      .digest("hex");
    const ha2 = crypto
      .createHash("md5")
      .update(`${method}:${uri}`)
      .digest("hex");

    const nc = "00000001";
    const cnonce = crypto.randomBytes(8).toString("hex");

    const response = crypto
      .createHash("md5")
      .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
      .digest("hex");

    return `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}", qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
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
