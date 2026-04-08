export interface SystemInfo {
    modelName: string;
    firmwareVersion: string;
    serialNumber: string;
}
export interface WanStatus {
    externalIp: string;
    connectionStatus: string;
    uptime: number;
    lastError: string;
}
export interface BandwidthStats {
    totalBytesSent: number;
    totalBytesReceived: number;
    maxBitRateUp: number;
    maxBitRateDown: number;
}
export interface GuestWifiStatus {
    enabled: boolean;
    ssid: string;
    securityMode: string;
}
export interface NetworkDevice {
    hostname: string;
    ipAddress: string;
    macAddress: string;
    active: boolean;
    interfaceType: string;
}
