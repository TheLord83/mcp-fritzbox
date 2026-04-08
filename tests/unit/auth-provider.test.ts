import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthProvider } from "../../src/auth/auth-provider.js";
import { FritzAuthError, FritzConnectionError } from "../../src/types/errors.js";
import { readFileSync } from "fs";
import { resolve } from "path";
import crypto from "crypto";

const fixturesDir = resolve(__dirname, "../fixtures");
const challengeXml = readFileSync(resolve(fixturesDir, "login-challenge.xml"), "utf-8");
const successXml = readFileSync(resolve(fixturesDir, "login-success.xml"), "utf-8");
const failureXml = readFileSync(resolve(fixturesDir, "login-failure.xml"), "utf-8");

// Mock axios
vi.mock("axios", () => {
  const mockAxios = {
    get: vi.fn(),
    post: vi.fn(),
    create: vi.fn(() => mockAxios),
    defaults: { baseURL: "" },
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  };
  return { default: mockAxios };
});

import axios from "axios";
const mockAxios = vi.mocked(axios);

describe("AuthProvider", () => {
  let auth: AuthProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    auth = new AuthProvider({
      host: "fritz.box",
      username: "admin",
      password: "secret123",
    });
  });

  describe("computeResponse", () => {
    it("computes correct MD5 with UTF-16LE encoding", () => {
      const challenge = "1234abcd";
      const password = "secret123";
      const input = `${challenge}-${password}`;
      const utf16le = Buffer.from(input, "utf-16le");
      const expectedHash = crypto.createHash("md5").update(utf16le).digest("hex");
      const expectedResponse = `${challenge}-${expectedHash}`;

      mockAxios.get.mockResolvedValueOnce({ data: challengeXml });
      mockAxios.post.mockResolvedValueOnce({ data: successXml });

      return auth.getSid().then(() => {
        const postCall = mockAxios.post.mock.calls[0];
        const postData = postCall[1] as string;
        expect(postData).toContain(`response=${expectedResponse}`);
      });
    });

    it("handles passwords with German umlauts (UTF-16LE critical)", () => {
      const authUmlaut = new AuthProvider({
        host: "fritz.box",
        username: "admin",
        password: "paßwörd",
      });

      const challenge = "1234abcd";
      const input = `${challenge}-paßwörd`;
      const utf16le = Buffer.from(input, "utf-16le");
      const expectedHash = crypto.createHash("md5").update(utf16le).digest("hex");
      const expectedResponse = `${challenge}-${expectedHash}`;

      mockAxios.get.mockResolvedValueOnce({ data: challengeXml });
      mockAxios.post.mockResolvedValueOnce({ data: successXml });

      return authUmlaut.getSid().then(() => {
        const postCall = mockAxios.post.mock.calls[0];
        const postData = postCall[1] as string;
        expect(postData).toContain(`response=${expectedResponse}`);
      });
    });
  });

  describe("getSid", () => {
    it("acquires and caches a valid SID", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: challengeXml });
      mockAxios.post.mockResolvedValueOnce({ data: successXml });

      const sid1 = await auth.getSid();
      expect(sid1).toBe("9c5f5e3a7c5f5e3a");

      const sid2 = await auth.getSid();
      expect(sid2).toBe("9c5f5e3a7c5f5e3a");
      expect(mockAxios.get).toHaveBeenCalledTimes(1);
      expect(mockAxios.post).toHaveBeenCalledTimes(1);
    });

    it("throws FritzAuthError on invalid credentials", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: challengeXml });
      mockAxios.post.mockResolvedValueOnce({ data: failureXml });

      await expect(auth.getSid()).rejects.toThrow(FritzAuthError);
    });

    it("throws FritzConnectionError when host unreachable", async () => {
      mockAxios.get.mockRejectedValueOnce({
        code: "ECONNREFUSED",
        message: "connect ECONNREFUSED 192.168.178.1:443",
      });

      await expect(auth.getSid()).rejects.toThrow(FritzConnectionError);
    });
  });

  describe("reauth", () => {
    it("forces a new SID even when one is cached", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: challengeXml });
      mockAxios.post.mockResolvedValueOnce({ data: successXml });
      await auth.getSid();

      mockAxios.get.mockResolvedValueOnce({ data: challengeXml });
      mockAxios.post.mockResolvedValueOnce({ data: successXml });
      const newSid = await auth.reauth();

      expect(newSid).toBe("9c5f5e3a7c5f5e3a");
      expect(mockAxios.get).toHaveBeenCalledTimes(2);
      expect(mockAxios.post).toHaveBeenCalledTimes(2);
    });
  });
});
