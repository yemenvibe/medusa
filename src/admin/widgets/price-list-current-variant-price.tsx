import { useEffect, useRef } from "react"
import { defineWidgetConfig } from "@medusajs/admin-sdk"

import { sdk } from "../lib/sdk"

const LABEL_CLASS = "alsultan-current-price-label"
const GRID_SELECTOR = '[role="grid"]'

type VariantPriceInfo = {
  id: string
  priceLabel: string
  currencyCode: string
}

const PriceListCurrentVariantPriceWidget = () => {
  // Disabled intentionally (kept only to avoid build-time widget warnings).
  return null

  const observerRef = useRef<MutationObserver | null>(null)
  const queuedIds = useRef<Set<string>>(new Set())
  const priceCache = useRef<Map<string, VariantPriceInfo>>(new Map())
  const pendingDecorations = useRef<Map<string, Element[]>>(new Map())
  const fetchTimeout = useRef<number | null>(null)

  useEffect(() => {
    const grid = document.querySelector(GRID_SELECTOR)
    if (!grid) {
      const fallback = new MutationObserver(() => {
        const gridEl = document.querySelector(GRID_SELECTOR)
        if (gridEl) {
          fallback.disconnect()
          initObserver(gridEl)
        }
      })

      fallback.observe(document.body, {
        childList: true,
        subtree: true,
      })

      return () => fallback.disconnect()
    }

    initObserver(grid)

    return () => {
      observerRef.current?.disconnect()
      observerRef.current = null
      if (fetchTimeout.current) {
        window.clearTimeout(fetchTimeout.current)
        fetchTimeout.current = null
      }
    }
  }, [])

  const initObserver = (grid: Element) => {
    const observer = new MutationObserver(() => scanGrid(grid))
    observer.observe(grid, {
      childList: true,
      subtree: true,
    })
    observerRef.current = observer
    scanGrid(grid)
  }

  const scanGrid = (grid: Element) => {
    const rows = Array.from(grid.querySelectorAll('[role="row"]'))
    if (!rows.length) {
      return
    }

    const currencyCode = resolveCurrencyCode(grid)

    rows.forEach((row) => {
      const variantId = extractVariantId(row)
      if (!variantId) {
        return
      }

      const cacheKey = `${variantId}:${currencyCode}`
      const cached = priceCache.current.get(cacheKey)

      if (cached) {
        decorateRow(row, cached.priceLabel, cached.currencyCode)
        return
      }

      const byId = pendingDecorations.current.get(cacheKey) || []
      if (!byId.length) {
        queuedIds.current.add(variantId)
      }

      pendingDecorations.current.set(cacheKey, byId.concat(row))
    })

    scheduleFetch(currencyCode)
  }

  const scheduleFetch = (currencyCode: string) => {
    if (fetchTimeout.current) {
      return
    }

    fetchTimeout.current = window.setTimeout(async () => {
      const ids = Array.from(queuedIds.current)
      queuedIds.current.clear()
      fetchTimeout.current = null

      if (!ids.length) {
        return
      }

      const chunks: string[][] = []
      const size = 50

      for (let i = 0; i < ids.length; i += size) {
        chunks.push(ids.slice(i, i + size))
      }

      for (const chunk of chunks) {
        try {
          const { variants } = await sdk.admin.productVariant.list({
            id: chunk,
            fields: "id,prices,currency_code",
          })

          variants.forEach((variant) => {
            const priceLabel = resolveVariantPriceLabel(
              variant,
              currencyCode
            )
            const cacheKey = `${variant.id}:${currencyCode}`
            priceCache.current.set(cacheKey, {
              id: variant.id,
              priceLabel,
              currencyCode,
            })

            const rows = pendingDecorations.current.get(cacheKey)
            if (rows?.length) {
              rows.forEach((row) =>
                decorateRow(row, priceLabel, currencyCode)
              )
            }
            pendingDecorations.current.delete(cacheKey)
          })
        } catch (error) {
          console.error("Failed to fetch variant prices", error)
        }
      }
    }, 150)
  }

  return null
}

function decorateRow(
  row: Element,
  priceLabel: string,
  currencyCode: string
) {
  const targetCell =
    row.querySelector('[role="gridcell"][data-column-index="0"]') ?? row

  if (!targetCell) {
    return
  }

  let label = targetCell.querySelector<HTMLElement>(`.${LABEL_CLASS}`)

  if (!label) {
    label = document.createElement("div")
    label.className = `${LABEL_CLASS} text-xs text-ui-fg-subtle mt-1`
    label.style.whiteSpace = "normal"
    targetCell.appendChild(label)
  }

  label.textContent = priceLabel
  applyPlaceholder(row, currencyCode, priceLabel)
}

function applyPlaceholder(
  row: Element,
  currencyCode: string,
  priceLabel: string
) {
  const selector = `input[name*=".currency_prices.${currencyCode}.amount"]`
  const inputs = row.querySelectorAll<HTMLInputElement>(selector)

  inputs.forEach((input) => {
    if (input.placeholder !== priceLabel) {
      input.placeholder = priceLabel
    }
    input.dataset.currentPrice = priceLabel
  })
}

function resolveVariantPriceLabel(
  variant: any,
  currencyCode: string
): string {
  const normalizedCurrency = currencyCode?.toLowerCase() || "myr"

  const matchingPrice =
    variant.prices?.find(
      (price: any) =>
        price?.currency_code?.toLowerCase() === normalizedCurrency &&
        !price.price_list_id
    ) ??
    variant.prices?.[0]

  if (!matchingPrice) {
    return "Current price: —"
  }

  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: (matchingPrice.currency_code || normalizedCurrency).toUpperCase(),
  })

  const majorUnits =
    typeof matchingPrice.amount === "number"
      ? matchingPrice.amount / 100
      : 0

  return `Current price: ${formatter.format(majorUnits)}`
}

function resolveCurrencyCode(scope: Element): string {
  const headers = Array.from(
    scope.querySelectorAll('[role="columnheader"]')
  )

  const headerText = headers
    .map((node) => node.textContent || "")
    .find((text) => text.toLowerCase().includes("price"))

  const match = headerText?.match(/\b([A-Z]{3})\b/)
  return match?.[1]?.toLowerCase() || "myr"
}

function extractVariantId(row: Element): string | undefined {
  // Variant rows contain inputs whose names include the product + variant path.
  const input = row.querySelector<HTMLInputElement>(
    'input[name*="products."][name*=".variants."]'
  )

  if (!input?.name) {
    return undefined
  }

  const match =
    input.name.match(/products\.[^.]+\.variants\.([^.]+)\./) ||
    input.name.match(/variants\[([^\]]+)\]/)

  return match?.[1]
}

export const config = defineWidgetConfig({
  // Widget disabled - price list current variant price display is not needed.
  zone: ["login.before"],
  disabled: true,
})

export default PriceListCurrentVariantPriceWidget


