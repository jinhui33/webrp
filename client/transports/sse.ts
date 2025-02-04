import { EventSource } from "@ayonli/jsext/sse"
import { parseProxyRequest } from "../../common.ts"
import { getConfig } from "../util.ts"
import chat from "../chat.ts"

export default function sseConnect() {
    const { serverUrl, agentId } = getConfig()
    const sse = new EventSource(serverUrl + "/sse?agentId=" + agentId)

    sse.addEventListener("open", () => {
        console.log("Connected to the server")
    })

    sse.addEventListener("error", () => {
        console.log("Connection error, trying to reconnect...")
        // Will reconnect automatically
    })

    sse.addEventListener("message", event => {
        const result = parseProxyRequest(event.data)
        if (!result.ok) {
            console.error(result.error)
            return
        }

        chat(result.value, async reply => {
            const response = await fetch(serverUrl + "/sse/reply", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(reply),
            })
            if (!response.ok) {
                console.error(
                    `Failed to send the reply (chat ID: ${reply.chatId})`,
                    response.statusText)
            }
        }).catch(console.error)
    })
}
