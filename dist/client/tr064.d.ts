import { AuthProvider } from "../auth/auth-provider.js";
import { SystemInfo, WanStatus, BandwidthStats, GuestWifiStatus, NetworkDevice } from "../types/tr064.js";
export declare class TR064Client {
    private readonly http;
    private readonly parser;
    private readonly host;
    private readonly auth;
    constructor(host: string, auth: AuthProvider);
    getSystemInfo(): Promise<SystemInfo>;
    getWanStatus(): Promise<WanStatus>;
    getBandwidthStats(): Promise<BandwidthStats>;
    toggleGuestWifi(enable: boolean): Promise<GuestWifiStatus>;
    getDeviceLog(count?: number): Promise<string[]>;
    reconnectWan(): Promise<{
        message: string;
    }>;
    listNetworkDevices(): Promise<NetworkDevice[]>;
    private soapCall;
    private buildSoapEnvelope;
    private parseSoapResponse;
}
