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

let connectedBefore = false

export function connect() {
    const { remoteUrl, agentId } = getConfig()
    const ws = new WebSocket(stripEnd(remoteUrl, "/") + "/__connect__?agentId=" + agentId)

    ws.binaryType = "arraybuffer"
    ws.addEventListener("open", () => {
        connectedBefore = true
        console.log("Connected to the server")
    })

    ws.addEventListener("error", () => {
        if (ws.readyState === WebSocket.CONNECTING ||
            (ws.readyState === WebSocket.CLOSED && !connectedBefore)
        ) {
            console.log("Failed to connect to the server, will retry in 5 seconds")
            setTimeout(() => {
                connectedBefore = false
                console.log("Reconnecting...")
                connect()
            }, 5000)
        }
    })

    ws.addEventListener("close", () => {
        if (connectedBefore) {
            console.log("Disconnected from the server")
            setTimeout(() => {
                connectedBefore = false
                console.log("Reconnecting...")
                connect()
            }, 0)
        }
    })

    ws.addEventListener("message", event => {
        if (typeof event.data === "string") {
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
