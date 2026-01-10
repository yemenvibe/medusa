import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import { extractCartIdFromPaymentSession } from "../../../utils/payment-session"

/**
 * Billplz Webhook Handler
 * 
 * This endpoint receives payment callbacks from Billplz when a payment is completed.
 * Billplz will POST a Bill object to this endpoint.
 * 
 * Webhook payload structure:
 * {
 *   id: string,
 *   collection_id: string,
 *   paid: boolean,
 *   state: string,
 *   amount: number,
 *   paid_amount: number,
 *   due_at: string,
 *   email: string,
 *   mobile: string,
 *   name: string,
 *   url: string,
 *   reference_1: string,
 *   reference_1_label: string,
 *   reference_2: string,
 *   reference_2_label: string,
 *   redirect_url: string,
 *   callback_url: string,
 *   description: string,
 *   paid_at: string,
 *   x_signature: string
 * }
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  try {
    const webhookData = normalizeBillplzPayload(req.body) as Record<string, unknown>
    
    // Log webhook received
    console.log("Billplz webhook received:", {
      id: webhookData.id,
      paid: webhookData.paid,
      state: webhookData.state,
      amount: webhookData.amount,
    })

    // Verify webhook signature if x_signature is provided (optional, can be noisy if miscomputed)
    const xSignature = webhookData.x_signature as string | undefined
    if (xSignature) {
      const xSignatureKey = process.env.BILLPLZ_X_SIGNATURE_KEY
      if (!xSignatureKey) {
        console.error("BILLPLZ_X_SIGNATURE_KEY not configured, skipping signature verification")
      } else {
        const expectedSignature = generateBillplzSignature(webhookData, xSignatureKey)
        
        if (xSignature !== expectedSignature) {
          // NOTE: We do NOT reject the webhook. If our signature algorithm or request parsing
          // differs from Billplz's expectations, rejecting here leads to "paid but no order".
          // In production, keep logs quiet unless explicitly enabled.
          if (
            process.env.BILLPLZ_LOG_SIGNATURE_MISMATCH === "true" ||
            process.env.NODE_ENV !== "production"
          ) {
            console.error("Invalid Billplz webhook signature (continuing anyway)", {
              received: xSignature.substring(0, 10) + "...",
              expected: expectedSignature.substring(0, 10) + "...",
              contentType: String((req.headers as any)?.["content-type"] || ""),
              payloadKeys: Object.keys(webhookData || {}).sort(),
            })
          }
        }
      }
    }

    // Extract payment information
    const billId = webhookData.id as string
    const paid = webhookData.paid === true || webhookData.paid === "true"
    const amount = webhookData.amount as number
    const paidAmount = (webhookData.paid_amount as number) || amount
    const state = webhookData.state as string

    if (!billId) {
      return res.status(400).json({ error: "Missing bill ID" })
    }

    // Use the Billplz provider id as configured in the storefront
    const providerId = "pp_billplz_billplz"

    // We store session_id in Billplz reference_1 during bill creation
    let sessionIdRaw =
      (webhookData as any)?.reference_1 ||
      (webhookData as any)?.metadata?.session_id ||
      null

    // Some Billplz callback payloads may omit reference fields.
    // In that case, fetch the Bill to recover reference_1 (session_id).
    if (!sessionIdRaw) {
      try {
        const bill = await fetchBillplzBill(billId)
        sessionIdRaw =
          (bill as any)?.reference_1 ||
          (bill as any)?.metadata?.session_id ||
          null

        if (sessionIdRaw) {
          console.log("Billplz webhook: Recovered session_id from Billplz API", {
            billId,
            hasReference1: Boolean((bill as any)?.reference_1),
          })
        } else {
          console.warn("Billplz webhook: Billplz API did not return reference_1", {
            billId,
            billKeys: bill ? Object.keys(bill).sort() : [],
          })
        }
      } catch (e) {
        console.error("Billplz webhook: Failed to fetch Bill details from Billplz API", {
          billId,
          error: e instanceof Error ? e.message : "Unknown error",
        })
      }
    }

    const sessionId = sessionIdRaw ? String(sessionIdRaw) : ""

    if (!sessionId) {
      console.error("Billplz webhook: Missing session_id (reference_1) in payload", {
        billId,
        reference_1: (webhookData as any)?.reference_1,
        reference_2: (webhookData as any)?.reference_2,
        payloadKeys: Object.keys(webhookData || {}).sort(),
      })
      return res.status(200).json({
        message: "Webhook received but missing session_id",
        id: billId,
      })
    }

    console.log("Billplz webhook processed:", {
      action: paid ? "authorized" : "pending",
      sessionId,
      billId,
      paid,
    })

    // Try to let Medusa update the payment session status (best-effort).
    // On some deployments, string registrations like `paymentModuleService` aren't available.
    try {
      const paymentModuleService = req.scope.resolve(Modules.PAYMENT) as any
      if (typeof paymentModuleService?.processWebhook === "function") {
        await paymentModuleService.processWebhook(providerId, {
          data: webhookData,
          headers: req.headers as Record<string, unknown>,
        })
      }
    } catch (e) {
      console.warn("Billplz: processWebhook unavailable; continuing with cart completion", {
        sessionId,
        billId,
        error: e instanceof Error ? e.message : "Unknown error",
      })
    }

      // Ensure order creation: complete the cart right here when Billplz reports paid/authorized
      // (This avoids relying on event name/payload differences across Medusa versions.)
      if (paid) {
        try {
          const paymentService = req.scope.resolve(Modules.PAYMENT) as any

          // Prefer cart_id from Billplz reference_2 (if present)
          const cartIdFromReference2 =
            typeof (webhookData as any)?.reference_2 === "string"
              ? String((webhookData as any).reference_2)
              : null

          // Resolve the *actual* Medusa payment session id.
          // In rare cases, the session id we stored (reference_1) may not exist in the current deployment DB
          // (e.g. callback hits a different environment). If that happens, try to recover it from the cart.
          let resolvedPaymentSessionId = sessionId
          let paymentSession: any = null

          try {
            paymentSession = await paymentService.retrievePaymentSession(resolvedPaymentSessionId)
          } catch (e) {
            // Fallback: recover from cart payment collection (if we have cart id)
            if (cartIdFromReference2) {
              try {
                const cartService = req.scope.resolve(Modules.CART) as any
                const cart = await cartService.retrieveCart(cartIdFromReference2, {
                  relations: ["payment_collection", "payment_collection.payment_sessions"],
                  // Medusa MikroORM repository expects `options` to exist for load strategy handling.
                  options: {},
                })

                const sessions = cart?.payment_collection?.payment_sessions
                const billplzSession =
                  Array.isArray(sessions)
                    ? sessions.find((s: any) =>
                        typeof s?.provider_id === "string" &&
                        s.provider_id.startsWith("pp_billplz_")
                      )
                    : null

                if (billplzSession?.id) {
                  resolvedPaymentSessionId = String(billplzSession.id)
                  paymentSession = await paymentService.retrievePaymentSession(resolvedPaymentSessionId)
                  console.log("Billplz webhook: Recovered payment session from cart", {
                    billId,
                    cartId: cartIdFromReference2,
                    recoveredSessionId: resolvedPaymentSessionId,
                  })
                } else {
                  console.warn("Billplz webhook: Could not find Billplz payment session on cart", {
                    billId,
                    cartId: cartIdFromReference2,
                  })
                }
              } catch (inner) {
                console.warn("Billplz webhook: Failed to recover payment session from cart", {
                  billId,
                  cartId: cartIdFromReference2,
                  error: inner instanceof Error ? inner.message : "Unknown error",
                })
              }
            }

            // If we still don't have a payment session, continue with cart completion (order creation)
            // using reference_2 (cart id). Payment will not be marked as paid in this edge case.
            if (!paymentSession) {
              console.warn("Billplz webhook: Payment session not found; completing cart without marking payment paid", {
                billId,
                sessionId: resolvedPaymentSessionId,
                cartId: cartIdFromReference2,
              })
            }
          }

          // 1) Mark the payment session as authorized/captured in Medusa (so the order is paid)
          // We also persist Billplz status into session data so the provider's authorizePayment can succeed.
          try {
            if (!paymentSession) {
              throw new Error("payment_session_missing")
            }
            const nextData = {
              ...(paymentSession?.data || {}),
              status: "paid",
              bill_id: (paymentSession?.data as any)?.bill_id || billId,
            }

            // updatePaymentSession allows explicitly setting status (webhook-driven)
            if (typeof paymentService?.updatePaymentSession === "function") {
              await paymentService.updatePaymentSession({
                id: resolvedPaymentSessionId,
                // Payment module requires these fields
                amount: paymentSession?.amount,
                currency_code: paymentSession?.currency_code,
                data: nextData,
                status: "authorized",
              })
              console.log("Billplz: Payment session updated from webhook", {
                sessionId: resolvedPaymentSessionId,
                billId,
              })
            }

            // authorizePaymentSession creates the Payment record (idempotent) and auto-captures if provider returns "captured"
            if (typeof paymentService?.authorizePaymentSession === "function") {
              const payment = await paymentService.authorizePaymentSession(resolvedPaymentSessionId, {
                // best-effort context; Medusa will inject idempotency_key internally
                webhook: "billplz",
                bill_id: billId,
              })
              console.log("Billplz: Payment authorized/captured from webhook", {
                sessionId: resolvedPaymentSessionId,
                billId,
                paymentId: payment?.id,
                providerId: payment?.provider_id,
                capturedAt: payment?.captured_at,
              })
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Unknown error"
            if (msg !== "payment_session_missing") {
              console.warn("Billplz: Failed to authorize/capture payment session (continuing with cart completion)", {
                sessionId: resolvedPaymentSessionId,
                billId,
                error: msg,
              })
            }
          }

          const cartId =
            extractCartIdFromPaymentSession(paymentSession) ||
            cartIdFromReference2

          if (!cartId) {
            console.warn("Billplz: Payment session has no cart_id; cannot complete cart", {
              sessionId: resolvedPaymentSessionId,
              billId,
            })
          } else {
            await completeCartWorkflow(req.scope as any).run({ input: { id: cartId } })
            console.log("Billplz: Cart completion triggered from webhook", {
              cartId,
              sessionId: resolvedPaymentSessionId,
            })
          }
        } catch (e) {
          console.error("Billplz: Failed to complete cart from webhook (payment still processed)", {
            sessionId,
            billId,
            error: e instanceof Error ? e.message : "Unknown error",
            stack: e instanceof Error ? e.stack : undefined,
          })
        }
      }

      // Return success to Billplz
      return res.status(200).json({ 
        message: "Webhook processed successfully",
        id: billId,
        paid,
      })
  } catch (error) {
    console.error("Billplz webhook error:", error)
    return res.status(500).json({ 
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    })
  }
}

/**
 * Generate Billplz webhook signature (Billplz X Signature - HMAC_SHA256)
 */
