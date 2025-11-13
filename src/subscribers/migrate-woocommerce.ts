import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import {
  migrateCategoriesFromWooCommerceWorkflow,
  migrateProductsFromWooCommerceWorkflow,
} from "../workflows"

type Payload = {
  type?: Array<"product" | "category">
  currentPage?: number
  pageSize?: number
  syncAllPages?: boolean
}

export default async function migrateWooCommerce({
  container,
  event: { data },
}: SubscriberArgs<Payload>) {
  const logger = container.resolve("logger")

  const pageSize = data.pageSize && data.pageSize > 0 ? data.pageSize : 50
  const initialPage = data.currentPage && data.currentPage > 0 ? data.currentPage : 1
  const runAllPages = Boolean(data.syncAllPages)

  const types = Array.isArray(data.type) && data.type.length ? data.type : ["product"]

  const runPaged = async (
    label: "products" | "categories",
    executor: (args: { currentPage: number; pageSize: number }) => Promise<{
      result?: {
        total?: number
        hasMore?: boolean
      }
    }> ,
  ) => {
    let currentPage = initialPage
    let hasMore = true

    while (hasMore) {
      logger.info(
        `Migrating WooCommerce ${label} (page ${currentPage}, page size ${pageSize})`,
      )

      const { result: pagination } = await executor({ currentPage, pageSize })

      if (!runAllPages) {
        break
      }

      const total = pagination?.total ?? 0
      hasMore = pagination?.hasMore ?? currentPage * pageSize < total
      currentPage += 1
    }
  }

  for (const entry of new Set(types)) {
    switch (entry) {
      case "category": {
        await runPaged("categories", ({ currentPage, pageSize }) =>
          migrateCategoriesFromWooCommerceWorkflow(container).run({
            input: {
              currentPage,
              pageSize,
            },
          }),
        )
        break
      }
      case "product":
      default: {
        await runPaged("products", ({ currentPage, pageSize }) =>
          migrateProductsFromWooCommerceWorkflow(container).run({
            input: {
              currentPage,
              pageSize,
            },
          }),
        )
        break
      }
    }
  }

  logger.info("Finished WooCommerce migration run")
}

export const config: SubscriberConfig = {
  event: "migrate.woocommerce",
}
