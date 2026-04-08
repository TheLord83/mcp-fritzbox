export function resolveConfig(args) {
    const flagIndex = (flag) => args.indexOf(flag);
    const flagValue = (flag) => {
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
//# sourceMappingURL=config.js.map