import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { WOOCOMMERCE_MODULE } from "../../modules/woocommerce"
import WooCommerceModuleService from "../../modules/woocommerce/service"

type GetWooCommerceProductsInput = {
  currentPage: number
  pageSize: number
}

export const getWooCommerceProductsStep = createStep(
  "get-woocommerce-products",
  async (
    { currentPage, pageSize }: GetWooCommerceProductsInput,
    { container },
  ) => {
    const wooCommerceService = container.resolve(
      WOOCOMMERCE_MODULE,
    ) as WooCommerceModuleService

    const response = await wooCommerceService.getProducts({
      page: currentPage,
      pageSize,
    })
// console.log("WooCommerce products response:", response)
    return new StepResponse(response)
  },
)
