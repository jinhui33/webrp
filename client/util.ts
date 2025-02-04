import process from "node:process"

export function getConfig() {
    const ollamaUrl = process.env["OLLAMA_URL"]
    const serverUrl = process.env["SERVER_URL"]
    const agentId = process.env["AGENT_ID"]

    if (!ollamaUrl || !serverUrl || !agentId) {
        throw new Error("OLLAMA_URL, SERVER_URL and AGENT_ID must be set")
    }

    return { ollamaUrl, serverUrl, agentId }
}
