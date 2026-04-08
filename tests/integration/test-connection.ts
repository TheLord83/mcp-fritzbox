import { AuthProvider } from "../../src/auth/auth-provider.js";
import { SmartHomeClient } from "../../src/client/smart-home.js";
import { TR064Client } from "../../src/client/tr064.js";

async function main() {
  const host = process.env.FRITZBOX_HOST ?? "fritz.box";
  const username = process.env.FRITZBOX_USERNAME;
  const password = process.env.FRITZBOX_PASSWORD;

  if (!username || !password) {
    console.error("Error: Set FRITZBOX_USERNAME and FRITZBOX_PASSWORD environment variables");
    process.exit(1);
  }

  console.log(`\n--- MCP FRITZ!Box Integration Test ---`);
  console.log(`Host: ${host}`);
  console.log(`User: ${username}\n`);

  const auth = new AuthProvider({ host, username, password });
  const smartHome = new SmartHomeClient(host, auth);
  const tr064 = new TR064Client(host, auth);

  let passed = 0;
  let failed = 0;

  // Test 1: SID acquisition
  try {
    const sid = await auth.getSid();
    console.log(`[PASS] SID acquired: ${sid.substring(0, 8)}...`);
    passed++;
  } catch (error: any) {
    console.error(`[FAIL] SID acquisition: ${error.message}`);
    failed++;
    console.error("\nCannot proceed without authentication. Exiting.");
    process.exit(1);
  }

  // Test 2: List smart home devices
  try {
    const devices = await smartHome.listDevices();
    console.log(`[PASS] Smart home devices found: ${devices.length}`);
    for (const d of devices) {
      console.log(`       - ${d.name} (${d.productname}, AIN: ${d.ain})`);
    }
    passed++;
  } catch (error: any) {
    console.error(`[FAIL] List smart home devices: ${error.message}`);
    failed++;
  }

  // Test 3: System info via TR-064
  try {
    const info = await tr064.getSystemInfo();
    console.log(`[PASS] System info: ${info.modelName} (FW ${info.firmwareVersion})`);
    passed++;
  } catch (error: any) {
    console.error(`[FAIL] System info: ${error.message}`);
    failed++;
  }

  // Test 4: WAN status via TR-064
  try {
    const wan = await tr064.getWanStatus();
    console.log(`[PASS] WAN status: ${wan.externalIp} (${wan.connectionStatus}, uptime: ${wan.uptime}s)`);
    passed++;
  } catch (error: any) {
    console.error(`[FAIL] WAN status: ${error.message}`);
    failed++;
  }

  // Test 5: Network devices
  try {
    const hosts = await tr064.listNetworkDevices();
    console.log(`[PASS] Network devices: ${hosts.length} found`);
    passed++;
  } catch (error: any) {
    console.error(`[FAIL] Network devices: ${error.message}`);
    failed++;
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
