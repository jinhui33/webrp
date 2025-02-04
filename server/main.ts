import { serve } from "@ayonli/jsext/http"
import app from "./app.ts"

export default serve({
    type: "module",
    fetch: (req, ctx) => {
        console.log(ctx, typeof Deno, Deno.version.deno)
        return app.fetch(req, ctx)
    },
})
