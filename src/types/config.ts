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

export function resolveConfig(args: string[]): ServerConfig {
  const flagIndex = (flag: string) => args.indexOf(flag);
  const flagValue = (flag: string) => {
    const i = flagIndex(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
  };

  return {
    fritzbox: {
      host: flagValue("--host") ?? process.env.FRITZBOX_HOST ?? "fritz.box",
      username: flagValue("--user") ?? process.env.FRITZBOX_USERNAME ?? "",
      password: flagValue("--pass") ?? process.env.FRITZBOX_PASSWORD ?? "",
    },
    transport: args.includes("--http") ? "http" : "stdio",
    httpPort: Number(flagValue("--port") ?? "3000"),
  };
}
