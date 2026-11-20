/**
 * Simuliert die abgelaufene SID: der Client-Cache wird mit einer ungültigen SID
 * vorbelegt. Ohne Reauth-Fix -> HTTP 403, mit Fix -> zweiter Versuch mit
 * frischer SID und Geräteliste.
 */
import { AuthProvider } from "../../src/auth/auth-provider.js";
import { SmartHomeClient } from "../../src/client/smart-home.js";

async function main() {
  const host = process.env.FRITZBOX_HOST as string;
  const cfg = {
    host,
    username: process.env.FRITZBOX_USERNAME as string,
    password: process.env.FRITZBOX_PASSWORD as string,
  };
  const auth = new AuthProvider(cfg);
  (auth as unknown as { sid: string | null }).sid = "0123456789abcdef";
  console.log("Client-Cache mit ungültiger SID vorbelegt");

  const sh = new SmartHomeClient(host, auth);
  try {
    const devices = await sh.listDevices();
    console.log("ERGEBNIS: OK —", devices.length, "Geräte (Reauth hat gegriffen)");
  } catch (e) {
    console.log("ERGEBNIS: FEHLER —", (e as Error).message);
    process.exitCode = 1;
  }
}

main();
