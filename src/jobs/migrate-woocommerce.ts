import { MedusaContainer } from "@medusajs/framework/types"

export default async function migrateWooCommerceJob(
  container: MedusaContainer,
) {
  const eventBusService = container.resolve("event_bus")

  eventBusService.emit({
    name: "migrate.woocommerce",
    data: {
      type: ["product", "category"],
      currentPage: 1,
      pageSize: 100,
      syncAllPages: true,
    },
  })
}

export const config = {
  name: "migrate-woocommerce-job",
  schedule: "0 2 * * *",
}
