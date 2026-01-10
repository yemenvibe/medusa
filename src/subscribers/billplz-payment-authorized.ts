import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import { extractCartIdFromPaymentSession } from "../utils/payment-session"

/**
 * Subscriber that automatically completes the cart when Billplz payment is authorized
 * This ensures orders are created when payment webhooks are received
 */
export default async function billplzPaymentAuthorized({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  if (!data?.id) {
    return
  }

  try {
    const paymentModuleService = container.resolve(Modules.PAYMENT)

    // Get the payment session to find the cart
    const paymentSession = await paymentModuleService.retrievePaymentSession(data.id)
    
    if (!paymentSession) {
      console.error("Billplz: Payment session not found", { sessionId: data.id })
      return
    }

    // Only process Billplz payments (Medusa provider ids are typically "pp_billplz_*")
    const providerId = paymentSession.provider_id as string | undefined
    if (!providerId?.startsWith("pp_billplz_")) {
      return
    }

    // Only process when payment is authorized
    const status = paymentSession.status as string | undefined
    if (status !== "authorized") {
      return
    }

    // Get the cart ID from the payment session
    const cartId = extractCartIdFromPaymentSession(paymentSession)

    if (!cartId) {
      console.error("Billplz: Cart ID not found in payment session", {
        sessionId: data.id,
        paymentCollectionId: paymentSession.payment_collection_id,
      })
      return
    }

    // Complete the cart to create the order
    console.log("Billplz: Completing cart after payment authorization", {
      cartId,
      sessionId: data.id,
      providerId,
    })
    
    await completeCartWorkflow(container).run({
      input: {
        id: cartId,
      },
    })

    console.log("Billplz: Cart completed successfully", { cartId })
  } catch (error) {
    console.error("Billplz: Error completing cart after payment authorization", {
      sessionId: data.id,
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    })
    // Don't throw - we don't want to break the webhook processing
  }
}

export const config: SubscriberConfig = {
  event: "payment_session.updated",
}

