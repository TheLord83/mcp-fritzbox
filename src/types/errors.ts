export class FritzAuthError extends Error {
  readonly code = "AUTH_FAILED" as const;
  constructor(message = "Authentication failed — check username and password") {
    super(message);
    this.name = "FritzAuthError";
  }
}

export class FritzConnectionError extends Error {
  readonly code = "CONNECTION_FAILED" as const;
  constructor(message = "Could not connect to FRITZ!Box") {
    super(message);
    this.name = "FritzConnectionError";
  }
}

export class FritzDeviceNotFoundError extends Error {
  readonly code = "DEVICE_NOT_FOUND" as const;
  constructor(ain: string) {
    super(`Device with AIN "${ain}" not found`);
    this.name = "FritzDeviceNotFoundError";
  }
}

export class FritzInvalidParameterError extends Error {
  readonly code = "INVALID_PARAMETER" as const;
  constructor(message: string) {
    super(message);
    this.name = "FritzInvalidParameterError";
  }
}
