import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"

/**
 * Subscriber to send shipping notification when a shipment is created
 */
export default async function orderShippedNotificationHandler({
  event,
  container,
}: SubscriberArgs<any>) {
  const logger = container.resolve("logger")
  const data = event.data
  const eventName = (event as any)?.name || (event as any)?.eventName || "unknown"
  
  // Log the event name and data for debugging
  logger.info(
    `Order shipped notification subscriber triggered: ${JSON.stringify({
      eventName,
      eventData: data,
    })}`
  )
  
  try {
    const notificationModuleService = container.resolve("notification")
    const orderModuleService = container.resolve("order")
    const fulfillmentModuleService = container.resolve("fulfillment")

    // Handle different event data structures
    // Event might have: { id, order_id } or { fulfillment_id, order_id } or just { id }
    // Also check nested structures like { fulfillment: { id }, order: { id } }
    let fulfillmentId = data.fulfillment_id || data.fulfillmentId || data.id || data.fulfillment?.id
    let orderId = data.order_id || data.orderId || data.order?.id
    
    // If we have a fulfillment object, try to get order_id from it
    if (data.fulfillment && !orderId) {
      orderId = data.fulfillment.order_id || data.fulfillment.orderId || data.fulfillment.order?.id
    }
    
    // If we have an order object, try to get fulfillment_id from it
    if (data.order && !fulfillmentId) {
      // Check if order has fulfillments array
      if (Array.isArray(data.order.fulfillments) && data.order.fulfillments.length > 0) {
        fulfillmentId = data.order.fulfillments[0].id
      }
    }

    // If we only have fulfillmentId, retrieve the fulfillment to get order_id
    if (fulfillmentId && !orderId) {
      try {
        // First try to get order_id from fulfillment.
        // Note: Fulfillment entities don't expose an `order` relation; they typically include `order_id`.
        const fulfillment = await fulfillmentModuleService.retrieveFulfillment(fulfillmentId)
        
        // Get order_id from fulfillment - check different possible property names
        orderId = (fulfillment as any).order_id || (fulfillment as any).orderId || (fulfillment as any).order?.id
        
        // If still no order_id, try to find order that has this fulfillment
        if (!orderId) {
          logger.info(`Trying to find order for fulfillment ${fulfillmentId}...`)
          // Search for orders with this fulfillment - get recent orders and check
          const result = await orderModuleService.listOrders(
            {},
            {
              take: 50,
              order: { created_at: "DESC" },
              relations: ["fulfillments"],
            }
          )
          
          // Handle both tuple [orders, count] and array result
          const orders = Array.isArray(result) 
            ? (result.length === 2 ? result[0] : result)
            : result[0] || []
          
          if (Array.isArray(orders) && orders.length > 0) {
            const orderWithFulfillment = orders.find((o: any) => 
              o.fulfillments && Array.isArray(o.fulfillments) && o.fulfillments.some((f: any) => f.id === fulfillmentId)
            )
            
            if (orderWithFulfillment) {
              orderId = orderWithFulfillment.id
              logger.info(`Found order ${orderId} for fulfillment ${fulfillmentId}`)
            }
          }
        }
      } catch (err) {
        logger.warn(
          `Could not retrieve fulfillment ${fulfillmentId} to get order_id: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }

    if (!fulfillmentId) {
      logger.warn(
        `Missing fulfillment_id in event data: ${JSON.stringify(data)}`
      )
      return
    }

    if (!orderId) {
      logger.warn(
        `Missing order_id in event data and could not retrieve from fulfillment: ${JSON.stringify(data)}`
      )
      return
    }

    // Retrieve the order with all necessary relations
    const order = await orderModuleService.retrieveOrder(orderId, {
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

    if (!order || !order.email) {
      logger.warn(
        `Order or email not found for shipping notification: ${JSON.stringify({
          orderId: orderId,
          fulfillmentId: fulfillmentId,
        })}`
      )
      return
    }

    // Find the fulfillment from the order's fulfillments (it should have the shipment)
    const orderWithFulfillments = order as any
    let fulfillment = orderWithFulfillments.fulfillments?.find((f: any) => f.id === fulfillmentId)
    
    // If not found in order relations, retrieve it directly
    if (!fulfillment) {
      try {
        fulfillment = await fulfillmentModuleService.retrieveFulfillment(fulfillmentId, {
          relations: ["labels"],
        })
      } catch (err) {
        logger.warn(
          `Could not retrieve fulfillment ${fulfillmentId}: ${err instanceof Error ? err.message : String(err)}`
        )
        // Try to use the first fulfillment with labels if available
        fulfillment = orderWithFulfillments.fulfillments?.find((f: any) => f.labels && f.labels.length > 0)
      }
    }

    if (!fulfillment) {
      logger.warn(
        `Fulfillment not found: ${JSON.stringify({
          orderId: orderId,
          fulfillmentId: fulfillmentId,
        })}`
      )
      return
    }

    // Get tracking number from labels or fulfillment data
    const trackingNumber = 
      fulfillment.labels?.[0]?.tracking_number ||
      fulfillment.tracking_numbers?.[0] ||
      fulfillment.data?.tracking_number ||
      fulfillment.data?.easyparcel_tracking_no

    logger.info(
      `Sending order shipped email: ${JSON.stringify({
        orderId: order.id,
        displayId: order.display_id,
        fulfillmentId: fulfillment.id,
        trackingNumber: trackingNumber,
        email: order.email,
      })}`
    )

    await notificationModuleService.createNotifications({
      to: order.email,
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

    logger.info(
      `Order shipped email sent successfully: ${JSON.stringify({
        orderId: order.id,
        fulfillmentId: fulfillment.id,
        email: order.email,
      })}`
    )
  } catch (error) {
    logger.error(
      `Failed to send order shipped email: ${JSON.stringify({
        eventData: data,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })}`
    )
  }
}

export const config: SubscriberConfig = {
  event: [
    // Canonical Medusa v2 events:
    // - shipment.created: emitted when a shipment is created for an order
    // - delivery.created: emitted when a fulfillment is marked as delivered
    // - order.fulfillment_created: emitted when a fulfillment is created for an order
    "shipment.created",
    "delivery.created",
    "order.fulfillment_created",
  ],
}

