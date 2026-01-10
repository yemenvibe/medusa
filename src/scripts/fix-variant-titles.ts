import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

type VariantOption =
  | { value?: string; option?: { title?: string } }
  | { value?: string; option_title?: string; title?: string }

const sanitizeText = (value?: string | null): string => {
  if (!value) return ""
  return String(value).replace(/\s+/g, " ").trim()
}

const sanitizeOptionName = (value?: string | null): string => {
  const text = sanitizeText(value)
  if (!text) return ""
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const sanitizeOptionValue = (value?: string | null): string => sanitizeText(value)

const buildVariantTitleFromOptions = (
  options: Record<string, string>,
  fallback: string,
): string => {
  const entries = Object.entries(options || {})
    .map(([k, v]) => [sanitizeOptionName(k), sanitizeOptionValue(v)] as const)
    .filter(([k, v]) => Boolean(k) && Boolean(v) && k.toLowerCase() !== "default")

  if (!entries.length) {
    return sanitizeText(fallback) || fallback
  }

  const rank = (name: string) => {
    const n = name.toLowerCase()
    if (n === "type") return 0
    if (n === "qty" || n === "quantity") return 1
    return 2
  }

  entries.sort(([a], [b]) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    return a.localeCompare(b)
  })

  const values = entries.map(([, v]) => v).filter(Boolean)
  return values.join(" / ") || sanitizeText(fallback) || fallback
}

const parseArgs = (argv: string[]) => {
  // When using `medusa exec ... -- <args>`, the raw process.argv will include `--`.
  // Only parse args after `--` if present.
  const dd = argv.indexOf("--")
  const args = dd >= 0 ? argv.slice(dd + 1) : argv

  const out: { productId?: string; dryRun: boolean; limit?: number } = {
    dryRun:
      args.includes("--dry-run") ||
      args.includes("--dryrun") ||
      args.includes("--dryRun") ||
      args.includes("--dry"),
  }

  const get = (flag: string) => {
    const idx = args.indexOf(flag)
    if (idx === -1) return undefined
    return args[idx + 1]
  }

  const productId = get("--product-id")
  if (productId) out.productId = productId

  const limitRaw = get("--limit")
  if (limitRaw && !Number.isNaN(Number(limitRaw))) out.limit = Number(limitRaw)

  return out
}

export default async function fixVariantTitles({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productModuleService: any = container.resolve(Modules.PRODUCT)

  const { productId, dryRun, limit } = parseArgs(process.argv.slice(2))

  logger.info(
    `Fixing variant titles${productId ? ` for product ${productId}` : ""}...${
      dryRun ? " (dry-run)" : ""
    }`
  )

  const productIds: string[] = []

  if (productId) {
    productIds.push(productId)
  } else {
    const { data } = await query.graph({
      entity: "product",
      fields: ["id"],
      pagination: limit ? { take: limit } : undefined,
    })

    for (const p of data || []) {
      if (p?.id) productIds.push(p.id)
    }
  }

  let updated = 0
  let skipped = 0

  for (const pid of productIds) {
    const product = await productModuleService.retrieveProduct(pid, {
      relations: ["variants", "variants.options", "variants.options.option"],
    })

    const productTitle = sanitizeText(product?.title) || pid
    const variants: any[] = product?.variants || []

    for (const v of variants) {
      const currentTitle = sanitizeText(v?.title)
      const sku = sanitizeText(v?.sku)

      // Build option map from whatever shape the DTO uses.
      const optionMap: Record<string, string> = {}

      const opts: VariantOption[] = Array.isArray(v?.options) ? v.options : []
      for (const opt of opts) {
        const name =
          sanitizeOptionName((opt as any)?.option?.title) ||
          sanitizeOptionName((opt as any)?.option_title) ||
          sanitizeOptionName((opt as any)?.title)
        const value = sanitizeOptionValue((opt as any)?.value)
        if (name && value) optionMap[name] = value
      }

      const fallback = productTitle
      const nextTitle = buildVariantTitleFromOptions(optionMap, fallback)

      if (!nextTitle || nextTitle === currentTitle) {
        skipped++
        continue
      }

      logger.info(
        `- ${v.id}${sku ? ` (${sku})` : ""}: "${currentTitle || "(empty)"}" -> "${nextTitle}"`
      )

      if (!dryRun) {
        await productModuleService.updateProductVariants(v.id, { title: nextTitle })
      }
      updated++
    }
  }

  logger.info(`Done. Updated ${updated} variants. Skipped ${skipped}.`)
}


