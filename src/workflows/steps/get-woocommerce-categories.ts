import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { WOOCOMMERCE_MODULE } from "../../modules/woocommerce"
import WooCommerceModuleService from "../../modules/woocommerce/service"

type GetWooCommerceCategoriesInput = {
  currentPage: number
  pageSize: number
}

export const getWooCommerceCategoriesStep = createStep(
  "get-woocommerce-categories",
  async ({ currentPage, pageSize }: GetWooCommerceCategoriesInput, { container }) => {
    const wooCommerceService = container.resolve(WOOCOMMERCE_MODULE) as WooCommerceModuleService

    const response = await wooCommerceService.getCategories({
      page: currentPage,
      pageSize,
    })

    return new StepResponse(response)
  },
)