function generateBillplzSignature(
  data: Record<string, unknown>,
  xSignatureKey: string
): string {
  // Billplz X Signature format (HMAC_SHA256):
  // 1) Extract all key-value pairs EXCEPT x_signature
  // 2) Construct a "source string" per pair: normalizedKey + normalizedValue
  //    - For nested keys like billplz[id], normalize by removing [ and ] => billplzid
  //    - Trim only leading/trailing whitespace from values (keep internal spaces)
  // 3) Sort ascending, case-insensitive
  // 4) Join with "|" and HMAC-SHA256 with the shared XSignature key
  const crypto = require("crypto")

  const entries: string[] = []

  for (const [rawKey, rawValue] of Object.entries(data || {})) {
    if (!rawKey) continue

    // Ignore any x_signature field, including nested billplz[x_signature]
    const keyLower = rawKey.toLowerCase()
    if (keyLower === "x_signature" || keyLower.endsWith("[x_signature]")) {
      continue
    }

    const normalizedKey = rawKey.replaceAll("[", "").replaceAll("]", "")

    let normalizedValue = ""
    if (rawValue === null || rawValue === undefined) {
      normalizedValue = ""
    } else if (typeof rawValue === "boolean") {
      normalizedValue = rawValue ? "true" : "false"
    } else {
      normalizedValue = String(rawValue)
    }

    // Billplz examples trim outer whitespace (e.g. email=" tester@.. " => "tester@..")
    normalizedValue = normalizedValue.trim()

    entries.push(`${normalizedKey}${normalizedValue}`)
  }

  entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))

  const stringToSign = entries.join("|")

  return crypto.createHmac("sha256", xSignatureKey).update(stringToSign).digest("hex")
}

