import "../init.ts"
import { serve } from "@ayonli/jsext/http"
import runtime from "@ayonli/jsext/runtime"
import app from "./app.ts"

const isNode = runtime().identity === "node"
const isNodeESEntry = process.execArgv.some(arg => arg.endsWith("@ayonli/jsext/http"))

export default serve({
    type: !isNode || isNodeESEntry ? "module" : "classic",
    fetch: app.fetch,
})
