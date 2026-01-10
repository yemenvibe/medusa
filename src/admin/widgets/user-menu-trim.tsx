import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { useEffect } from "react"

const STYLE_ID = "alsultan-user-menu-trim"

const css = `
[data-radix-dropdown-menu-content] a[href="/settings/profile"],
[data-radix-dropdown-menu-content] a[href="https://docs.medusajs.com"],
[data-radix-dropdown-menu-content] a[href="https://medusajs.com/changelog/"] {
  display: none !important;
}

[data-radix-dropdown-menu-content] [role="separator"]:has(+ a[href="/settings/profile"]),
[data-radix-dropdown-menu-content] [role="separator"]:has(+ a[href="https://docs.medusajs.com"]),
[data-radix-dropdown-menu-content] [role="separator"]:has(+ a[href="https://medusajs.com/changelog/"]) {
  display: none !important;
}

[data-radix-dropdown-menu-content] [role="separator"]:has(+ [role="separator"]) {
  display: none !important;
}
`

const UserMenuTrimWidget = () => {
  // Disabled intentionally (kept only to avoid build-time widget warnings).
  return null

  useEffect(() => {
    if (document.getElementById(STYLE_ID)) {
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
  // Use a valid zone to satisfy the admin build, but the component is disabled.
  zone: ["login.before"],
})

export default UserMenuTrimWidget
