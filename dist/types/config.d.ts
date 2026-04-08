export interface FritzBoxConfig {
    host: string;
    username: string;
    password: string;
}
export interface ServerConfig {
    fritzbox: FritzBoxConfig;
    transport: "stdio" | "http";
    httpPort: number;
}
export declare function resolveConfig(args: string[]): ServerConfig;
