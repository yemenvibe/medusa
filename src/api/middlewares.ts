import { defineMiddlewares, authenticate } from "@medusajs/framework/http"
import type { 
  MedusaNextFunction, 
  MedusaRequest, 
  MedusaResponse, 
} from "@medusajs/framework/http"
import { ConfigModule } from "@medusajs/framework"
import { parseCorsOrigins } from "@medusajs/framework/utils"
import cors from "cors"
import { z } from "zod"

export const AdminMagentoMigrationsPost = z.object({
  type: z.array(z.enum(["product", "category"])).min(1),
})

export const AdminWooCommerceMigrationsPost = z.object({
  type: z.enum(["product", "category"]).array().optional(),
  current_page: z.number().int().positive().optional(),
  page_size: z.number().int().positive().optional(),
  sync_all_pages: z.boolean().optional(),
})

export default defineMiddlewares({
  routes: [
    {
      matcher: "/static*",
      middlewares: [
        (
          req: MedusaRequest, 
          res: MedusaResponse, 
          next: MedusaNextFunction
        ) => {
          console.log("CORS middleware for static files")
          const configModule: ConfigModule =
            req.scope.resolve("configModule")

          return cors({
            origin: parseCorsOrigins(
              configModule.projectConfig.http.storeCors
            ),
            credentials: true,
          })(req, res, next)
        },
      ],
    },
    {
      // Protect all admin payload sync endpoints
      matcher: "/admin/payload*",
      middlewares: [
        // Allow authentication via session (admin dashboard), bearer (JS SDK token), or api-key (for CI jobs)
        authenticate("user", ["session", "bearer", "api-key"]),
      ],
    },
  ],
})