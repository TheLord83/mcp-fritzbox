import { AuthProvider } from "../../src/auth/auth-provider.js";
import { SmartHomeClient } from "../../src/client/smart-home.js";
import { TR064Client } from "../../src/client/tr064.js";

async function main() {
  const host = process.env.FRITZBOX_HOST as string;
  const cfg = {
    host,
    username: process.env.FRITZBOX_USERNAME as string,
    password: process.env.FRITZBOX_PASSWORD as string,
  };
  const auth = new AuthProvider(cfg);
  const sh = new SmartHomeClient(host, auth);
  const tr = new TR064Client(host, auth);
  const step = async (label: string, fn: () => Promise<unknown>) => {
    try {
      const r = await fn();
      const preview = Array.isArray(r) ? `${r.length} Einträge` : JSON.stringify(r).slice(0, 160);
      console.log(`[OK]    ${label}: ${preview}`);
    } catch (e) {
      console.log(`[FEHLER] ${label}: ${(e as Error).message}`);
    }
  };
  await step("getSystemInfo", () => tr.getSystemInfo());
  await step("getDeviceLog", () => tr.getDeviceLog(10));
  await step("listNetworkDevices", () => tr.listNetworkDevices());
  await step("smartHome.listDevices", () => sh.listDevices());
  await step("getWanStatus", () => tr.getWanStatus());
}

main();
