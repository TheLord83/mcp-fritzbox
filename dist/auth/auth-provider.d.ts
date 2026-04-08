import { FritzBoxConfig } from "../types/config.js";
export declare class AuthProvider {
    private sid;
    private readonly config;
    private readonly parser;
    private readonly baseUrl;
    constructor(config: FritzBoxConfig);
    getSid(): Promise<string>;
    reauth(): Promise<string>;
    validateSid(): Promise<boolean>;
    getDigestAuth(): {
        username: string;
        password: string;
    };
    private authenticate;
    private fetchChallenge;
    computeResponse(challenge: string, password: string): string;
    private wrapConnectionError;
}
