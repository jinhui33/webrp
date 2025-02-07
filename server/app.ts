import { asyncTask, AsyncTask, sleep } from "@ayonli/jsext/async"
import { crc32 } from "@ayonli/jsext/hash"
import { RequestContext } from "@ayonli/jsext/http"
import { serial } from "@ayonli/jsext/number"
import runtime, { addUnhandledRejectionListener, env } from "@ayonli/jsext/runtime"
import { stripStart } from "@ayonli/jsext/string"
import { toWebSocketStream, WebSocketConnection, WebSocketServer, WebSocketStream } from "@ayonli/jsext/ws"
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
    console.error("Unhandled rejection:", ev.reason)
})

let authRule: RegExp | null = null

function createAuthRule(AUTH_RULE: string) {
    if (AUTH_RULE.startsWith("/")) {
        const lastIndex = AUTH_RULE.lastIndexOf("/")
        if (lastIndex > 1) {
            const pattern = AUTH_RULE.slice(1, lastIndex)
            const flags = AUTH_RULE.slice(lastIndex + 1)
            if (flags && flags !== "i") {
                console.warn("Only 'i' flag is supported in AUTH_RULE.")
            }

            return new RegExp(pattern, flags || undefined)
        }

        return new RegExp(AUTH_RULE)
    } else {
        return new RegExp(AUTH_RULE)
    }
}

function passAuth(path: string) {
    return authRule ? !authRule.test(path) : false
}

const wsServer = new WebSocketServer()

const clients: Record<string, WebSocketConnection | null> = {}
const idPool = serial(true)

function nextId() {
    return idPool.next().value!.toString(32)
}

const requests = new Map<string, AsyncTask<Response | WebSocketStream>>()
const responses = new Map<string, WritableStreamDefaultWriter<Uint8Array>>()

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
            writer.close().catch(() => { })
        } else if (data !== undefined) {
            writer.write(new Uint8Array(data)).catch(console.error)
        }
    }
}

