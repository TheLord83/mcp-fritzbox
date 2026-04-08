import { AxiosInstance } from "axios";
import { AuthProvider } from "../auth/auth-provider.js";
import { SmartHomeDevice, DeviceStats } from "../types/smarthome.js";
export declare class SmartHomeClient {
    private readonly http;
    private readonly auth;
    constructor(http: AxiosInstance, auth: AuthProvider);
    listDevices(): Promise<SmartHomeDevice[]>;
    setThermostat(ain: string, temperature: number | "ON" | "OFF"): Promise<SmartHomeDevice>;
    toggleSwitch(ain: string, state: boolean): Promise<SmartHomeDevice>;
    getDeviceStats(ain: string): Promise<DeviceStats>;
    private validateAin;
    private validateTemperature;
    private mapDevice;
    private decodeTsoll;
}