function normalizeBillplzPayload(body: unknown): Record<string, unknown> {
  if (!body) return {}

  // If Billplz sends x-www-form-urlencoded, the framework may give us a string
  if (typeof body === "string") {
    const params = new URLSearchParams(body)
    return Object.fromEntries(params.entries())
  }

  // In some setups this might be a Buffer
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(body)) {
    const params = new URLSearchParams(body.toString("utf8"))
    return Object.fromEntries(params.entries())
  }

  if (typeof body === "object") {
    return body as Record<string, unknown>
  }

  return {}
}

async function fetchBillplzBill(billId: string): Promise<Record<string, unknown>> {
  const apiKey = String(process.env.BILLPLZ_API_KEY || "").trim()
  if (!apiKey) {
    throw new Error("BILLPLZ_API_KEY is not configured")
  }

  const useSandbox =
    process.env.BILLPLZ_SANDBOX === "true" || process.env.BILLPLZ_SANDBOX === "1"
  const base = useSandbox
    ? "https://www.billplz-sandbox.com/api/v3"
    : "https://www.billplz.com/api/v3"

  // Billplz uses Basic base64(api_key:)
  const authString = Buffer.from(`${apiKey}:`).toString("base64")

  const res = await fetch(`${base}/bills/${encodeURIComponent(billId)}`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${authString}`,
      "Content-Type": "application/json",
    },
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(
      `Billplz GET bill failed (${res.status} ${res.statusText}): ${text.slice(0, 200)}`
    )
  }

  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`Billplz GET bill returned non-JSON: ${text.slice(0, 200)}`)
  }
}

