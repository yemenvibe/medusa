import { defineMiddlewares, authenticate, errorHandler } from "@medusajs/framework/http"
import type { 
  MedusaNextFunction, 
  MedusaRequest, 
  MedusaResponse, 
} from "@medusajs/framework/http"
import { ConfigModule } from "@medusajs/framework"
import { parseCorsOrigins } from "@medusajs/framework/utils"
import cors from "cors"
import { z } from "zod"

const originalErrorHandler = errorHandler()

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
      // Fix invalid field selection syntax for admin price list requests
      // The admin UI sometimes sends nested field paths like "prices.price_set.variant.id"
      // which aren't valid in Medusa v2. We sanitize to use valid relation expansion.
      matcher: "/admin/price-lists*",
      middlewares: [
        (
          req: MedusaRequest,
          res: MedusaResponse,
          next: MedusaNextFunction
        ) => {
          const fieldsParam = req.query?.fields as string | undefined
          if (fieldsParam) {
            // Remove invalid nested field paths that cause 400 errors
            // Keep valid fields like *prices, but remove nested paths like prices.price_set.variant.id
            const fields = fieldsParam.split(",")
            const validFields = fields.filter((field) => {
              const trimmed = field.trim()
              // Keep fields that:
              // - Start with * (relation expansion)
              // - Start with + or - (add/remove modifiers)
              // - Are simple field names without dots (except for the * prefix)
              // Remove fields with nested dot notation like "prices.price_set.variant.id"
              if (trimmed.startsWith("*") || trimmed.startsWith("+") || trimmed.startsWith("-")) {
                // Check if it's a simple relation like *prices or has nested paths
                const withoutPrefix = trimmed.replace(/^[*+-]/, "")
                // If it has dots after removing prefix, it's a nested path - remove it
                if (withoutPrefix.includes(".")) {
                  return false
                }
                return true
              }
              // Simple field names without dots are valid
              if (!trimmed.includes(".")) {
                return true
              }
              // Remove nested paths (like "prices.price_set.variant.id")
              return false
            })

            if (validFields.length !== fields.length || validFields.length === 0) {
              // If we filtered out all fields or some fields, update the query
              // If all were invalid, default to just *prices
              const sanitizedFields = validFields.length > 0 ? validFields.join(",") : "*prices"
              
              // Update both the query object and the URL if possible
              req.query = {
                ...req.query,
                fields: sanitizedFields,
              }
              
              // Also try to update the raw URL query string if available
              if (req.url) {
                const url = new URL(req.url, `http://${req.headers.host || "localhost"}`)
                url.searchParams.set("fields", sanitizedFields)
                // Note: We can't directly modify req.url in Medusa, but updating req.query should be enough
              }
              
              console.log(
                `[Price List Middleware] Sanitized fields: "${fieldsParam}" -> "${sanitizedFields}"`
              )
            }
          }
          next()
        },
      ],
    },
    {
      // Fix invalid field requests for admin orders after Medusa 2.12.4 upgrade
      // The admin UI requests "custom_display_id" which doesn't exist in the database schema.
      // We remove it from the fields parameter to prevent 400 errors.
      matcher: "/admin/orders*",
      middlewares: [
        (
          req: MedusaRequest,
          res: MedusaResponse,
          next: MedusaNextFunction
        ) => {
          const fieldsParam = req.query?.fields as string | undefined
          if (fieldsParam) {
            // Check if custom_display_id is present (handle both URL-encoded and plain)
            try {
              const decodedFields = decodeURIComponent(fieldsParam)
              if (decodedFields.includes("custom_display_id") || fieldsParam.includes("custom_display_id")) {
                // Remove custom_display_id from the fields list
                const fields = decodedFields.split(",")
                const validFields = fields.filter((field) => {
                  const trimmed = field.trim()
                  return trimmed !== "custom_display_id"
                })

                if (validFields.length !== fields.length) {
                  const sanitizedFields = validFields.join(",")
                  req.query = {
                    ...req.query,
                    fields: sanitizedFields,
                  }
                  console.log(
                    `[Orders Middleware] Removed invalid field custom_display_id. Original: "${fieldsParam}" -> Sanitized: "${sanitizedFields}"`
                  )
                }
              }
            } catch (e) {
              // If URL decoding fails, try without decoding
              if (fieldsParam.includes("custom_display_id")) {
                const fields = fieldsParam.split(",")
                const validFields = fields.filter((field) => {
                  const trimmed = field.trim()
                  return trimmed !== "custom_display_id"
                })

                if (validFields.length !== fields.length) {
                  const sanitizedFields = validFields.join(",")
                  req.query = {
                    ...req.query,
                    fields: sanitizedFields,
                  }
                  console.log(
                    `[Orders Middleware] Removed invalid field custom_display_id (no decode). Original: "${fieldsParam}" -> Sanitized: "${sanitizedFields}"`
                  )
                }
              }
            }
          }
          next()
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
  errorHandler: async (
    err: any,
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): Promise<void> => {
    const isJsonParseFailed =
      err?.type === "entity.parse.failed" ||
      (err instanceof SyntaxError && (err as any)?.statusCode === 400)

    if (isJsonParseFailed && req.path === "/store/easyparcel/rate") {
      res.status(400).json({
        error: "Invalid JSON request body",
        hint:
          "Send a valid JSON object. If you are using PowerShell, don't escape quotes with backslashes. Example: curl.exe -X POST http://localhost:9000/store/easyparcel/rate -H \"Content-Type: application/json\" --data '{\"receiver_postcode\":\"43300\",\"receiver_state\":\"sgr\"}'",
      })
      return
    }

    // Log 400 errors for admin price list requests to help debug
    if (
      req.path?.startsWith("/admin/price-lists") &&
      (err?.status === 400 || err?.statusCode === 400)
    ) {
      console.log(
        `[Price List Error] 400 error on ${req.path} with fields: ${req.query?.fields}`
      )
    }

    // Handle 400 errors for admin orders requests with invalid field (custom_display_id)
    if (req.path?.startsWith("/admin/orders")) {
      const errorMessage = String(err?.message || err || "")
      const errorStack = String(err?.stack || "")
      const fullError = (errorMessage + " " + errorStack).toLowerCase()
      
      // Check for custom_display_id related errors
      const isCustomDisplayIdError = 
        fullError.includes("custom_display_id") ||
        (fullError.includes("column") && fullError.includes("does not exist") && req.query?.fields?.toString().includes("custom_display_id"))

      if (isCustomDisplayIdError) {
        const fieldsParam = (req.query?.fields as string) || ""
        const decodedFields = decodeURIComponent(fieldsParam)
        const fields = decodedFields.split(",")
        const validFields = fields.filter((field) => {
          const trimmed = field.trim()
          return trimmed !== "custom_display_id"
        })

        console.log(
          `[Orders Error Handler] Detected custom_display_id error. Original fields: "${fieldsParam}", Sanitized: "${validFields.join(",")}", Error: ${errorMessage}`
        )

        // Return a helpful error message
        res.status(400).json({
          error: "Invalid field selection",
          message: "The field 'custom_display_id' does not exist in the database schema. Please remove it from your request.",
          sanitized_fields: validFields.join(","),
          original_fields: fieldsParam,
        })
        return
      }

      // Log other 400 errors for debugging
      if (err?.status === 400 || err?.statusCode === 400) {
        console.log(
          `[Orders Error] 400 error on ${req.path} with fields: ${req.query?.fields}, error: ${errorMessage}`
        )
      }
    }

    return await originalErrorHandler(err, req, res, next)
  },
})