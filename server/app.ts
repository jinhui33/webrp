import "../init.ts"
import { asyncTask, AsyncTask, sleep } from "@ayonli/jsext/async"
import { crc32 } from "@ayonli/jsext/hash"
import { RequestContext } from "@ayonli/jsext/http"
import { Err } from "@ayonli/jsext/result"
import { addUnhandledRejectionListener } from "@ayonli/jsext/runtime"
import { stripStart } from "@ayonli/jsext/string"
import { serial } from "@ayonli/jsext/number"
import { WebSocketConnection } from "@ayonli/jsext/ws"
import { Hono } from "hono"
import { pack, unpack } from "msgpackr"
import process from "node:process"
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

const agents = new Map<number, { agentId: string; socket: WebSocketConnection }>()

function addAgent(agentId: string, socket: WebSocketConnection) {
    const list = Array.from(agents.values()).concat({ agentId, socket })
    agents.clear()
    list.forEach((agent) => {
        const modId = crc32(agent.agentId) % list.length
        agents.set(modId, agent)
    })
}

function removeAgent(agentId: string) {
    const list = Array.from(agents.values()).filter(agent => agent.agentId !== agentId)
    agents.clear()
    list.forEach((agent) => {
        const modId = crc32(agent.agentId) % list.length
        agents.set(modId, agent)
    })
}

const idPool = serial(true)

function nextId() {
    return idPool.next().value!.toString(32)
}

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

        const CONN_TOKEN = process.env.CONN_TOKEN
        const auth = ctx.req.query("token") || ""
        if (CONN_TOKEN && auth !== CONN_TOKEN) {
            return new Response(null, {
                status: 401,
                statusText: "Unauthorized",
            })
        }

        const { response, socket } = ctx.env.upgradeWebSocket()

        addAgent(agentId, socket)
        socket.addEventListener("open", () => {
            console.log("Agent connected:", agentId)
        })
        socket.addEventListener("message", event => {
            if (event.data === "ping") {
                console.log("Ping from agent:", agentId)
                socket.send("pong")
                return
            } else if (typeof event.data === "string") {
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
            removeAgent(agentId)
            console.log("Agent disconnected:", agentId)
        })

        return response
    })

    // Proxy all requests to the agent.
    .all("/*", async ctx => {
        const AUTH_TOKEN = process.env.AUTH_TOKEN
        const auth = stripStart(ctx.req.header("authorization") || "", "Bearer ")
        if (AUTH_TOKEN && auth !== AUTH_TOKEN) {
            return new Response(null, {
                status: 401,
                statusText: "Unauthorized",
            })
        }

        if (!agents.size) {
            return new Response(null, {
                status: 503,
                statusText: "Service Unavailable",
            })
        }

        const sessionId = ctx.req.header("x-forwarded-for")
            || ctx.env.remoteAddress?.hostname
            || "unknown"
        const modId = crc32(sessionId) % agents.size
        const agent = agents.get(modId)!
        const requestId = nextId()
        const req = ctx.req.raw
        const header = {
            requestId,
            type: "header",
            method: req.method,
            url: ctx.req.path,
            headers: [...req.headers.entries()],
            eof: !req.body,
        } satisfies ProxyRequestHeaderFrame
        const buf = pack(header)
        const task = asyncTask<Response>()

        requests.set(requestId, task)
        agent.socket.send(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))

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

                    agent.socket.send(pack(body))

                    if (done) {
                        break
                    }
                }
            })().catch(console.error)
        }

        const res = await Promise.any([task, sleep(30_000)])
        requests.delete(requestId)

        return res ?? new Response(null, {
            status: 504,
            statusText: "Gateway Timeout",
        })
    })

export default app
