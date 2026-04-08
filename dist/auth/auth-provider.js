import crypto from "crypto";
import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import { FritzAuthError, FritzConnectionError } from "../types/errors.js";
const INVALID_SID = "0000000000000000";
export class AuthProvider {
    sid = null;
    config;
    parser = new XMLParser({ parseTagValue: false });
    baseUrl;
    constructor(config) {
        this.config = config;
        this.baseUrl = `http://${config.host}`;
    }
    async getSid() {
        if (this.sid) {
            return this.sid;
        }
        return this.authenticate();
    }
    async reauth() {
        this.sid = null;
        return this.authenticate();
    }
    async validateSid() {
        if (!this.sid)
            return false;
        try {
            const { data } = await axios.get(`${this.baseUrl}/login_sid.lua?sid=${this.sid}`);
            const parsed = this.parser.parse(data);
            return parsed.SessionInfo.SID !== INVALID_SID;
        }
        catch {
            return false;
        }
    }
    getDigestAuth() {
        return {
            username: this.config.username,
            password: this.config.password,
        };
    }
    async authenticate() {
        const challenge = await this.fetchChallenge();
        const response = this.computeResponse(challenge, this.config.password);
        try {
            const { data } = await axios.post(`${this.baseUrl}/login_sid.lua`, `username=${encodeURIComponent(this.config.username)}&response=${response}`, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
            const parsed = this.parser.parse(data);
            const sid = String(parsed.SessionInfo.SID);
            if (sid === INVALID_SID) {
                throw new FritzAuthError();
            }
            this.sid = sid;
            return sid;
        }
        catch (error) {
            if (error instanceof FritzAuthError)
                throw error;
            throw this.wrapConnectionError(error);
        }
    }
    async fetchChallenge() {
        try {
            const { data } = await axios.get(`${this.baseUrl}/login_sid.lua`);
            const parsed = this.parser.parse(data);
            return String(parsed.SessionInfo.Challenge);
        }
        catch (error) {
            throw this.wrapConnectionError(error);
        }
    }
    computeResponse(challenge, password) {
        const input = `${challenge}-${password}`;
        const utf16le = Buffer.from(input, "utf-16le");
        const hash = crypto.createHash("md5").update(utf16le).digest("hex");
        return `${challenge}-${hash}`;
    }
    wrapConnectionError(error) {
        if (error instanceof FritzAuthError)
            return error;
        if (error instanceof FritzConnectionError)
            return error;
        const axiosErr = error;
        if (axiosErr.code === "ECONNREFUSED" ||
            axiosErr.code === "ETIMEDOUT" ||
            axiosErr.code === "ENOTFOUND") {
            return new FritzConnectionError(`Could not connect to FRITZ!Box at ${this.config.host}: ${axiosErr.message}`);
        }
        return new FritzConnectionError(`Unexpected error connecting to FRITZ!Box: ${error.message}`);
    }
}
//# sourceMappingURL=auth-provider.js.map