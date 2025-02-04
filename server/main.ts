import { serve } from "@ayonli/jsext/http"
import app from "./app.ts"

export default serve({
    type: "module",
    fetch: (req, ctx) => {
        console.log(ctx)
        return app.fetch(req, ctx)
    },
})
