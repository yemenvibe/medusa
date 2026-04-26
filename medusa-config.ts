import { loadEnv, defineConfig, Modules } from "@medusajs/framework/utils"
import * as fs from "fs"
import * as path from "path"
import * as dotenv from "dotenv"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

// Also load `backend.env` (used in this repo) without overriding already-set environment variables.
// This fixes cases where Redis/DATABASE_URL/etc. exist in backend.env but Medusa can't find them.
const backendEnvPath = path.join(process.cwd(), "backend.env")
// IMPORTANT: Don't load backend.env in production deployments, as it commonly contains
// local/dev URLs (e.g. redis://localhost:6379) that will break in containers.
if (process.env.NODE_ENV !== "production" && fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath, override: false })
}

const modules: any[] = [
  {
    resolve: "./src/modules/payload",
    options: {
      serverUrl: process.env.PAYLOAD_SERVER_URL || "https://www.alsultan.biz",
  apiKey: process.env.PAYLOAD_API_KEY || process.env.MEDUSA_PAYLOAD_API_KEY,
  // apiKey: process.env.PAYLOAD_API_KEY || process.env.MEDUSA_PAYLOAD_API_KEY,
      userCollection: process.env.PAYLOAD_USER_COLLECTION || "users",
      type_map: {
        collections: "collections",
        category: "categories",
        product: "products",
      },
    },
  },
]

const s3CredentialsProvided =
  process.env.S3_BUCKET &&
  process.env.AWS_REGION &&
  process.env.AWS_ACCESS_KEY_ID &&
  process.env.AWS_SECRET_ACCESS_KEY

const resolveDatabaseUrl = () => {
  // Prefer DATABASE_URL in containerized/prod environments to avoid stale local .env values.
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!raw) {
    return raw
  }

  try {
    const parsed = new URL(raw)
    const host = parsed.hostname.toLowerCase()
    const isLocalPostgresHost =
      host === "postgres" || host === "localhost" || host === "127.0.0.1"

    if (isLocalPostgresHost) {
      // Local Docker Postgres usually has SSL disabled; forcing it causes startup migration failures.
      parsed.searchParams.set("sslmode", "disable")
      parsed.searchParams.delete("ssl")
      process.env.PGSSLMODE = "disable"
    }

    return parsed.toString()
  } catch {
    return raw
  }
}

const databaseUrl = resolveDatabaseUrl()

// Redis URLs - prefer module-specific variables, fall back to REDIS_URL.
// Note: Redis locking is intentionally disabled (see below).
// Cache should only use Redis when explicitly enabled (REDIS_URL_CACHE).
// Event Bus and Workflow Engine can fall back to REDIS_URL for convenience.

const redisUrl = process.env.REDIS_URL || undefined
const redisCacheUrl = process.env.REDIS_URL_CACHE || undefined
const redisEventBusUrl =
  process.env.REDIS_URL_EVENT_BUS || process.env.REDIS_URL_CACHE || redisUrl
const redisWorkflowUrl =
  process.env.REDIS_URL_WORKFLOW || process.env.REDIS_URL_CACHE || redisUrl

// If Redis is temporarily unavailable (common in local dev), ioredis can throw
// MaxRetriesPerRequestError during startup and crash the server.
// This makes Redis clients keep retrying instead of throwing.
const commonRedisOptions = {
  // ioredis: disable "max retries per request" limit (prevents startup crash)
  maxRetriesPerRequest: null as any,
}

const resolveFileUrl = () => {
  const raw = process.env.S3_PUBLIC_URL
  if (!raw) {
    return undefined
  }

  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw
  }

  return `https://${raw}`
}

const resolveS3Prefix = () => {
  const prefix = process.env.S3_UPLOAD_PREFIX?.trim()
  if (!prefix) {
    return "uploads/"
  }

  return prefix.endsWith("/") ? prefix : `${prefix}/`
}

