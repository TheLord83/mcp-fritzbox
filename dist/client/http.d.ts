import { AxiosInstance } from "axios";
import { AuthProvider } from "../auth/auth-provider.js";
export declare function createHttpClient(host: string, authProvider: AuthProvider): AxiosInstance;
