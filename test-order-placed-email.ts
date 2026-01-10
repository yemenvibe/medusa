/**
 * Test script to trigger order placed notification email
 * 
 * Usage:
 *   medusa exec ./test-order-placed-email.ts --order-id <order-id>
 *   medusa exec ./test-order-placed-email.ts --email ammar.alqadasi@gmail.com
 */

export default async function testOrderPlacedEmail({
  container,
  logger,
}: {
  container: any
  logger: any
}) {
  const args = process.argv.slice(2)
  let orderId: string | undefined
  let testEmail: string | undefined

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--order-id" && args[i + 1]) {
      orderId = args[i + 1]
    }
    if (args[i] === "--email" && args[i + 1]) {
      testEmail = args[i + 1]
    }
  }

  try {
    const notificationModuleService = container.resolve("notification")
    const orderModuleService = container.resolve("order")

    let order

    if (orderId) {
      // Use existing order
      logger.info(`Retrieving order: ${orderId}`)
      order = await orderModuleService.retrieveOrder(orderId, {
        relations: [
          "items",
          "items.product",
          "items.variant",
          "shipping_address",
          "billing_address",
        ],
      })
    } else {
      // List recent orders and use the first one
      logger.info("No order ID provided. Listing recent orders...")
      const [orders] = await orderModuleService.listOrders(
        {},
        {
          take: 1,
          order: { created_at: "DESC" },
          relations: [
            "items",
            "items.product",
            "items.variant",
            "shipping_address",
            "billing_address",
          ],
        }
      )

      if (orders && orders.length > 0) {
        order = orders[0]
        logger.info(`Using order: ${order.id} (${order.display_id})`)
      } else {
        throw new Error("No orders found. Please provide an order ID with --order-id")
      }
    }

    if (!order) {
      throw new Error("Order not found")
    }

    if (!order.email) {
      throw new Error("Order does not have an email address")
    }

    // Override email if test email is provided
    const emailToSend = testEmail || order.email

    logger.info(`Sending order confirmation email to: ${emailToSend}`)
    logger.info(`Order: ${order.display_id || order.id}`)

    // Send notification using the notification module service
    const result = await notificationModuleService.createNotifications({
      to: emailToSend,
      channel: "email",
      template: "order.placed",
      data: {
        order,
      },
    })

    logger.info(`✅ Order confirmation email sent successfully!`)
    logger.info(`   Email ID: ${result.id}`)
    logger.info(`   Sent to: ${emailToSend}`)
    logger.info(`   Order: ${order.display_id || order.id}`)

    return {
      success: true,
      emailId: result.id,
      sentTo: emailToSend,
      orderId: order.id,
      orderDisplayId: order.display_id,
    }
  } catch (error) {
    logger.error(`❌ Failed to send order confirmation email:`)
    logger.error(error instanceof Error ? error.message : String(error))
    throw error
  }
}

