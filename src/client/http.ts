import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from "axios";
import { AuthProvider } from "../auth/auth-provider.js";
import { FritzConnectionError } from "../types/errors.js";

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

export function createHttpClient(
  host: string,
  authProvider: AuthProvider
): AxiosInstance {
  const client = axios.create({
    baseURL: `http://${host}`,
    timeout: 10_000,
  });

  // Response interceptor: lazy re-auth on 403
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as RetryableConfig | undefined;

      if (!config) throw error;

      // Network-level errors
      if (!error.response) {
        throw new FritzConnectionError(
          `Could not connect to FRITZ!Box at ${host}: ${error.message}`
        );
      }

      // 403 = expired SID — retry once after re-auth
      if (error.response.status === 403 && !config._retried) {
        config._retried = true;
        const newSid = await authProvider.reauth();
        // Update the SID in the URL query params
        const url = new URL(config.url ?? "", config.baseURL);
        url.searchParams.set("sid", newSid);
        config.url = url.pathname + url.search;
        return client.request(config);
      }

      throw error;
    }
  );

  return client;
}
