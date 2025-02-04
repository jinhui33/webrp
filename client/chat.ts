import { text } from "@ayonli/jsext/bytes"
import { Result } from "@ayonli/jsext/result"
import { stripEnd } from "@ayonli/jsext/string"
import { ProxyRequest, ProxyResponse } from "../common.ts"
import { getConfig } from "./util.ts"

export default async function chat(request: ProxyRequest, reply: (response: ProxyResponse) => void) {
    const { chatId, method, url, headers, body } = request
    const { ollamaUrl } = getConfig()
    const result = await Result.try(fetch(stripEnd(ollamaUrl, "/") + url, {
        method,
        headers: new Headers(headers),
        body,
    }))

    if (!result.ok) {
        reply({
            chatId,
            done: true,
            value: result.error instanceof Error ? result.error.message : String(result.error),
        } satisfies ProxyResponse)
        return
    }

    const stream = result.value.body
    if (!stream) {
        reply({
            chatId,
            done: true,
            value: undefined,
        } satisfies ProxyResponse)
    } else {
        const reader = stream.getReader()
        while (true) {
            const { done, value } = await reader.read()
            if (done) {
                reply({
                    chatId,
                    done: true,
                    value: undefined,
                } satisfies ProxyResponse)
                break
            }

            reply({
                chatId,
                done: false,
                value: text(value),
            } satisfies ProxyResponse)
        }
    }
}
