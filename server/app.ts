import "../init.ts"
import { asyncTask, AsyncTask, select } from "@ayonli/jsext/async"
import { crc32 } from "@ayonli/jsext/hash"
import { RequestContext } from "@ayonli/jsext/http"
import { Err, Result } from "@ayonli/jsext/result"
import { addUnhandledRejectionListener } from "@ayonli/jsext/runtime"
import { random } from "@ayonli/jsext/string"
import { WebSocketConnection } from "@ayonli/jsext/ws"
import { Hono } from "hono"
import { pack, unpack } from "msgpackr"
import {
    ProxyRequestBodyFrame,
    ProxyRequestHeaderFrame,
    ProxyResponseBodyFrame,
    ProxyResponseHeaderFrame,
} from "../header.ts"

addUnhandledRejectionListener(ev => {
    ev.preventDefault()
    console.error("Unhandled rejection", ev.reason)
})

const agents: Record<string, WebSocketConnection> = {}

const requests = new Map<string, AsyncTask<Response>>()
const responses = new Map<string, WritableStreamDefaultWriter>()

function processResponseMessage(frame: ProxyResponseHeaderFrame | ProxyResponseBodyFrame) {
    if (frame.type === "header") {
        const { requestId, status, statusText, headers, eof } = frame
        const request = requests.get(requestId)

        if (!request) {
            return
        }

        if (eof) {
            const res = new Response(null, {
                status,
                statusText,
                headers: new Headers(headers),
            })
            request.resolve(res)
        } else {
            const { readable, writable } = new TransformStream()
            const res = new Response(readable, {
                status,
                statusText,
                headers: new Headers(headers),
            })
            const writer = writable.getWriter()
            responses.set(requestId, writer)
            request.resolve(res)
        }
    } else if (frame.type === "body") {
        const { requestId, data, eof } = frame
        const writer = responses.get(requestId)

        if (!writer) {
            return
        }

        if (eof) {
            responses.delete(requestId)
            writer.close().catch(console.error)
        } else if (data !== undefined) {
            writer.write(new Uint8Array(data)).catch(console.error)
        }
    }
}

const app = new Hono<{ Bindings: RequestContext }>()
    // An endpoint is for the agent to connect to the server using WebSocket.
    .get("/__connect__", ctx => {
        const { searchParams } = new URL(ctx.req.url)
        const agentId = searchParams.get("agentId")
        if (!agentId) {
            return ctx.json(Err("Agent ID is missing."), { status: 400 })
        }

        const { response, socket } = ctx.env.upgradeWebSocket()

        agents[agentId] = socket
        socket.addEventListener("open", () => {
            console.log("WS Agent connected:", agentId)
        })
        socket.addEventListener("message", event => {
            if (typeof event.data === "string") {
                return
            }

            const frame = unpack(event.data)
            if (typeof frame !== "object" &&
                (!frame || typeof frame.type !== "string" || typeof frame.requestId !== "string")
            ) {
                return
            }

            processResponseMessage(frame)
        })
        socket.addEventListener("close", () => {
            delete agents[agentId]
            console.log("WS Agent disconnected:", agentId)
        })

        return response
    })

    // Proxy all requests to the agent.
    .all("/*", async ctx => {
        const agentIds = Object.keys(agents)
        if (!agentIds.length) {
            return new Response(null, {
                status: 503,
                statusText: "Service Unavailable",
            })
        }

        const sessionId = ctx.req.header("x-forwarded-for")
            || ctx.env.remoteAddress?.hostname
            || "unknown"
        const mod = crc32(sessionId) % agentIds.length
        const agentId = agentIds[mod]
        const agent = agents[agentId]
        const requestId = random(8)
        const req = ctx.req.raw
        const { pathname } = new URL(req.url)
        const header = {
            requestId,
            type: "header",
            method: req.method,
            url: pathname,
            headers: [...req.headers.entries()],
            eof: !req.body,
        } satisfies ProxyRequestHeaderFrame
        const buf = pack(header)
        const task = asyncTask<Response>()

        requests.set(requestId, task)
        agent.send(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))

        if (req.body) {
            // Proxy the request body asynchronously, so that the response can
            // be processed in parallel.
            (async () => {
                const reader = req.body!.getReader()
                while (true) {
                    const { done, value } = await reader.read()
                    const body: ProxyRequestBodyFrame = {
                        requestId,
                        type: "body",
                        data: value?.buffer,
                        eof: done,
                    }

                    agent.send(pack(body))

                    if (done) {
                        break
                    }
                }
            })().catch(console.error)
        }

        const result = await Result.try(select([
            task
        ], AbortSignal.timeout(30_000)))
        requests.delete(requestId)

        if (result.ok) {
            return result.value
        } else {
            return new Response(null, {
                status: 504,
                statusText: "Gateway Timeout",
            })
        }
    })

export default app
