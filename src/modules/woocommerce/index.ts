import { Module } from "@medusajs/framework/utils"
import WooCommerceModuleService from "./service"

export const WOOCOMMERCE_MODULE = "woocommerce"

export default Module(WOOCOMMERCE_MODULE, {
  service: WooCommerceModuleService,
})
