import { defineMiddlewares, authenticate } from "@medusajs/framework/http"
import { z } from "zod"

// Export Zod schemas for use in API routes
export const AdminMagentoMigrationsPost = z.object({
  type: z.array(z.enum(["product", "category"])).min(1),
})

export const AdminWooCommerceMigrationsPost = z.object({
  type: z.enum(["product", "category"]).array().optional(),
  current_page: z.number().int().positive().optional(),
  page_size: z.number().int().positive().optional(),
  sync_all_pages: z.boolean().optional(),
})

// Default Medusa 2.12.4 middleware configuration
export default defineMiddlewares({
  routes: [
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
