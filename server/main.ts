import "../init.ts"
import { serve } from "@ayonli/jsext/http"
import app from "./app.ts"

export default serve({
    type: "module",
    fetch: app.fetch,
})
