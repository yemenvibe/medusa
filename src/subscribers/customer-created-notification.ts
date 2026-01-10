import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"

/**
 * Subscriber to send welcome email when a customer is created
 */
export default async function customerCreatedNotificationHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  
  try {
    const notificationModuleService = container.resolve("notification")
    const customerModuleService = container.resolve("customer")

    // Retrieve the customer
    const customer = await customerModuleService.retrieveCustomer(data.id)

    if (!customer || !customer.email) {
      logger.warn(
        `Customer or email not found for welcome notification: ${JSON.stringify({
          customerId: data.id,
        })}`
      )
      return
    }

    logger.info(
      `Sending welcome email: ${JSON.stringify({
        customerId: customer.id,
        email: customer.email,
      })}`
    )

    const storeUrl = process.env.STORE_URL || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:8000"

    await notificationModuleService.createNotifications({
      to: customer.email,
      channel: "email",
      template: "customer.created",
      data: {
        customer,
        store_url: storeUrl,
      },
    })

    logger.info(
      `Welcome email sent successfully: ${JSON.stringify({
        customerId: customer.id,
      })}`
    )
  } catch (error) {
    logger.error(
      `Failed to send welcome email: ${JSON.stringify({
        customerId: data.id,
        error: error instanceof Error ? error.message : String(error),
      })}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "customer.created",
}

