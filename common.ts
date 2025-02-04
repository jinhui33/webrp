import { isPlainObject } from "@ayonli/jsext/object"
import { Err, Ok, Result } from "@ayonli/jsext/result"

export interface ProxyRequest {
    chatId: string
    method: string
    url: string
    headers: [string, string][]
    body: string | null
}

export interface ProxyResponse {
    chatId: string
    done: boolean
    value?: string
}

export function parseProxyRequest(msg: unknown): Result<ProxyRequest, string> {
    let data: unknown

    if (typeof msg === "string") {
        const result = Result.try(() => JSON.parse(msg))
        if (!result.ok) {
            return Err("Failed to parse the message")
        }

        data = result.value
    } else if (typeof msg === "object") {
        data = msg
    } else {
        data = undefined
    }

    if (!isPlainObject(data) ||
        typeof data.chatId !== "string" ||
        typeof data.method !== "string" ||
        typeof data.url !== "string"
    ) {
        return Err("Invalid message format")
    }

    return Ok(data as ProxyRequest)
}

export function parseProxyResponse(msg: unknown): Result<ProxyResponse, string> {
    let data: unknown

    if (typeof msg === "string") {
        const result = Result.try(() => JSON.parse(msg))
        if (!result.ok) {
            return Err("Failed to parse the message")
        }

        data = result.value
    } else if (typeof msg === "object") {
        data = msg
    } else {
        data = undefined
    }

    if (!isPlainObject(data) ||
        typeof data.chatId !== "string" ||
        typeof data.done !== "boolean"
    ) {
        return Err("Invalid message format")
    }

    return Ok(data as ProxyResponse)
}
