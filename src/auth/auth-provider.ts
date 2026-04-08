import crypto from "crypto";
import axios, { AxiosError } from "axios";
import { XMLParser } from "fast-xml-parser";
import { FritzBoxConfig } from "../types/config.js";
import { FritzAuthError, FritzConnectionError } from "../types/errors.js";

const INVALID_SID = "0000000000000000";

interface SessionInfo {
  SessionInfo: {
    SID: string;
    Challenge: string;
    BlockTime: number;
  };
}

export class AuthProvider {
  private sid: string | null = null;
  private readonly config: FritzBoxConfig;
  private readonly parser = new XMLParser({ parseTagValue: false });
  private readonly baseUrl: string;

  constructor(config: FritzBoxConfig) {
    this.config = config;
    this.baseUrl = `http://${config.host}`;
  }

  async getSid(): Promise<string> {
    if (this.sid) {
      return this.sid;
    }
    return this.authenticate();
  }

  async reauth(): Promise<string> {
    this.sid = null;
    return this.authenticate();
  }

  async validateSid(): Promise<boolean> {
    if (!this.sid) return false;
    try {
      const { data } = await axios.get(
        `${this.baseUrl}/login_sid.lua?sid=${this.sid}`
      );
      const parsed = this.parser.parse(data) as SessionInfo;
      return parsed.SessionInfo.SID !== INVALID_SID;
    } catch {
      return false;
    }
  }

  getDigestAuth(): { username: string; password: string } {
    return {
      username: this.config.username,
      password: this.config.password,
    };
  }

  private async authenticate(): Promise<string> {
    const challenge = await this.fetchChallenge();
    const response = this.computeResponse(challenge, this.config.password);

    try {
      const { data } = await axios.post(
        `${this.baseUrl}/login_sid.lua`,
        `username=${encodeURIComponent(this.config.username)}&response=${response}`,
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );

      const parsed = this.parser.parse(data) as SessionInfo;
      const sid = String(parsed.SessionInfo.SID);

      if (sid === INVALID_SID) {
        throw new FritzAuthError();
      }

      this.sid = sid;
      return sid;
    } catch (error) {
      if (error instanceof FritzAuthError) throw error;
      throw this.wrapConnectionError(error);
    }
  }

  private async fetchChallenge(): Promise<string> {
    try {
      const { data } = await axios.get(`${this.baseUrl}/login_sid.lua`);
      const parsed = this.parser.parse(data) as SessionInfo;
      return String(parsed.SessionInfo.Challenge);
    } catch (error) {
      throw this.wrapConnectionError(error);
    }
  }

  private computeResponse(challenge: string, password: string): string {
    const input = `${challenge}-${password}`;
    const utf16le = Buffer.from(input, "utf-16le");
    const hash = crypto.createHash("md5").update(utf16le).digest("hex");
    return `${challenge}-${hash}`;
  }

  private wrapConnectionError(error: unknown): Error {
    if (error instanceof FritzAuthError) return error;
    if (error instanceof FritzConnectionError) return error;
    const axiosErr = error as AxiosError;
    if (
      axiosErr.code === "ECONNREFUSED" ||
      axiosErr.code === "ETIMEDOUT" ||
      axiosErr.code === "ENOTFOUND"
    ) {
      return new FritzConnectionError(
        `Could not connect to FRITZ!Box at ${this.config.host}: ${axiosErr.message}`
      );
    }
    return new FritzConnectionError(
      `Unexpected error connecting to FRITZ!Box: ${(error as Error).message}`
    );
  }
}
