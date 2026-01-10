import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

/**
 * When products change in Medusa Admin, revalidate the storefront product cache.
 *
 * This uses the default-starter `POST /api/revalidate` route.
 *
 * Required env vars (in Medusa):
 * - STORE_URL: e.g. http://localhost:8000 (storefront base url)
 * - MEDUSA_REVALIDATION_SECRET: must match the storefront env var with same name
 */
export default async function storefrontRevalidateProducts({
  event,
}: SubscriberArgs<Record<string, unknown>>) {
  const storeUrl =
    process.env.STORE_URL || process.env.NEXT_PUBLIC_BASE_URL || ""
  const secret = process.env.MEDUSA_REVALIDATION_SECRET || ""

  if (!storeUrl || !secret) {
    return
  }

  try {
    const base = storeUrl.replace(/\/+$/, "")
    await fetch(`${base}/api/revalidate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        secret,
        tag: "products",
        // Optional context for debugging
        source: "medusa",
        event: event?.name,
      }),
    })
  } catch (e) {
    // Non-fatal: don't block Medusa writes if storefront is down.
    // eslint-disable-next-line no-console
    console.warn("[storefront-revalidate-products] Failed to revalidate", e)
  }
}

export const config: SubscriberConfig = {
  event: ["product.created", "product.updated", "product.deleted"],
}



