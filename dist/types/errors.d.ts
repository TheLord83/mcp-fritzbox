export declare class FritzAuthError extends Error {
    readonly code: "AUTH_FAILED";
    constructor(message?: string);
}
export declare class FritzConnectionError extends Error {
    readonly code: "CONNECTION_FAILED";
    constructor(message?: string);
}
export declare class FritzDeviceNotFoundError extends Error {
    readonly code: "DEVICE_NOT_FOUND";
    constructor(ain: string);
}
export declare class FritzInvalidParameterError extends Error {
    readonly code: "INVALID_PARAMETER";
    constructor(message: string);
}