if (s3CredentialsProvided) {
  modules.push({
    key: Modules.FILE,
    resolve: "@medusajs/file",
    options: {
      providers: [
        {
          resolve: "@medusajs/file-s3",
          id: "s3",
          options: {
            file_url: resolveFileUrl(),
            bucket: process.env.S3_BUCKET,
            region: process.env.AWS_REGION,
            access_key_id: process.env.AWS_ACCESS_KEY_ID,
            secret_access_key: process.env.AWS_SECRET_ACCESS_KEY,
            prefix: resolveS3Prefix(),
            endpoint: process.env.S3_PUBLIC_URL,
            force_path_style: process.env.S3_FORCE_PATH_STYLE === "true",
          },
        },
      ],
    },
  })
}

if (redisCacheUrl) {
  modules.push({
    key: Modules.CACHING,
    resolve: "@medusajs/medusa/caching",
    options: {
      providers: [
        {
          resolve: "@medusajs/caching-redis",
          id: "caching-redis",
          is_default: true,
          options: {
            redisUrl: redisCacheUrl,
            keyPrefix: process.env.REDIS_CACHE_NAMESPACE || "medusa",
            // Optional: default TTL in seconds (default is 3600 = 1 hour)
            // ttl: 3600,
          },
        },
      ],
    },
  })
}

if (redisEventBusUrl) {
  modules.push({
    key: Modules.EVENT_BUS,
    resolve: "@medusajs/event-bus-redis",
    options: {
      redisUrl: redisEventBusUrl,
      redisOptions: commonRedisOptions,
      queueName: process.env.EVENT_BUS_QUEUE_NAME || "medusa-event-bus",
    },
  })
}

if (redisWorkflowUrl) {
  modules.push({
    key: Modules.WORKFLOW_ENGINE,
    resolve: "@medusajs/workflow-engine-redis",
    options: {
      redis: {
        redisUrl: redisWorkflowUrl,
        redisOptions: commonRedisOptions,
      },
    },
  })
}

// Redis locking removed/disabled:
// Medusa will fall back to its default locking behavior (in-memory).

// if (
//   process.env.WOOCOMMERCE_BASE_URL &&
//   process.env.WOOCOMMERCE_CONSUMER_KEY &&
//   process.env.WOOCOMMERCE_CONSUMER_SECRET
// ) {
//   modules.push({
//     resolve: "./src/modules/woocommerce",
//     options: {
//       baseUrl: process.env.WOOCOMMERCE_BASE_URL,
//       consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
//       consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
//       apiVersion: process.env.WOOCOMMERCE_API_VERSION,
//       defaultPageSize: process.env.WOOCOMMERCE_PAGE_SIZE
//         ? Number.parseInt(process.env.WOOCOMMERCE_PAGE_SIZE, 10)
//         : undefined,
//     },
//   })
// }

// Billplz Payment Provider for Medusa v2
if (
  process.env.BILLPLZ_API_KEY &&
  process.env.BILLPLZ_X_SIGNATURE_KEY &&
  process.env.BILLPLZ_COLLECTION_ID
) {
  // Add payment module with Billplz provider if not already added
  const hasPaymentModule = modules.some((m: any) => m.key === Modules.PAYMENT)
  
  if (!hasPaymentModule) {
    modules.push({
      key: Modules.PAYMENT,
      resolve: "@medusajs/payment",
      options: {
        providers: [
          {
            resolve: "./src/providers/billplz",
            id: "billplz",
            options: {
              api_key: process.env.BILLPLZ_API_KEY,
              x_signature_key: process.env.BILLPLZ_X_SIGNATURE_KEY,
              collection_id: process.env.BILLPLZ_COLLECTION_ID,
              store_url: process.env.STORE_URL || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:8000",
              backend_url: process.env.BACKEND_URL || process.env.MEDUSA_BACKEND_URL || "http://localhost:9000",
              production: process.env.BILLPLZ_SANDBOX !== "true",
            },
          },
        ],
      },
    })
  } else {
    // If payment module exists, add Billplz provider to it
    const paymentModule = modules.find((m: any) => m.key === Modules.PAYMENT)
    if (paymentModule && paymentModule.options?.providers) {
      paymentModule.options.providers.push({
        resolve: "./src/providers/billplz",
        id: "billplz",
        options: {
          api_key: process.env.BILLPLZ_API_KEY,
          x_signature_key: process.env.BILLPLZ_X_SIGNATURE_KEY,
          collection_id: process.env.BILLPLZ_COLLECTION_ID,
          store_url: process.env.STORE_URL || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:8000",
          backend_url: process.env.BACKEND_URL || process.env.MEDUSA_BACKEND_URL || "http://localhost:9000",
          production: process.env.BILLPLZ_SANDBOX !== "true",
        },
      })
    }
  }
}

