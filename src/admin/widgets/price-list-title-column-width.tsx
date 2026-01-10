import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { useEffect } from "react"

const STYLE_ID = "alsultan-price-list-title-column-width"

/**
 * Medusa Admin "Prices" step uses the Bulk Editor. It currently doesn't support manual
 * column resizing, so we widen the first (Title) column via CSS for better usability.
 *
 * This is intentionally written with multiple selector fallbacks because the Bulk Editor
 * implementation can vary between Admin versions.
 */
const css = `
/* -------- Bulk Editor (Price Lists / Edit Prices) -------- */

/* IMPORTANT: Keep this narrowly scoped so ONLY the Title column changes.
   Medusa Bulk Editor uses 0-based column indexes (data-column-index="0") and
   sets width inline. Override with !important. */
[role="grid"] [role="columnheader"][data-column-index="0"],
[role="grid"] [role="gridcell"][data-column-index="0"] {
  min-width: 200px  !important;
  width: 250px !important;
  flex: 0 0 250px !important;
}

/* If the title text is still truncated, allow wrapping just inside column 0 */
[role="grid"] [role="gridcell"][data-column-index="0"] .truncate {
  white-space: normal !important;
}

/* Prefer horizontal scroll over truncating everything */
[data-radix-scroll-area-viewport] {
  overflow-x: auto !important;
}
`

const PriceListTitleColumnWidthWidget = () => {
  useEffect(() => {
    const existing = document.getElementById(STYLE_ID) as HTMLStyleElement | null
    if (existing) {
      // Important: Admin is an SPA; during hot reload / cached builds the old
      // style tag might persist. Always keep it in sync with the latest CSS.
      if (existing.textContent !== css) {
        existing.textContent = css
      }
      return
    }

    const style = document.createElement("style")
    style.id = STYLE_ID
    style.textContent = css
    document.head.appendChild(style)
  }, [])

  return null
}

export const config = defineWidgetConfig({
  // Widget disabled - price list column width customization is not needed.
  zone: ["price_list.details.before", "price_list.list.before"],
  // disabled:true // disable the widget for now
})

export default PriceListTitleColumnWidthWidget


