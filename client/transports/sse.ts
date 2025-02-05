import { Result } from "@ayonli/jsext/result"
import { EventConsumer, EventEndpoint } from "@ayonli/jsext/sse"
import { parseProxyRequest } from "../../common.ts"
import { getConfig } from "../util.ts"
import chat from "../chat.ts"

export default async function sseConnect() {
    const { serverUrl, agentId } = getConfig()
    // EventEndpoint takes a Request object, so we create one for it for simulation.
    const req = new Request(serverUrl + "/sse?agentId=" + agentId)
    const outgoing = new EventEndpoint(req)

    // We need to write the first chunk of data so the server can parse
    // the header and start receiving body frames.
    outgoing.dispatchEvent(new MessageEvent("connect", { data: "hello" }))

    // @ts-ignore suppress TS error for 'duplex' option
    const res = await Result.try(fetch(req.url, {
        method: "POST",
        // Pass the response body of the EventEndpoint instance as the request body,
        // so when sending events, the data will be piped to the request.
        body: outgoing.response!.body,
        headers: { "Content-Type": "text/event-stream" },
        duplex: "half",
    }))

    if (!res.ok || !res.value.ok) {
        console.log("Failed to connect to the server, will retry in 5 seconds")
        setTimeout(() => {
            console.log("Reconnecting...")
            sseConnect()
        }, 5000)
        return
    }

    const incoming = new EventConsumer(res.value)
    console.log("Connected to the server")

    incoming.addEventListener("close", () => {
        console.log("Disconnected from the server")
        setTimeout(() => {
            console.log("Reconnecting...")
            sseConnect()
        }, incoming.retry)
    })

    incoming.addEventListener("message", event => {
        const result = parseProxyRequest(event.data)
        if (!result.ok) {
            console.error(result.error)
            return
        }

        chat(result.value, reply => {
            outgoing.dispatchEvent(new MessageEvent("message", {
                data: JSON.stringify(reply),
            }))
        }).catch(console.error)
    })
}