// EasyParcel Fulfillment Provider (Malaysia)
// - Live base URL: https://connect.easyparcel.my/
// - Demo base URL: http://demo.connect.easyparcel.my/
// Reference: `file://Malaysia_Individual_1.4.0.0.pdf`
if (process.env.EASYPARCEL_API_KEY) {
  const fulfillmentResolve = "@medusajs/medusa/fulfillment"

  const ensureFulfillmentModule = () => {
    const existing =
      modules.find((m: any) => m.key === Modules.FULFILLMENT) ||
      modules.find((m: any) => m.resolve === fulfillmentResolve)

    if (existing) {
      existing.key = Modules.FULFILLMENT
      existing.resolve = existing.resolve || fulfillmentResolve
      existing.options = existing.options || {}
      existing.options.providers = existing.options.providers || []
      return existing
    }

    const mod = {
      key: Modules.FULFILLMENT,
      resolve: fulfillmentResolve,
      options: {
        providers: [],
      },
    }
    modules.push(mod)
    return mod
  }

  const fulfillmentModule = ensureFulfillmentModule()

  // Ensure manual provider remains available (it ships by default, but we re-declare it
  // once we override fulfillment providers).
  const hasManual = fulfillmentModule.options.providers.some((p: any) => p?.id === "manual")
  if (!hasManual) {
    fulfillmentModule.options.providers.unshift({
      resolve: "@medusajs/medusa/fulfillment-manual",
      id: "manual",
    })
  }

  const hasEasyParcel = fulfillmentModule.options.providers.some(
    (p: any) => p?.id === "easyparcel"
  )
  if (!hasEasyParcel) {
    fulfillmentModule.options.providers.push({
      resolve: "./src/modules/easyparcel-fulfillment",
      id: "easyparcel",
      options: {
        api_key: process.env.EASYPARCEL_API_KEY,
        base_url: process.env.EASYPARCEL_BASE_URL,
        demo: process.env.EASYPARCEL_DEMO === "true",
        sender_postcode: process.env.EASYPARCEL_SENDER_POSTCODE,
        sender_state: process.env.EASYPARCEL_SENDER_STATE,
        sender_country: process.env.EASYPARCEL_SENDER_COUNTRY || "MY",
        sender_phone: process.env.EASYPARCEL_SENDER_PHONE,
        sender_name: process.env.EASYPARCEL_SENDER_NAME,
        sender_email: process.env.EASYPARCEL_SENDER_EMAIL,
        sender_company: process.env.EASYPARCEL_SENDER_COMPANY,
        sender_address1: process.env.EASYPARCEL_SENDER_ADDRESS1,
        sender_address2: process.env.EASYPARCEL_SENDER_ADDRESS2,
        sender_city: process.env.EASYPARCEL_SENDER_CITY,
        timeout_ms: process.env.EASYPARCEL_TIMEOUT_MS
          ? Number(process.env.EASYPARCEL_TIMEOUT_MS)
          : undefined,
        default_weight_kg: process.env.EASYPARCEL_DEFAULT_WEIGHT_KG
          ? Number(process.env.EASYPARCEL_DEFAULT_WEIGHT_KG)
          : undefined,
      },
    })
  }
}

