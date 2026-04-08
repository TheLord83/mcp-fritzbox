export class FritzAuthError extends Error {
    code = "AUTH_FAILED";
    constructor(message = "Authentication failed — check username and password") {
        super(message);
        this.name = "FritzAuthError";
    }
}
export class FritzConnectionError extends Error {
    code = "CONNECTION_FAILED";
    constructor(message = "Could not connect to FRITZ!Box") {
        super(message);
        this.name = "FritzConnectionError";
    }
}
export class FritzDeviceNotFoundError extends Error {
    code = "DEVICE_NOT_FOUND";
    constructor(ain) {
        super(`Device with AIN "${ain}" not found`);
        this.name = "FritzDeviceNotFoundError";
    }
}
export class FritzInvalidParameterError extends Error {
    code = "INVALID_PARAMETER";
    constructor(message) {
        super(message);
        this.name = "FritzInvalidParameterError";
    }
}
//# sourceMappingURL=errors.js.map