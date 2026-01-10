import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Subscriber to send order confirmation email when an order is placed
 */
export default async function orderPlacedNotificationHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  
  try {
    const notificationModuleService = container.resolve("notification")
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // Retrieve the order.
    // NOTE: In this project setup, Order module relation population can crash in MikroORM.
    // Use Query Graph to fetch the order + nested data safely.
    logger.info(`order.placed: retrieving order ${data.id}`)
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "email",
        "display_id",
        "currency_code",
        "total",
        "items.*",
        "shipping_address.*",
        "billing_address.*",
      ],
      filters: {
        id: data.id,
      },
    })

    const order = Array.isArray(orders) ? orders[0] : undefined
    logger.info(`order.placed: retrieved order ${order?.id}`)

    if (!order || !order.email) {
      logger.warn(
        `Order or email not found for notification: ${JSON.stringify({ orderId: data.id })}`
      )
      return
    }

    logger.info(
      `Sending order confirmation email: ${JSON.stringify({
        orderId: order.id,
        displayId: order.display_id,
        email: order.email,
      })}`
    )

    logger.info(`order.placed: creating notification for ${order.email}`)
    await notificationModuleService.createNotifications({
      to: order.email,
      channel: "email",
      template: "order.placed",
      data: {
        order,
      },
    })
    logger.info(`order.placed: createNotifications finished`)

    logger.info(
      `Order confirmation email sent successfully: ${JSON.stringify({
        orderId: order.id,
      })}`
    )
  } catch (error) {
    logger.error(
      `Failed to send order confirmation email: ${JSON.stringify({
        orderId: data.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}

