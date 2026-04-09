/**
 * Test script to trigger order shipped notification email
 * 
 * Usage:
 *   medusa exec ./test-order-shipped-email.ts --order-id <order-id> --fulfillment-id <fulfillment-id> --email ammar.alqadasi@gmail.com
 */

export default async function testOrderShippedEmail({
  container,
  logger,
}: {
  container: any
  logger: any
}) {
  const args = process.argv.slice(2)
  let orderId: string | undefined
  let fulfillmentId: string | undefined
  let testEmail: string | undefined

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--order-id" && args[i + 1]) {
      orderId = args[i + 1]
    }
    if (args[i] === "--fulfillment-id" && args[i + 1]) {
      fulfillmentId = args[i + 1]
    }
    if (args[i] === "--email" && args[i + 1]) {
      testEmail = args[i + 1]
    }
  }

  try {
    const notificationModuleService = container.resolve("notification")
    const orderModuleService = container.resolve("order")
    const fulfillmentModuleService = container.resolve("fulfillment")

    let order
    let fulfillment

    if (orderId) {
      // Retrieve the order
      logger.info(`Retrieving order: ${orderId}`)
      order = await orderModuleService.retrieveOrder(orderId, {
        relations: [
          "items",
          "items.product",
          "items.variant",
          "shipping_address",
          "billing_address",
          "fulfillments",
          "fulfillments.labels",
        ],
      })

      // Get fulfillment
      if (fulfillmentId) {
        fulfillment = order.fulfillments?.find((f: any) => f.id === fulfillmentId)
        if (!fulfillment) {
          try {
            fulfillment = await fulfillmentModuleService.retrieveFulfillment(fulfillmentId, {
              relations: ["labels"],
            })
          } catch (err) {
            logger.warn(`Could not retrieve fulfillment ${fulfillmentId}, using first fulfillment with labels`)
            fulfillment = order.fulfillments?.find((f: any) => f.labels && f.labels.length > 0)
          }
        }
      } else {
        // Use first fulfillment with labels
        fulfillment = order.fulfillments?.find((f: any) => f.labels && f.labels.length > 0)
        if (!fulfillment && order.fulfillments && order.fulfillments.length > 0) {
          fulfillment = order.fulfillments[0]
        }
      }
    } else {
      // List recent orders and find one with fulfillments
      logger.info("No order ID provided. Listing recent orders...")
      const [orders] = await orderModuleService.listOrders(
        {},
        {
          take: 10,
          order: { created_at: "DESC" },
          relations: [
            "items",
            "items.product",
            "items.variant",
            "shipping_address",
            "billing_address",
            "fulfillments",
            "fulfillments.labels",
          ],
        }
      )

      if (orders && orders.length > 0) {
        // Find first order with fulfillments
        order = orders.find((o: any) => o.fulfillments && o.fulfillments.length > 0)
        if (order) {
          fulfillment = order.fulfillments?.find((f: any) => f.labels && f.labels.length > 0)
          if (!fulfillment && order.fulfillments && order.fulfillments.length > 0) {
            fulfillment = order.fulfillments[0]
          }
          logger.info(`Using order: ${order.id} (${order.display_id})`)
        } else {
          throw new Error("No orders with fulfillments found. Please provide an order ID with --order-id")
        }
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

    if (!fulfillment) {
      throw new Error("No fulfillment found for this order")
    }

    // Override email if test email is provided
    const emailToSend = testEmail || order.email

    // Get tracking number
    const trackingNumber = 
      fulfillment.labels?.[0]?.tracking_number ||
      fulfillment.tracking_numbers?.[0] ||
      fulfillment.data?.tracking_number ||
      fulfillment.data?.easyparcel_tracking_no

    logger.info(`Sending order shipped email to: ${emailToSend}`)
    logger.info(`Order: ${order.display_id || order.id}`)
    logger.info(`Fulfillment: ${fulfillment.id}`)
    if (trackingNumber) {
      logger.info(`Tracking Number: ${trackingNumber}`)
    }

    // Send notification using the notification module service
    const result = await notificationModuleService.createNotifications({
      to: emailToSend,
      channel: "email",
      template: "order.shipment_created",
      data: {
        order,
        fulfillment: {
          ...fulfillment,
          tracking_number: trackingNumber,
        },
      },
    })

    logger.info(`✅ Order shipped email sent successfully!`)
    logger.info(`   Email ID: ${result.id}`)
    logger.info(`   Sent to: ${emailToSend}`)
    logger.info(`   Order: ${order.display_id || order.id}`)
    logger.info(`   Fulfillment: ${fulfillment.id}`)

    return {
      success: true,
      emailId: result.id,
      sentTo: emailToSend,
      orderId: order.id,
      orderDisplayId: order.display_id,
      fulfillmentId: fulfillment.id,
      trackingNumber: trackingNumber,
    }
  } catch (error) {
    logger.error(`❌ Failed to send order shipped email:`)
    logger.error(error instanceof Error ? error.message : String(error))
    if (error instanceof Error && error.stack) {
      logger.error(error.stack)
    }
    throw error
  }
}





