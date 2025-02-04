import "../init.ts"
import sseConnect from "./transports/sse.ts"
import wsConnect from "./transports/ws.ts"
import process from "node:process"

if (process.env["TRANSPORT"] === "ws" || !process.env["TRANSPORT"]) {
    wsConnect()
} else if (process.env["TRANSPORT"] === "sse") {
    sseConnect()
} else {
    throw new Error("TRANSPORT must be 'ws' or 'sse'")
}
