import type { PaymentSessionDTO } from "@medusajs/types"

type PaymentSessionWithCartHints = PaymentSessionDTO & {
  cart_id?: string | null
  cartId?: string | null
  data?: Record<string, unknown> & {
    cart_id?: string | null
    cartId?: string | null
  }
  context?: Record<string, unknown> & {
    cart_id?: string | null
    cartId?: string | null
  }
  metadata?: Record<string, unknown> & {
    cart_id?: string | null
    cartId?: string | null
  }
}

const pickString = (value: unknown) =>
  typeof value === "string" && value.length ? value : null

export const extractCartIdFromPaymentSession = (
  session?: PaymentSessionDTO | null
): string | null => {
  if (!session) {
    return null
  }

  const withHints = session as PaymentSessionWithCartHints

  return (
    pickString(withHints.cart_id) ||
    pickString(withHints.cartId) ||
    pickString(withHints.data?.cart_id) ||
    pickString(withHints.data?.cartId) ||
    pickString(withHints.context?.cart_id) ||
    pickString(withHints.context?.cartId) ||
    pickString(withHints.metadata?.cart_id) ||
    pickString(withHints.metadata?.cartId) ||
    null
  )
}


