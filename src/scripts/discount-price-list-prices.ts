import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

type GraphPrice = {
  id: string
  amount: number | string
  currency_code: string
  price_set_id: string
  price_list_id: string | null
  min_quantity?: number | string | null
  max_quantity?: number | string | null
}

const parseArgs = (argv: string[]) => {
  const dd = argv.indexOf("--")
  const args = dd >= 0 ? argv.slice(dd + 1) : argv

  const get = (flag: string) => {
    const i = args.indexOf(flag)
    if (i === -1) return undefined
    return args[i + 1]
  }

  const out = {
    dryRun: args.includes("--dry-run") || args.includes("--dryrun"),
    list: args.includes("--list"),
    all: args.includes("--all"),
    confirm: args.includes("--confirm"),
    priceListId: get("--price-list-id") || get("--price_list_id"),
    percentRaw: get("--percent") || "50",
  }

  return out
}

const toInt = (v: unknown) => {
  if (typeof v === "number") return v
  if (typeof v === "string" && v.trim() !== "") return Number(v)
  return NaN
}

export default async function discountPriceListPrices({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const pricingModuleService: any = container.resolve(Modules.PRICING)

  const { dryRun, priceListId, percentRaw, list, all, confirm } = parseArgs(
    process.argv.slice(2)
  )

  if (list) {
    const { data } = await query.graph({
      entity: "price_list",
      fields: ["id", "title", "status", "type"],
    })

    const rows = (data || []) as any[]
    if (!rows.length) {
      logger.info("No price lists found.")
      return
    }

    logger.info("Price lists:")
    for (const pl of rows) {
      logger.info(`- ${pl.id}: ${pl.title} (${pl.status}/${pl.type})`)
    }
    return
  }

  if (!priceListId && !all) {
    throw new Error(
      "Missing --price-list-id. Example: medusa exec ./src/scripts/discount-price-list-prices.ts -- --price-list-id pl_123 --percent 50 --dry-run"
    )
  }

  const percent = Number(percentRaw)
  if (Number.isNaN(percent) || percent <= 0 || percent >= 100) {
    throw new Error("--percent must be a number between 0 and 100 (exclusive)")
  }

  const factor = (100 - percent) / 100

  if (all && !confirm) {
    throw new Error(
      "Refusing to run with --all without --confirm. Re-run with: --all --confirm (and consider --dry-run first)."
    )
  }

  const priceListIds: string[] = []
  if (priceListId) {
    priceListIds.push(priceListId)
  } else {
    const { data } = await query.graph({
      entity: "price_list",
      fields: ["id"],
    })
    for (const pl of (data || []) as any[]) {
      if (pl?.id) priceListIds.push(pl.id)
    }
  }

  logger.info(
    `Discounting ${priceListIds.length} price list(s) by ${percent}% (${dryRun ? "dry-run" : "apply"})`
  )

  let totalUpdated = 0

  for (const plId of priceListIds) {
    // Query all price entries associated with this price list.
    const { data } = await query.graph({
      entity: "price",
      fields: [
        "id",
        "amount",
        "currency_code",
        "price_set_id",
        "price_list_id",
        "min_quantity",
        "max_quantity",
      ],
      filters: {
        price_list_id: plId,
      },
    })

    const prices = (data || []) as GraphPrice[]

    if (!prices.length) {
      logger.info(`- ${plId}: no prices found`)
      continue
    }

    const updated = prices.map((p) => {
      const oldAmount = toInt(p.amount)
      if (Number.isNaN(oldAmount)) {
        throw new Error(`Invalid amount for price ${p.id}: ${String(p.amount)}`)
      }

      const newAmount = Math.max(0, Math.round(oldAmount * factor))

      return {
        id: p.id,
        price_set_id: p.price_set_id,
        currency_code: p.currency_code,
        amount: newAmount,
        min_quantity: p.min_quantity ?? undefined,
        max_quantity: p.max_quantity ?? undefined,
      }
    })

    // Log a small sample
    logger.info(`- ${plId}: ${updated.length} prices`)
    for (const p of updated.slice(0, 5)) {
      const old = prices.find((x) => x.id === p.id)!
      logger.info(
        `  - ${p.id} ${p.currency_code}: ${String(old.amount)} -> ${String(p.amount)}`
      )
    }
    if (updated.length > 5) {
      logger.info(`  ... and ${updated.length - 5} more`)
    }

    if (!dryRun) {
      await pricingModuleService.updatePriceListPrices([
        {
          price_list_id: plId,
          prices: updated,
        },
      ])
    }

    totalUpdated += updated.length
  }

  if (dryRun) {
    logger.info(`Dry-run complete. Would update ${totalUpdated} prices.`)
    return
  }

  logger.info(`Done. Updated ${totalUpdated} prices.`)
}


