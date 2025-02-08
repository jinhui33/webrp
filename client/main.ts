import "../init.ts"
import ProxyClient from "./proxy.ts"
import { env } from "@ayonli/jsext/runtime"

const clientId = env("CLIENT_ID")
const remoteUrl = env("REMOTE_URL")
const localUrl = env("LOCAL_URL")
const connToken = env("CONN_TOKEN")
const pingInterval = Math.max(Number(env("PING_INTERVAL") || "30"), 5) * 1_000
const maxConn = Number(env("MAX_CONN") || "1")

if (!clientId || !remoteUrl || !localUrl) {
    throw new Error("CLIENT_ID, REMOTE_URL and LOCAL_URL must be set")
}

if (maxConn > 1) {
    for (let i = 0; i < maxConn; i++) {
        new ProxyClient({
            clientId: `${clientId}-${i + 1}`,
            remoteUrl,
            localUrl,
            connToken,
            pingInterval,
            logPrefix: `<${clientId}-${i + 1}> `
        }).connect()
    }
} else {
    new ProxyClient({
        clientId,
        remoteUrl,
        localUrl,
        connToken,
        pingInterval,
    }).connect()
}
