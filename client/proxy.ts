import "../init.ts"
import { Result } from "@ayonli/jsext/result"
import { stripEnd } from "@ayonli/jsext/string"
import { WebSocket } from "@ayonli/jsext/ws"
import { pack, unpack } from "msgpackr"
import process from "node:process"
import {
    ProxyRequestBodyFrame,
    ProxyRequestHeaderFrame,
    ProxyResponseBodyFrame,
    ProxyResponseHeaderFrame,
} from "../header.ts"
import { unrefTimer } from "@ayonli/jsext/runtime"
import { asyncTask, AsyncTask, sleep } from "@ayonli/jsext/async"

export function getConfig() {
    const localUrl = process.env["LOCAL_URL"]
    const remoteUrl = process.env["REMOTE_URL"]
    const agentId = process.env["AGENT_ID"]

    if (!localUrl || !remoteUrl || !agentId) {
        throw new Error("LOCAL_URL, REMOTE_URL and AGENT_ID must be set")
    }

    return { localUrl, remoteUrl, agentId }
}


const requests = new Map<string, WritableStreamDefaultWriter>()

async function processRequestMessage(
    frame: ProxyRequestHeaderFrame | ProxyRequestBodyFrame,
    respond: (frame: ProxyResponseHeaderFrame | ProxyResponseBodyFrame) => void
) {
    if (frame.type === "header") {
        const { localUrl } = getConfig()
        const { requestId, method, url, headers, eof } = frame
        const reqInit: RequestInit = {
            method,
            headers: new Headers(headers),
        }

        if (!eof) {
            const { readable, writable } = new TransformStream()
            const writer = writable.getWriter()
            requests.set(requestId, writer)
            reqInit.body = readable
        }

        const req = new Request(stripEnd(localUrl, "/") + url, reqInit)
        const result = await Result.try(fetch(req))

        if (!result.ok) {
            return respond({
                requestId,
                type: "header",
                status: 502,
                statusText: "Bad Gateway",
                headers: [],
                eof: true,
            })
        }

        const res = result.value

        respond({
            requestId,
            type: "header",
            status: res.status,
            statusText: res.statusText,
            headers: Array.from(res.headers.entries()),
            eof: !res.body,
        })

        if (res.body) {
            const reader = res.body.getReader()
            while (true) {
                const { done, value } = await reader.read()
                respond({
                    requestId,
                    type: "body",
                    data: value === undefined ? undefined : new Uint8Array(value),
                    eof: done,
                })

                if (done) {
                    break
                }
            }
        }
    } else if (frame.type === "body") {
        const { requestId, data, eof } = frame
        const writer = requests.get(requestId)

        if (!writer) {
            return
        }

        if (eof) {
            requests.delete(requestId)
            writer.close().catch(console.error)
        } else if (data !== undefined) {
            writer.write(new Uint8Array(data)).catch(console.error)
        }
    }
}

export default class ProxyClient {
    private ws: WebSocket | null = null
    private connectedBefore = false
    private lastActive = 0
    private pingTask: AsyncTask<void> | null = null
    private healthChecker = setInterval(() => {
        if (this.ws && this.lastActive && Date.now() - this.lastActive >= 30_000) {
            // 30 seconds without any activity, send ping.
            this.ping().catch(console.error)
        }
    }, 1_000)

    constructor() {
        unrefTimer(this.healthChecker)
    }

    private async ping(): Promise<void> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
            return

        this.ws.send("ping")
        this.pingTask = asyncTask()
        const timeout = await Promise.any([
            this.pingTask.then(() => false),
            sleep(5_000).then(() => true),
        ])

        if (timeout) {
            this.ws.close()
        }
    }

    connect() {
        const { remoteUrl, agentId } = getConfig()
        let url = stripEnd(remoteUrl, "/") + "/__connect__?agentId=" + agentId
        const CONN_TOKEN = process.env.CONN_TOKEN

        if (CONN_TOKEN) {
            url += "&token=" + encodeURIComponent(CONN_TOKEN)
        }

        const ws = this.ws = new WebSocket(url)

        ws.binaryType = "arraybuffer"
        ws.addEventListener("open", () => {
            console.log("Connected to the server")
            this.connectedBefore = true
            this.lastActive = Date.now()
        })

        ws.addEventListener("error", (ev) => {
            if ((ev as ErrorEvent).message?.includes("401")) {
                console.error("Failed to connect to the server, unauthorized")
                ws.close()
            } else if (ws.readyState === WebSocket.CONNECTING ||
                (ws.readyState === WebSocket.CLOSED && !this.connectedBefore)
            ) {
                console.log("Failed to connect to the server, will retry in 5 seconds")
                setTimeout(() => {
                    console.log("Reconnecting...")
                    this.connectedBefore = false
                    this.connect()
                }, 5_000)
            }
        })

        ws.addEventListener("close", () => {
            if (this.connectedBefore) {
                console.log("Disconnected from the server")
                setTimeout(() => {
                    console.log("Reconnecting...")
                    this.connectedBefore = false
                    this.connect()
                }, 0)
            }
        })

        ws.addEventListener("message", event => {
            this.lastActive = Date.now()

            if (event.data === "pong") {
                console.log("Pong from the server")
                this.pingTask?.resolve()
                return
            } else if (typeof event.data === "string") {
                return
            }

            const frame = unpack(new Uint8Array(event.data as ArrayBuffer))

            if (typeof frame !== "object" &&
                (!frame || typeof frame.type !== "string" || typeof frame.requestId !== "string")
            ) {
                return
            }

            processRequestMessage(frame, res => {
                const buf = pack(res)
                ws.send(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
            })
        })
    }
}
