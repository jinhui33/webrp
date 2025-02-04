import "../init.ts"
import { crc32 } from "@ayonli/jsext/hash"
import { RequestContext } from "@ayonli/jsext/http"
import { Ok, Err } from "@ayonli/jsext/result"
import { addUnhandledRejectionListener } from "@ayonli/jsext/runtime"
import { random, stripStart } from "@ayonli/jsext/string"
import { EventEndpoint } from "@ayonli/jsext/sse"
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
    transport: WebSocketConnection | EventEndpoint
}> = {}

const chats = new Map<string, WritableStreamDefaultWriter>()

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
        socket.addEventListener("message", async event => {
            const result = parseProxyResponse(event.data)
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
        })
        socket.addEventListener("close", () => {
            delete agents[agentId]
            console.log("WS Agent disconnected:", agentId)
        })
        console.log("WS Agent connected:", agentId)

        return response
    })

    // An endpoint is for the agent to connect to the server using EventSource.
    .get("/sse", ctx => {
        const { searchParams } = new URL(ctx.req.url)
        const agentId = searchParams.get("agentId")
        if (!agentId) {
            return ctx.json(Err("Agent ID is missing."), { status: 400 })
        }

        const { response, events } = ctx.env.createEventEndpoint()

        agents[agentId] = { type: "sse", transport: events }
        events.addEventListener("close", () => {
            delete agents[agentId]
            console.log("SSE Agent disconnected:", agentId)
        })
        console.log("SSE Agent connected:", agentId)

        return response
    })
    .post("/sse/reply", async ctx => {
        const body = await ctx.req.json()
        const result = parseProxyResponse(body)
        if (!result.ok) {
            console.error(result.error, body)
            return ctx.json(Err("Invalid message format."), { status: 400 })
        }

        const { chatId, done, value } = result.value
        const chat = chats.get(chatId)
        if (!chat) {
            return ctx.json(Err(`Chat (${chatId}) not found.`), { status: 404 })
        }

        if (done) {
            if (value !== undefined) {
                await chat.write(bytes(value))
            }

            await chat.close()
            chats.delete(chatId)
        } else if (value !== undefined) {
            await chat.write(bytes(value))
        }

        return ctx.json(Ok("OK"))
    })

    // Proxy all requests to the agent.
    .all("/*", async ctx => {
        const auth = stripStart(ctx.req.header("authorization") || "", "Bearer ")
        const setToken = process.env.AUTH_TOKEN
        if (setToken && auth !== setToken) {
            return ctx.text("Unauthorized", { status: 401 })
        }

        const sessionId = auth
            || ctx.req.header("x-forwarded-for")
            || ctx.env.remoteAddress?.hostname
            || "unknown"
        const mod = crc32(sessionId) % Object.keys(agents).length
        const agentId = Object.keys(agents)[mod]
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
            (agent.transport as EventEndpoint).send(request)
        }

        return new Response(readable)
    })

export default app