// Notification providers (Email)
// - In dev, we always register a provider for the "email" channel, otherwise
//   `createNotifications({ channel: "email" })` will fail.
// - If Resend env vars exist, we use Resend for "email".
// - Otherwise, we fall back to Medusa's local notification provider (logs instead of sending).
{
  const ensureNotificationModule = () => {
    const existing =
      modules.find((m: any) => m.key === Modules.NOTIFICATION) ||
      modules.find((m: any) => m.resolve === "@medusajs/medusa/notification")

    if (existing) {
      existing.key = Modules.NOTIFICATION
      existing.resolve = existing.resolve || "@medusajs/medusa/notification"
      existing.options = existing.options || {}
      existing.options.providers = existing.options.providers || []
      return existing
    }

    const mod = {
      key: Modules.NOTIFICATION,
      resolve: "@medusajs/medusa/notification",
      options: { providers: [] },
    }
    modules.push(mod)
    return mod
  }

  const notificationModule = ensureNotificationModule()
  const providers = (notificationModule.options.providers =
    notificationModule.options.providers || [])

  const resendEnabled = Boolean(
    process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL
  )

  const removeEmailChannelProvidersExcept = (keepId?: string) => {
    notificationModule.options.providers = providers.filter((p: any) => {
      const channels = p?.options?.channels
      if (!Array.isArray(channels)) {
        return true
      }
      const usesEmail = channels.includes("email")
      if (!usesEmail) {
        return true
      }
      return keepId ? p?.id === keepId : false
    })
  }


  
  if (resendEnabled) {
    // Ensure only Resend handles "email"
    removeEmailChannelProvidersExcept("resend")

    const resendProvider =
      notificationModule.options.providers.find((p: any) => p?.id === "resend") ||
      null

    if (resendProvider) {
      resendProvider.resolve = "./src/modules/resend-notification"
      resendProvider.options = resendProvider.options || {}
      resendProvider.options.channels = ["email"]
      resendProvider.options.api_key = process.env.RESEND_API_KEY
      resendProvider.options.from = process.env.RESEND_FROM_EMAIL
      resendProvider.options.bcc =
        process.env.RESEND_BCC_EMAILS?.split(",").map((e: string) => e.trim()) ||
        undefined
    } else {
      notificationModule.options.providers.push({
        resolve: "./src/modules/resend-notification",
        id: "resend",
        options: {
          channels: ["email"],
          api_key: process.env.RESEND_API_KEY,
          from: process.env.RESEND_FROM_EMAIL,
          bcc:
            process.env.RESEND_BCC_EMAILS?.split(",").map((e: string) =>
              e.trim()
            ) || undefined,
        },
      })
    }
  } else {
    // Ensure local provider handles "email" in dev when Resend isn't configured.
    removeEmailChannelProvidersExcept("local-email")

    const localProvider = notificationModule.options.providers.find(
      (p: any) => p?.id === "local-email"
    )

    if (!localProvider) {
      notificationModule.options.providers.push({
        resolve: "@medusajs/medusa/notification-local",
        id: "local-email",
        options: {
          name: "Local Notification Provider (email)",
          channels: ["email"],
        },
      })
    }
  }
}

module.exports = defineConfig({
  projectConfig: {
    // Ensure subscribers/jobs run locally.
    // In production you can set WORKER_MODE=server/worker to split processes.
    workerMode: (() => {
      const parse = (v?: string) =>
        v === "shared" || v === "server" || v === "worker" ? v : undefined

      const explicit = parse(process.env.WORKER_MODE)
      const legacy = parse(process.env.MEDUSA_WORKER_MODE)

      // Prefer WORKER_MODE when explicitly set (server/worker/shared)
      if (explicit) return explicit

      // If some environment sets MEDUSA_WORKER_MODE=server globally, keep local/dev usable:
      // run in shared mode so subscribers/jobs still execute.
      if (process.env.NODE_ENV !== "production" && legacy === "server") {
        return "shared"
      }

      return legacy || "shared"
    })(),

    // Only set redisUrl if Redis is actually configured
    ...(redisCacheUrl && { redisUrl: redisCacheUrl }),

    databaseUrl,
    //  databaseDriverOptions: {
    //   connection: {
    //     ssl: { rejectUnauthorized: false },
    //   },
    //   pool: {
    //     min: 1,
    //     max: 4,
    //     idleTimeoutMillis: 10000,
    //   },
    //   acquireConnectionTimeout: 15000,
    // },                 // Smaller pool for small instances
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
    
  },
  
  modules,
})
