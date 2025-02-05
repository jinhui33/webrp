import "../init.ts"
import { crc32 } from "@ayonli/jsext/hash"
import { RequestContext } from "@ayonli/jsext/http"
import { Err } from "@ayonli/jsext/result"
import { addUnhandledRejectionListener } from "@ayonli/jsext/runtime"
import { random, stripStart } from "@ayonli/jsext/string"
import { EventConsumer, EventEndpoint } from "@ayonli/jsext/sse"
import { WebSocketConnection } from "@ayonli/jsext/ws"
import { Hono } from "hono"
import { parseProxyResponse, ProxyRequest } from "../common.ts"
import process from "node:process"
import bytes from "@ayonli/jsext/bytes"

addUnhandledRejectionListener(ev => {
    ev.preventDefault()
    console.error("Unhandled rejection", ev.reason)
})

const agents: Record<string, {
    type: "ws" | "sse"
    transport: WebSocketConnection | EventEndpoint<Request>
}> = {}

const chats = new Map<string, WritableStreamDefaultWriter>()

async function processResponseMessage(msg: string) {
    const result = parseProxyResponse(msg)
    if (!result.ok) {
        console.error(result.error)
        return
    }

    const { chatId, done, value } = result.value
    const chat = chats.get(chatId)
    if (!chat)
        return

    if (done) {
        if (value !== undefined) {
            await chat.write(bytes(value))
        }

        await chat.close()
        chats.delete(chatId)
    } else if (value !== undefined) {
        await chat.write(bytes(value))
    }
}

const app = new Hono<{ Bindings: RequestContext }>()
    .get("/", ctx => ctx.text("Hello, World!"))

    // An endpoint is for the agent to connect to the server using WebSocket.
    .get("/ws", ctx => {
        const { searchParams } = new URL(ctx.req.url)
        const agentId = searchParams.get("agentId")
        if (!agentId) {
            return ctx.json(Err("Agent ID is missing."), { status: 400 })
        }

        const { response, socket } = ctx.env.upgradeWebSocket()

        agents[agentId] = { type: "ws", transport: socket }
        socket.addEventListener("open", () => {
            console.log("WS Agent connected:", agentId)
        })
        socket.addEventListener("message", async event => {
            await processResponseMessage(event.data as string)
        })
        socket.addEventListener("close", () => {
            delete agents[agentId]
            console.log("WS Agent disconnected:", agentId)
        })

        return response
    })

    // An endpoint is for the agent to connect to the server using SSE.
    .post("/sse", ctx => {
        const { searchParams } = new URL(ctx.req.url)
        const agentId = searchParams.get("agentId")
        if (!agentId) {
            return ctx.json(Err("Agent ID is missing."), { status: 400 })
        }

        const { response, events: outgoing } = ctx.env.createEventEndpoint()

        agents[agentId] = { type: "sse", transport: outgoing }

        // Use the request body to create an incoming port and receive messages
        // from it.
        const incoming = new EventConsumer(new Response(ctx.req.raw.body, {
            headers: { "Content-Type": "text/event-stream" },
        }))
        incoming.addEventListener("message", async event => {
            await processResponseMessage(event.data as string)
        })

        // The client will send a "connect" event to perform the handshake.
        incoming.addEventListener("connect", () => {
            console.log("SSE Agent connected:", agentId)
        })
        incoming.addEventListener("close", () => {
            delete agents[agentId]
            console.log("SSE Agent disconnected:", agentId)
        })

        return response
    })

    // Proxy all requests to the agent.
    .all("/*", async ctx => {
        const auth = stripStart(ctx.req.header("authorization") || "", "Bearer ")
        const setToken = process.env.AUTH_TOKEN
        if (setToken && auth !== setToken) {
            return ctx.text("Unauthorized", { status: 401 })
        }

        const agentIds = Object.keys(agents)
        if (!agentIds.length) {
            return ctx.text("No agents available", { status: 503 })
        }

        const sessionId = ctx.req.header("x-forwarded-for")
            || ctx.env.remoteAddress?.hostname
            || "unknown"
        const mod = crc32(sessionId) % agentIds.length
        const agentId = agentIds[mod]
        const agent = agents[agentId]
        const chatId = random(8)
        const req = ctx.req.raw
        const { pathname } = new URL(req.url)
        const request = JSON.stringify({
            chatId,
            method: req.method,
            url: pathname,
            headers: [...req.headers.entries()],
            body: req.body ? await req.text() : null,
        } satisfies ProxyRequest)

        const { readable, writable } = new TransformStream()

        const writer = writable.getWriter()
        chats.set(chatId, writer)

        if (agent.type === "ws") {
            (agent.transport as WebSocketConnection).send(request)
        } else if (agent.type === "sse") {
            (agent.transport as EventEndpoint<Request>).send(request)
        }

        return new Response(readable)
    })

export default app
