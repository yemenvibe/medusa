import {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ListPaymentMethodsInput,
  ListPaymentMethodsOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import { AbstractPaymentProvider, PaymentActions, ModuleProvider, Modules } from "@medusajs/framework/utils"

type BillplzOptions = {
  api_key: string
  x_signature_key: string
  collection_id: string
  store_url: string
  backend_url: string
  production: boolean
}

function normalizeBillplzMobile(
  raw: unknown,
  countryCode?: string | null
): string | null {
  if (raw == null) return null
  const input = String(raw).trim()
  if (!input) return null

  // Keep digits (and optional leading '+'), strip spaces/dashes/parentheses/etc.
  let cleaned = input.replace(/[^\d+]/g, "")

  // Billplz expects digits-only (no '+')
  if (cleaned.startsWith("+")) {
    cleaned = cleaned.slice(1)
  }

  const cc = String(countryCode || "").toLowerCase()
  // Malaysia: convert leading 0xxxxxxxxx -> 60xxxxxxxxx
  if (cc === "my" || cc === "malaysia") {
    if (cleaned.startsWith("0")) {
      cleaned = `60${cleaned.slice(1)}`
    }
  }

  // Must be digits-only and a sensible length.
  if (!/^\d+$/.test(cleaned)) return null
  if (cleaned.length < 9 || cleaned.length > 15) return null

  return cleaned
}

function stringifyBillplzErrorMessage(raw: unknown): string {
  if (Array.isArray(raw)) {
    return raw.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ")
  }
  if (typeof raw === "string") return raw
  if (raw == null) return ""
  try {
    return JSON.stringify(raw)
  } catch {
    return String(raw)
  }
}

class BillplzProvider extends AbstractPaymentProvider<BillplzOptions> {
  static identifier = "billplz"

  protected readonly options_: BillplzOptions

  constructor(container: Record<string, unknown>, options: BillplzOptions) {
    super(container, options)
    
    // Validate required options
    if (!options?.api_key || !options.api_key.trim()) {
      throw new Error("Billplz payment provider requires a valid API key. Please set BILLPLZ_API_KEY in your environment variables.")
    }
    if (!options?.collection_id || !options.collection_id.trim()) {
      throw new Error("Billplz payment provider requires a valid collection ID. Please set BILLPLZ_COLLECTION_ID in your environment variables.")
    }
    
    const apiKey = options.api_key.trim()
    const collectionId = options.collection_id.trim()
    
    // Log initialization (without exposing full credentials)
    console.log("Billplz Provider initialized:", {
      apiKeyLength: apiKey.length,
      apiKeyPrefix: apiKey.substring(0, 8) + "...",
      collectionIdLength: collectionId.length,
      collectionIdPrefix: collectionId.substring(0, 8) + "...",
      hasSignatureKey: !!options.x_signature_key,
      storeUrl: options.store_url,
      backendUrl: options.backend_url,
    })
    
    this.options_ = {
      ...options,
      api_key: apiKey,
      collection_id: collectionId,
      x_signature_key: options.x_signature_key?.trim() || "",
    }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const { data } = input
    const status = data?.status as string
    
    if (status === "paid" || status === "authorized") {
      return { status: "authorized" }
    }
    
    if (status === "failed" || status === "cancelled" || status === "canceled") {
      return { status: "canceled" }
    }
    
    return { status: "pending" }
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const { amount, currency_code, context, data } = input

    try {
      // Check environment variable directly to determine sandbox mode
      // BILLPLZ_SANDBOX=true means use sandbox, false or undefined means production
      // Note: Your API key appears to be for production, so use BILLPLZ_SANDBOX=false
      const useSandbox = process.env.BILLPLZ_SANDBOX === "true" || process.env.BILLPLZ_SANDBOX === "1"
      const billplzApiUrl = useSandbox
        ? "https://www.billplz-sandbox.com/api/v3"
        : "https://www.billplz.com/api/v3"
      
      // Log which environment is being used
      if (useSandbox) {
        console.warn("Billplz: Using SANDBOX environment. Ensure your API key is a sandbox key.")
      }

      // Convert amount to smallest currency unit (cents/sen)
      // For MYR, 1 MYR = 100 sen
      const amountInCents = typeof amount === "string" ? Math.round(parseFloat(amount) * 100) : Math.round(Number(amount) * 100)

      // Extract customer info from context and data
      // Try multiple paths to find email and mobile
      const ctx = context as any || {}
      const dataObj = data as any || {}

      // Debug logging to understand what Medusa provides
      console.log("Billplz initiatePayment input:", {
        hasContext: !!context,
        contextKeys: Object.keys(ctx),
        hasData: !!data,
        dataKeys: Object.keys(dataObj),
        inputKeys: Object.keys(input),
      })

      // NOTE:
      // This Medusa store endpoint doesn't accept `context`, so for Billplz we pass recipient info via `data`.
      // Medusa forwards `input.data` to the provider as `data` (and also injects `session_id`).
      const customerEmail =
        dataObj?.email ||
        dataObj?.customer?.email ||
        ctx?.email ||
        ctx?.customer?.email ||
        ctx?.billing_address?.email ||
        null

      const customerMobile =
        dataObj?.mobile ||
        dataObj?.phone ||
        dataObj?.customer?.phone ||
        ctx?.mobile ||
        ctx?.phone ||
        ctx?.customer?.phone ||
        ctx?.billing_address?.phone ||
        null
      
      // Use the extracted email and mobile
      const finalEmail = customerEmail
      const finalMobile = customerMobile
      const countryCode =
        dataObj?.country_code || ctx?.country_code || dataObj?.countryCode || ctx?.countryCode || null
      
      // Validate that we have at least email or mobile
      if (!finalEmail && !finalMobile) {
        console.error("Billplz: Missing email and mobile.", {
          contextKeys: Object.keys(ctx),
          dataKeys: Object.keys(dataObj),
        })
        throw new Error(
          "Billplz requires either email or mobile number for the bill recipient. Please ensure checkout has cart email or billing phone."
        )
      }
      
      // Extract customer name from various possible locations
      const customerName =
        dataObj?.name ||
        dataObj?.customer_name ||
        ctx?.customer_name ||
        ctx?.customer?.first_name ||
        ctx?.billing_address?.first_name ||
        ctx?.customer?.last_name ||
        "Customer"
      
      // Description is required (max 200 characters)
      const description = (ctx?.description || 
                         dataObj?.description || 
                         `Order payment - ${currency_code.toUpperCase()}`).substring(0, 200)
      
      if (!description || description.trim().length === 0) {
        throw new Error("Billplz requires a description for the bill")
      }

      // Validate required fields
      if (!this.options_.api_key) {
        throw new Error("Billplz API key is missing")
      }
      if (!this.options_.collection_id) {
        throw new Error("Billplz collection ID is missing")
      }
      if (amountInCents <= 0) {
        throw new Error("Payment amount must be greater than 0")
      }
      if (!customerName || customerName.length > 255) {
        throw new Error("Customer name is required and must be 255 characters or less")
      }
      if (!this.options_.backend_url) {
        throw new Error("Billplz requires callback_url. Please set BACKEND_URL or MEDUSA_BACKEND_URL in your environment variables.")
      }

      // Create a bill in Billplz according to API requirements
      // Required fields: collection_id (string), name (max 255 chars), amount (positive integer)
      // Either email OR mobile is required (at least one)
      const billData: Record<string, any> = {
        collection_id: String(this.options_.collection_id), // Ensure it's a string
        name: customerName.substring(0, 255), // Max 255 characters
        amount: amountInCents, // Positive integer in smallest currency unit
      }
      
      // Add email OR mobile (at least one is required)
      // Prefer email if both are available, but API accepts both
      if (finalEmail) {
        billData.email = String(finalEmail).trim()
      }
      if (finalMobile) {
        const formattedMobile = normalizeBillplzMobile(finalMobile, countryCode)
        if (formattedMobile) {
          billData.mobile = formattedMobile
        } else if (!finalEmail) {
          // If email isn't provided, we must provide a valid mobile.
          throw new Error(
            "Billplz requires a valid mobile number when email isn't provided. Example: 60123456789"
          )
        } else {
          console.warn("Billplz: Ignoring invalid mobile format, proceeding with email only.", {
            countryCode,
            mobile: String(finalMobile),
          })
        }
      }
      
      // Description is required (max 200 characters)
      billData.description = description

      // NOTE:
      // In Medusa v2's standard checkout flow, the order is created when the cart is completed.
      // For hosted/redirect payment providers, the payment is typically confirmed first (via redirect/webhook),
      // then the cart is completed to create the order. So `order_id` is often not available here.
      const orderId =
        (ctx as any)?.order_id ||
        (ctx as any)?.orderId ||
        (ctx as any)?.order?.id ||
        (dataObj as any)?.order_id ||
        (dataObj as any)?.orderId ||
        (dataObj as any)?.order?.id ||
        null

      // Store payment session_id in reference_1 for webhook retrieval
      // Medusa provides session_id as resource_id in context, or may inject it into data
      const sessionId = 
        (ctx as any)?.resource_id || 
        (ctx as any)?.session_id || 
        (data as any)?.session_id || 
        (input as any)?.session_id ||
        (input as any)?.resource_id
      
      if (sessionId) {
        billData.reference_1 = String(sessionId)
        billData.reference_1_label = "Payment Session ID"
        console.log("Billplz: Storing session_id in reference_1:", sessionId)
      } else {
        console.error("Billplz: WARNING - session_id not found! Cannot complete order on webhook.", {
          contextKeys: Object.keys(ctx),
          dataKeys: Object.keys(dataObj),
          inputKeys: Object.keys(input),
        })
      }

      // Extract cart id (used by storefront callback route to complete the cart after payment)
      const cartId =
        (ctx as any)?.cart_id ||
        (ctx as any)?.cartId ||
        (ctx as any)?.cart?.id ||
        (dataObj as any)?.cart_id ||
        (dataObj as any)?.cartId ||
        null

      // Store identifiers for debugging/troubleshooting in Billplz dashboard.
      // Prefer `order_id` if available, otherwise store `cart_id`.
      if (orderId) {
        billData.reference_2 = String(orderId)
        billData.reference_2_label = "Order ID"
      } else if (cartId) {
        billData.reference_2 = String(cartId)
        billData.reference_2_label = "Cart ID"
      }

      // Callback URL is required
      billData.callback_url = `${this.options_.backend_url}/hooks/billplz`
      
      // Redirect URL is optional but recommended
      // Use a default country code (can be overridden via env or made dynamic)
      // The frontend route handler will process the redirect appropriately
      if (this.options_.store_url) {
        // Try to extract country code from context if available, otherwise use default
        const defaultCountryCode =
          (this.options_ as any)?.default_country_code ||
          process.env.DEFAULT_COUNTRY_CODE ||
          "my"
        const countryCode = (ctx as any)?.country_code || (dataObj as any)?.country_code || defaultCountryCode
        const base = String(this.options_.store_url).replace(/\/+$/, "")
        // Avoid double-appending when store_url already includes the countryCode path segment
        const redirectBase = base.endsWith(`/${countryCode}`) ? base : `${base}/${countryCode}`
        // Hosted payment redirect should return to a callback route that completes the cart (creates the order),
        // then redirects to `/order/:id/confirmed`.
        // We pass cartId because orderId usually doesn't exist yet at this point.
        billData.redirect_url = cartId
          ? `${redirectBase}/api/capture-payment/billplz/${cartId}?country_code=${encodeURIComponent(String(countryCode))}`
          : `${redirectBase}/order/confirmed`
      }

      // Billplz API uses Basic Auth
      // According to Billplz docs, it's typically: Basic base64(api_key:)
      // But some accounts might require: Basic base64(api_key:api_secret)
      const apiKey = String(this.options_.api_key).trim()
      
      // Validate API key format (Billplz API keys are typically long alphanumeric strings)
      if (!apiKey || apiKey.length < 10) {
        throw new Error("Invalid Billplz API key format")
      }
      
      // Billplz typically uses API key only (empty password)
      // But if x_signature_key is provided and API key alone fails, try using it as secret
      const apiSecret = this.options_.x_signature_key?.trim() || ""
      
      // Use API key with secret if secret is available, otherwise use API key only
      const authString = apiSecret 
        ? Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")
        : Buffer.from(`${apiKey}:`).toString("base64")
      
      // Log request details for debugging (without exposing full API key)
      console.log("Billplz API Request:", {
        url: `${billplzApiUrl}/bills`,
        apiKeyLength: apiKey.length,
        apiKeyPrefix: apiKey.substring(0, 8) + "...",
        apiKeySuffix: "..." + apiKey.substring(apiKey.length - 4),
        collectionId: this.options_.collection_id,
        collectionIdLength: this.options_.collection_id?.length || 0,
        useSandbox,
        billplzSandboxEnv: process.env.BILLPLZ_SANDBOX,
        billDataKeys: Object.keys(billData),
        amount: billData.amount,
        email: billData.email,
      })
      
      const response = await fetch(`${billplzApiUrl}/bills`, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${authString}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(billData),
      })

      if (!response.ok) {
        const errorText = await response.text()
        let errorData: any = {}
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = { error: { message: errorText } }
        }
        
        // Log more details for debugging (don't log full API key for security)
        const useSandbox = process.env.BILLPLZ_SANDBOX === "true" || process.env.BILLPLZ_SANDBOX === "1"
        console.error("Billplz API Error:", {
          status: response.status,
          statusText: response.statusText,
          errorData,
          url: `${billplzApiUrl}/bills`,
          apiKeyLength: this.options_.api_key?.length || 0,
          apiKeyPrefix: this.options_.api_key?.substring(0, 5) + "...",
          collectionId: this.options_.collection_id,
          isSandbox: useSandbox,
          billplzSandboxEnv: process.env.BILLPLZ_SANDBOX,
        })
        
        const rawMessage =
          errorData?.error?.message ?? errorData?.message ?? response.statusText
        const message = stringifyBillplzErrorMessage(rawMessage) || response.statusText

        throw new Error(`Failed to create Billplz payment: ${message} (Status: ${response.status})`)
      }

      const billResponse = await response.json()
      const billplzBase = useSandbox
        ? "https://www.billplz-sandbox.com"
        : "https://www.billplz.com"
      const billId = billResponse?.id
      const resolvedBillUrl =
        billResponse?.url ||
        billResponse?.redirect_url ||
        (billId ? `${billplzBase}/bills/${billId}` : undefined)

      return {
        id: billId,
        status: "pending",
        data: {
          bill_id: billId,
          bill_url: resolvedBillUrl,
          billplz_base: billplzBase,
          ...(orderId ? { order_id: String(orderId) } : {}),
          ...(cartId && !orderId ? { cart_id: String(cartId) } : {}), // Fallback for legacy support
        },
      }
    } catch (error) {
      throw new Error(`Billplz payment initiation failed: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const { data } = input
    const statusResult = await this.getPaymentStatus({ data })
    
    if (statusResult.status === "authorized") {
      return {
        // Billplz is effectively auto-captured when paid.
        // Returning "captured" lets Medusa auto-capture the payment and mark the order as paid.
        status: "captured",
        data: data as Record<string, unknown>,
      }
    }

    return {
      status: "error",
      data: data as Record<string, unknown>,
    }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    // Billplz doesn't support cancellation, but we can mark it as canceled
    return {
      data: {
        ...(input.data as Record<string, unknown>),
        status: "canceled",
      },
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    // For Billplz, payment is captured automatically when paid
    const statusResult = await this.getPaymentStatus({ data: input.data })
    
    if (statusResult.status === "authorized") {
      return {
        data: {
          ...(input.data as Record<string, unknown>),
          status: "captured",
        },
      }
    }

    return {
      data: input.data as Record<string, unknown>,
    }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    // Billplz doesn't support deletion, return the data as-is
    return {
      data: input.data as Record<string, unknown>,
    }
  }

  async getStatus(paymentSessionData: Record<string, unknown>): Promise<string> {
    const status = paymentSessionData?.status as string
    
    if (status === "paid" || status === "authorized") {
      return "authorized"
    }
    
    if (status === "failed" || status === "cancelled" || status === "canceled") {
      return "canceled"
    }
    
    return "pending"
  }

  async getPaymentData(paymentSessionData: Record<string, unknown>): Promise<Record<string, unknown>> {
    return paymentSessionData
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    // Billplz refunds need to be handled through their API
    // This is a placeholder - implement actual refund logic if Billplz supports it
    return {
      data: {
        ...(input.data as Record<string, unknown>),
        refunded_amount: input.amount,
        status: "refunded",
      },
    }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    try {
      const billId = (input.data as Record<string, unknown>)?.id as string
      if (!billId) {
        return { data: input.data as Record<string, unknown> }
      }

      // Check environment variable directly to determine sandbox mode
      const useSandbox = process.env.BILLPLZ_SANDBOX === "true" || process.env.BILLPLZ_SANDBOX === "1"
      const billplzApiUrl = useSandbox
        ? "https://www.billplz-sandbox.com/api/v3"
        : "https://www.billplz.com/api/v3"

      const response = await fetch(`${billplzApiUrl}/bills/${billId}`, {
        method: "GET",
        headers: {
          "Authorization": `Basic ${Buffer.from(`${this.options_.api_key}:`).toString("base64")}`,
        },
      })

      if (response.ok) {
        const billData = await response.json()
        return {
          data: {
            ...(input.data as Record<string, unknown>),
            status: billData.paid ? "paid" : "pending",
            paid: billData.paid,
          },
        }
      }

      return { data: input.data as Record<string, unknown> }
    } catch (error) {
      return { data: input.data as Record<string, unknown> }
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    // Billplz doesn't support updating bills, return the existing session
    return {
      data: input.data as Record<string, unknown>,
    }
  }

  async listPaymentMethods(input: ListPaymentMethodsInput): Promise<ListPaymentMethodsOutput> {
    // Billplz doesn't support saved payment methods, return empty array
    return []
  }

  async getWebhookActionAndData(payload: ProviderWebhookPayload["payload"]): Promise<WebhookActionResult> {
    // Verify webhook signature
    const signature = payload.headers?.["x-signature"] || payload.headers?.["X-Signature"]
    const data = payload.data as Record<string, unknown>
    
    // Verify signature using x_signature_key
    if (signature) {
      const expectedSignature = this.generateSignature(data)
      if (signature !== expectedSignature) {
        throw new Error("Invalid webhook signature")
      }
    }

    const paid = data.paid === true || data.paid === "true"
    const action = paid ? PaymentActions.AUTHORIZED : PaymentActions.PENDING
    
    // Extract session_id from reference_1 (where we stored it during bill creation)
    // NOTE: reference_2 stores order_id (BEST PRACTICE: order created before payment initiation)
    const sessionId = 
      (data as any).reference_1 || 
      (data as any).metadata?.session_id || 
      data.id
    
    // Extract order_id from reference_2 for logging/debugging
    const orderId = (data as any).reference_2
    
    if (!sessionId) {
      console.error("Billplz webhook: Could not find session_id in webhook data", {
        billId: data.id,
        reference_1: (data as any).reference_1,
        reference_2: (data as any).reference_2,
        orderId: orderId,
        metadata: (data as any).metadata,
      })
      throw new Error("Missing session_id in Billplz webhook data")
    }
    
    // Log order_id if available (helps with debugging and order tracking)
    if (orderId) {
      console.log("Billplz webhook: Processing payment for order_id:", orderId, "session_id:", sessionId)
    }
    
    return {
      action,
      data: {
        session_id: String(sessionId),
        amount: data.amount as number,
      },
    }
  }

  private generateSignature(data: Record<string, unknown>): string {
    // Generate signature using x_signature_key
    // Billplz signature format: HMAC-SHA256 of specific fields
    const crypto = require("crypto")
    // Billplz webhook signature is typically: id|paid_at|paid|x_signature|state
    const stringToSign = `${data.id}|${data.paid_at || ""}|${data.paid}|${this.options_.x_signature_key}|${data.state || ""}`
    return crypto
      .createHmac("sha256", this.options_.x_signature_key)
      .update(stringToSign)
      .digest("hex")
  }
}

export { BillplzProvider }
export default ModuleProvider(Modules.PAYMENT, {
  services: [BillplzProvider],
})