const app = new Hono<{ Bindings: any }>()
    // An endpoint is for the client to connect to the server using WebSocket.
    .get("/__connect__", ctx => {
        if (runtime().identity === "workerd") {
            env(ctx.env) // initialize the environment for the worker
        }

        const { AUTH_RULE } = env()
        if (AUTH_RULE) {
            authRule ??= createAuthRule(AUTH_RULE)
        }

        const { searchParams } = new URL(ctx.req.url)
        const clientId = searchParams.get("clientId")
        if (!clientId) {
            return ctx.text("Client ID is missing.", { status: 400 })
        }

        const auth = ctx.req.query("token") || ""
        const { CONN_TOKEN } = env()
        if (CONN_TOKEN && auth !== CONN_TOKEN) {
            return new Response("Unauthorized", {
                status: 401,
                statusText: "Unauthorized",
            })
        }

        const { response, socket } = wsServer.upgrade(ctx.req.raw)

        socket.addEventListener("open", () => {
            clients[clientId] = socket
            console.log("Client connected:", clientId)
        })
        socket.addEventListener("message", event => {
            if (event.data === "ping") {
                console.log("Ping from client:", clientId)
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
            clients[clientId] = null
            console.log("Client disconnected:", clientId)
        })

        return response
    })

    // An endpoint is for the client to check the server's availability.
    .get("/__ping__", ctx => {
        const { searchParams } = new URL(ctx.req.url)
        const clientId = searchParams.get("clientId")
        if (!clientId) {
            return ctx.json({
                ok: false,
                code: 400,
                message: "Client ID is missing.",
            })
        }

        const socket = clients[clientId]
        if (!socket) {
            return ctx.json({
                ok: false,
                code: 404,
                message: "Client not found.",
            })
        }

        return ctx.json({ ok: true, code: 200, message: "pong" })
    })

    // An endpoint is for WebSocket proxy.
    .get("/__ws__", ctx => {
        const { searchParams } = new URL(ctx.req.url)
        const clientId = searchParams.get("clientId")
        if (!clientId) {
            return ctx.text("Client ID is missing.", { status: 400 })
        }

        const requestId = searchParams.get("requestId")
        if (!requestId) {
            return ctx.text("Request ID is missing.", { status: 400 })
        }

        const auth = ctx.req.query("token") || ""
        const { CONN_TOKEN } = env()
        if (CONN_TOKEN && auth !== CONN_TOKEN) {
            return ctx.text("Unauthorized", {
                status: 401,
                statusText: "Unauthorized",
            })
        }

        const request = requests.get(requestId)
        if (!request) {
            return ctx.text("Request not found.", { status: 404 })
        }

        const { response, socket } = wsServer.upgrade(ctx.req.raw)
        const server = toWebSocketStream(socket)
        request.resolve(server)

        return response
    })

    // Proxy all requests to the client.
    .all("/*", async ctx => {
        const respondBody = !["HEAD", "OPTIONS"].includes(ctx.req.method)

        const auth = stripStart(ctx.req.header("authorization") || "", "Bearer ")
        const { AUTH_TOKEN } = env()
        if (AUTH_TOKEN && auth !== AUTH_TOKEN && !passAuth(ctx.req.path)) {
            return new Response(respondBody ? "Unauthorized" : null, {
                status: 401,
                statusText: "Unauthorized",
            })
        }

        const _clients = Object.values(clients).filter(Boolean) as WebSocketConnection[]

        if (!_clients.length) {
            return new Response(respondBody ? "No proxy client" : null, {
                status: 503,
                statusText: "Service Unavailable",
            })
        }

        let ip = ctx.req.header("x-forwarded-for")
        if (!ip) {
            if ("remoteAddress" in ctx.env) {
                ip = (ctx.env as RequestContext)?.remoteAddress?.hostname
            } else if ("remoteAddr" in ctx.env) {
                ip = (ctx.env as Deno.ServeHandlerInfo<Deno.NetAddr>)?.remoteAddr?.hostname
            }

            ip ||= ""
        }
        const modId = crc32(ip) % _clients.length
        const socket = _clients[modId]
        const requestId = nextId()
        const req = ctx.req.raw
        const { protocol, host, pathname, search } = new URL(req.url)
        const headers = new Headers(req.headers.entries())

        if (ip && !headers.has("x-forwarded-for")) {
            headers.set("x-forwarded-for", ip)
        }

        if (!headers.has("x-forwarded-proto")) {
            headers.set("x-forwarded-proto", protocol.slice(0, -1))
        }

        const { FORWARD_HOST } = env()
        if (!(FORWARD_HOST?.toLowerCase().match(/^(true|on|1)$/)) &&
            !headers.has("x-forwarded-host")
        ) {
            headers.set("x-forwarded-host", host)
        } else if (!headers.has("host")) {
            headers.set("host", host)
        }

        const header = {
            requestId,
            type: "header",
            method: req.method,
            path: pathname + search,
            headers: [...headers.entries()],
            eof: !req.body,
        } satisfies ProxyRequestHeaderFrame
        const buf = pack(header)
        const task = asyncTask<Response | WebSocketStream>()

        requests.set(requestId, task)
        socket.send(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))

        if (req.body) {
            // Transfer the request body asynchronously, so that the response
            // can be processed in parallel.
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

                    socket.send(pack(body))

                    if (done) {
                        break
                    }
                }
            })().catch(console.error)
        }

        const res = await Promise.any([task, sleep(30_000)])
        requests.delete(requestId)

        if (res instanceof Response) {
            return res
        }

        if (res instanceof WebSocketStream) {
            const server = res
            const { response, socket } = wsServer.upgrade(ctx.req.raw)
            const client = toWebSocketStream(socket);

            (async () => {
                const {
                    readable: serverReadable,
                    writable: serverWritable,
                } = await server.opened
                const {
                    readable: clientReadable,
                    writable: clientWritable,
                } = await client.opened

                serverReadable.pipeTo(clientWritable)
                clientReadable.pipeTo(serverWritable)

                server.closed.then(() => {
                    // deno-lint-ignore no-empty
                    try { client.close() } catch { }
                })
                client.closed.then(() => {
                    // deno-lint-ignore no-empty
                    try { server.close() } catch { }
                })
            })()

            return response
        }

        return new Response(respondBody ? "Proxy client timeout" : null, {
            status: 504,
            statusText: "Gateway Timeout",
        })
    })

export default app
