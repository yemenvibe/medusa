import { loadEnv, defineConfig, Modules } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

const modules: any[] = [
  {
    resolve: "./src/modules/payload",
    options: {
      serverUrl: process.env.PAYLOAD_SERVER_URL || "http://localhost:8000",
      apiKey: process.env.PAYLOAD_API_KEY,
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
            endpoint: process.env.S3_ENDPOINT,
            force_path_style: process.env.S3_FORCE_PATH_STYLE === "true",
          },
        },
      ],
    },
  })
}

if (
  process.env.WOOCOMMERCE_BASE_URL &&
  process.env.WOOCOMMERCE_CONSUMER_KEY &&
  process.env.WOOCOMMERCE_CONSUMER_SECRET
) {
  modules.push({
    resolve: "./src/modules/woocommerce",
    options: {
      baseUrl: process.env.WOOCOMMERCE_BASE_URL,
      consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
      consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
      apiVersion: process.env.WOOCOMMERCE_API_VERSION,
      defaultPageSize: process.env.WOOCOMMERCE_PAGE_SIZE
        ? Number.parseInt(process.env.WOOCOMMERCE_PAGE_SIZE, 10)
        : undefined,
    },
  })
}

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
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
