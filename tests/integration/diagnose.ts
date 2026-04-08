#!/usr/bin/env npx tsx
/**
 * Diagnostic script: probes a real FRITZ!Box to discover available APIs.
 */
import axios from "axios";
import { AuthProvider } from "../../src/auth/auth-provider.js";

const host = process.env.FRITZBOX_HOST ?? "fritz.box";
const username = process.env.FRITZBOX_USERNAME!;
const password = process.env.FRITZBOX_PASSWORD!;

if (!username || !password) {
  console.error("Set FRITZBOX_USERNAME and FRITZBOX_PASSWORD");
  process.exit(1);
}

async function main() {
  const auth = new AuthProvider({ host, username, password });
  const sid = await auth.getSid();
  console.log(`SID acquired: ${sid}\n`);

  // --- Probe Smart Home endpoints ---
  console.log("=== Smart Home API Probes ===\n");

  const smEndpoints = [
    `/api/v0/smarthome/devices`,
    `/api/v0/smarthome/overview`,
    `/api/v0/smarthome/overview/devices`,
    `/webservices/homeautoswitch.lua?switchcmd=getdevicelistinfos&sid=${sid}`,
  ];

  for (const ep of smEndpoints) {
    try {
      const url = `http://${host}${ep}${ep.includes("?") ? "" : `?sid=${sid}`}`;
      const { status, headers, data } = await axios.get(url, { timeout: 5000 });
      const preview = typeof data === "string" ? data.substring(0, 200) : JSON.stringify(data).substring(0, 200);
      console.log(`[${status}] ${ep}`);
      console.log(`  Content-Type: ${headers["content-type"]}`);
      console.log(`  Preview: ${preview}...\n`);
    } catch (e: any) {
      const status = e.response?.status ?? e.code ?? "ERROR";
      console.log(`[${status}] ${ep} — ${e.message}\n`);
    }
  }

  // --- Probe TR-064 ---
  console.log("=== TR-064 Probes ===\n");

  // First: get the service description
  try {
    const { data } = await axios.get(`http://${host}:49000/tr64desc.xml`, { timeout: 5000 });
    console.log(`[OK] TR-064 description available (${data.length} bytes)`);
    // Extract control URLs
    const controlUrls = [...data.matchAll(/<controlURL>(.*?)<\/controlURL>/g)].map((m: any) => m[1]);
    console.log(`  Control URLs found: ${controlUrls.join(", ")}\n`);
  } catch (e: any) {
    console.log(`[FAIL] TR-064 description: ${e.message}\n`);
  }

  // Try a simple SOAP call without auth to see what happens
  const soapEnvelope = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetInfo xmlns:u="urn:dslforum-org:service:DeviceInfo:1"/>
  </s:Body>
</s:Envelope>`;

  // Without auth
  try {
    const { status, data } = await axios.post(
      `http://${host}:49000/upnp/control/deviceinfo`,
      soapEnvelope,
      {
        headers: {
          "Content-Type": 'text/xml; charset="utf-8"',
          SOAPAction: '"urn:dslforum-org:service:DeviceInfo:1#GetInfo"',
        },
        timeout: 5000,
      }
    );
    console.log(`[${status}] DeviceInfo without auth — unexpected success`);
    console.log(`  Preview: ${data.substring(0, 200)}\n`);
  } catch (e: any) {
    const status = e.response?.status;
    if (status === 401) {
      const wwwAuth = e.response?.headers?.["www-authenticate"] ?? "none";
      console.log(`[401] DeviceInfo without auth — expected, auth required`);
      console.log(`  WWW-Authenticate: ${wwwAuth}\n`);
    } else {
      console.log(`[${status ?? e.code}] DeviceInfo without auth: ${e.message}\n`);
    }
  }

  // With digest auth (manual implementation)
  try {
    // Step 1: Get the 401 + nonce
    let wwwAuth = "";
    try {
      await axios.post(
        `http://${host}:49000/upnp/control/deviceinfo`,
        soapEnvelope,
        {
          headers: {
            "Content-Type": 'text/xml; charset="utf-8"',
            SOAPAction: '"urn:dslforum-org:service:DeviceInfo:1#GetInfo"',
          },
          timeout: 5000,
        }
      );
    } catch (e: any) {
      wwwAuth = e.response?.headers?.["www-authenticate"] ?? "";
    }

    if (wwwAuth) {
      // Parse digest challenge
      const realm = wwwAuth.match(/realm="([^"]+)"/)?.[1] ?? "";
      const nonce = wwwAuth.match(/nonce="([^"]+)"/)?.[1] ?? "";
      const qop = wwwAuth.match(/qop="([^"]+)"/)?.[1] ?? "";

      console.log(`Digest challenge: realm="${realm}", qop="${qop}"`);

      // Step 2: Compute digest response
      const crypto = await import("crypto");
      const ha1 = crypto.createHash("md5").update(`${username}:${realm}:${password}`).digest("hex");
      const ha2 = crypto.createHash("md5").update(`POST:/upnp/control/deviceinfo`).digest("hex");
      const nc = "00000001";
      const cnonce = crypto.randomBytes(8).toString("hex");
      const digestResponse = crypto.createHash("md5")
        .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
        .digest("hex");

      const authHeader = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="/upnp/control/deviceinfo", response="${digestResponse}", qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;

      const { status, data } = await axios.post(
        `http://${host}:49000/upnp/control/deviceinfo`,
        soapEnvelope,
        {
          headers: {
            "Content-Type": 'text/xml; charset="utf-8"',
            SOAPAction: '"urn:dslforum-org:service:DeviceInfo:1#GetInfo"',
            Authorization: authHeader,
          },
          timeout: 5000,
        }
      );
      console.log(`[${status}] DeviceInfo WITH digest auth — SUCCESS!`);
      console.log(`  Preview: ${data.substring(0, 300)}\n`);
    }
  } catch (e: any) {
    console.log(`[${e.response?.status ?? e.code}] DeviceInfo with digest: ${e.message}\n`);
  }
}

main().catch(console.error);
