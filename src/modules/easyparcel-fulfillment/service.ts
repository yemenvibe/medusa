import { AbstractFulfillmentProviderService, MedusaError } from "@medusajs/framework/utils"
import type {
  CalculateShippingOptionPriceDTO,
  CalculatedShippingOptionPrice,
  CreateShippingOptionDTO,
  CreateFulfillmentResult,
  FulfillmentDTO,
  FulfillmentItemDTO,
  FulfillmentOption,
  FulfillmentOrderDTO,
  Logger,
} from "@medusajs/framework/types"
import { EasyParcelClient } from "./client"
import type {
  EasyParcelRate,
  EasyParcelOrderItem,
  EasyParcelSubmitOrderResponse,
  EasyParcelPaymentResponse,
} from "./types"
import { resolveMalaysiaStateCode } from "./states"

export type EasyParcelFulfillmentProviderOptions = {
  /**
   * EasyParcel API key.
   * Reference: `file://Malaysia_Individual_1.4.0.0.pdf`
   */
  api_key: string
  /**
   * Override base URL.
   * - Live: https://connect.easyparcel.my/
   * - Demo: http://demo.connect.easyparcel.my/
   *
   * Reference: `file://Malaysia_Individual_1.4.0.0.pdf`
   */
  base_url?: string
  /**
   * Convenience flag; when true and base_url isn't set, uses demo base URL.
   */
  demo?: boolean

  /**
   * Default sender address used for rate checking.
   * If omitted, we attempt to read from `context.from_location`.
   */
  sender_postcode?: string
  sender_state?: string // EasyParcel MY state short code (Appendix III)
  sender_country?: string // defaults to MY
  sender_phone?: string // Sender phone number (required for order submission)
  sender_name?: string // Sender name
  sender_email?: string // Sender email
  sender_company?: string // Sender company
  sender_address1?: string // Sender address line 1
  sender_address2?: string // Sender address line 2
  sender_city?: string // Sender city

  /**
   * Default weight used if it can't be derived from the cart/items.
   */
  default_weight_kg?: number

  /**
   * Timeout for EasyParcel API calls (ms).
   * Default: 20000
   */
  timeout_ms?: number
}

type InjectedDependencies = {
  logger?: Logger
}

class EasyParcelFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static identifier = "easyparcel"

  protected logger_?: Logger
  protected options_: EasyParcelFulfillmentProviderOptions
  protected client_: EasyParcelClient

  constructor(
    { logger }: InjectedDependencies,
    options: EasyParcelFulfillmentProviderOptions
  ) {
    super()

    if (!options?.api_key?.trim()) {
      throw new Error(
        "EasyParcel fulfillment provider requires `api_key`. Please set EASYPARCEL_API_KEY."
      )
    }

    this.logger_ = logger
    this.options_ = {
      ...options,
      api_key: options.api_key.trim(),
      sender_country: options.sender_country?.trim() || "MY",
      default_weight_kg:
        typeof options.default_weight_kg === "number" && options.default_weight_kg > 0
          ? options.default_weight_kg
          : 1,
    }
    
    // Log configuration (without exposing sensitive data)
    this.logger_?.info(
      `EasyParcel provider initialized: ${JSON.stringify({
        has_sender_postcode: Boolean(this.options_.sender_postcode),
        has_sender_state: Boolean(this.options_.sender_state),
        has_sender_phone: Boolean(this.options_.sender_phone),
        sender_phone_length: this.options_.sender_phone?.length || 0,
        base_url: this.options_.base_url || (this.options_.demo ? "demo" : "production"),
      })}`
    )

    const baseUrl =
      options.base_url?.trim() ||
      (options.demo ? "http://demo.connect.easyparcel.my/" : "https://connect.easyparcel.my/")

    this.client_ = new EasyParcelClient({
      apiKey: this.options_.api_key,
      baseUrl,
      timeoutMs:
        typeof this.options_.timeout_ms === "number" && this.options_.timeout_ms > 0
          ? this.options_.timeout_ms
          : undefined,
    })
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    // EasyParcel's rates depend on sender/receiver + parcel details, so we expose
    // strategy-based options and calculate the exact price in `calculatePrice`.
    return [
      {
        id: "easyparcel-cheapest",
        name: "EasyParcel (Cheapest)",
        selection: "cheapest",
      },
      {
        id: "easyparcel-fastest",
        name: "EasyParcel (Fastest)",
        selection: "fastest",
      },
    ]
  }

  async validateOption(_data: Record<string, any>): Promise<boolean> {
    // Shipping options can be created in the dashboard; we keep this permissive
    // and validate required values at runtime during price calculation.
    return true
  }

  async canCalculate(_data: CreateShippingOptionDTO): Promise<boolean> {
    try {
      // Ensure we have sufficient sender configuration.
      this.resolveSender({})
      return true
    } catch {
      return false
    }
  }

  async validateFulfillmentData(
    _optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    _context: Record<string, unknown>
  ): Promise<any> {
    // Store any custom checkout data as-is (merchant can pass parcel dimensions, etc.)
    return data
  }

  async calculatePrice(
    optionData: CalculateShippingOptionPriceDTO["optionData"],
    data: CalculateShippingOptionPriceDTO["data"],
    context: CalculateShippingOptionPriceDTO["context"]
  ): Promise<CalculatedShippingOptionPrice> {
    const selection = (optionData as any)?.selection || (optionData as any)?.id || "cheapest"
    const { sender, receiver, parcel } = this.buildRateCheckInput(data, context)

    const resp = await this.client_.rateCheckingBulk({
      bulk: [
        {
          pick_code: sender.postcode,
          pick_state: sender.state_code,
          pick_country: sender.country_code,
          send_code: receiver.postcode,
          send_state: receiver.state_code,
          send_country: receiver.country_code,
          ...parcel,
        },
      ],
      exclude_fields: ["pgeon_point", "rates.*.dropoff_point", "rates.*.pickup_point"],
    })

    const rate = this.selectRate(resp, selection)
    const basePrice = toNumber(rate?.price)

    if (basePrice === undefined || !Number.isFinite(basePrice) || basePrice <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `EasyParcel returned an invalid price for rate calculation (price: ${String(rate?.price)})`
      )
    }

    const markup = this.resolveMarkupForCurrency(context)
    const price = Math.max(basePrice + markup, 0)

    return {
      calculated_amount: price,
      is_calculated_price_tax_inclusive: false,
    }
  }

  async createFulfillment(
    data: Record<string, unknown>,
    _items: Array<Partial<Omit<FulfillmentItemDTO, "fulfillment">>>,
    order: Partial<FulfillmentOrderDTO> | undefined,
    _fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    // Submit order to EasyParcel
    try {
      // IMPORTANT:
      // In Medusa, the `data` passed to createFulfillment is not always the same
      // as the shipping method's stored `data`. If the order already has the
      // EasyParcel rate info captured on `order.shipping_methods[].data`,
      // merge it in here so we can submit to EasyParcel without recalculating.
      const orderShippingData =
        (order as any)?.shipping_methods?.find((sm: any) => sm?.data)?.data || {}

      const enrichedData = {
        ...orderShippingData,
        ...data,
      }

      // Quick visibility into whether the fulfillment data already carries
      // a `service_id` (e.g. persisted from the rate selection).
      this.logger_?.info(
        `EasyParcel createFulfillment data snapshot: ${JSON.stringify({
          order_id: order?.id,
          display_id: order?.display_id,
          has_service_id: Boolean((enrichedData as any)?.service_id),
          service_id: (enrichedData as any)?.service_id,
          has_rate_id: Boolean((enrichedData as any)?.rate_id),
          has_courier_id: Boolean((enrichedData as any)?.courier_id),
          has_price: Boolean((enrichedData as any)?.price),
        })}`
      )

      const orderItem = await this.buildOrderItem(enrichedData, order)
      
      // Log the exact payload being sent to EasyParcel for debugging
      // Check for empty required fields and validate format
      const emptyFields: string[] = []
      const invalidFields: string[] = []
      const requiredFields = [
        "pick_name", "pick_contact", "pick_addr1", "pick_city", "pick_state", "pick_postcode", "pick_country",
        "send_name", "send_contact", "send_addr1", "send_city", "send_state", "send_postcode", "send_country",
        "service_id", "parcel_weight", "parcel_content"
      ]
      
      for (const field of requiredFields) {
        const value = (orderItem as any)[field]
        if (!value || (typeof value === "string" && value.trim() === "")) {
          emptyFields.push(field)
        }
      }
      
      // Validate country codes are "MY"
      if (orderItem.pick_country !== "MY") {
        invalidFields.push(`pick_country must be "MY", got: "${orderItem.pick_country}"`)
      }
      if (orderItem.send_country !== "MY") {
        invalidFields.push(`send_country must be "MY", got: "${orderItem.send_country}"`)
      }
      
      // Validate postcodes are numeric (Malaysian postcodes are typically 5 digits, but some areas use 4)
      if (!/^\d{4,5}$/.test(orderItem.pick_postcode)) {
        invalidFields.push(`pick_postcode must be 4-5 digits, got: "${orderItem.pick_postcode}"`)
      }
      if (!/^\d{4,5}$/.test(orderItem.send_postcode)) {
        invalidFields.push(`send_postcode must be 4-5 digits, got: "${orderItem.send_postcode}"`)
      }
      
      // Validate weight is positive
      if (!Number.isFinite(orderItem.parcel_weight) || orderItem.parcel_weight <= 0) {
        invalidFields.push(`parcel_weight must be > 0, got: ${orderItem.parcel_weight}`)
      }
      
      this.logger_?.info(
        `Submitting order to EasyParcel: ${JSON.stringify({
        order_id: order?.id,
        display_id: order?.display_id,
          empty_required_fields: emptyFields,
          invalid_fields: invalidFields,
          order_item: {
            // Sender
            pick_name: orderItem.pick_name,
            pick_contact: orderItem.pick_contact,
            pick_email: orderItem.pick_email || "(empty)",
            pick_addr1: (orderItem as any).pick_addr1,
            pick_addr2: (orderItem as any).pick_addr2 || "(empty)",
            pick_city: orderItem.pick_city,
            pick_state: orderItem.pick_state,
            pick_postcode: orderItem.pick_postcode,
            pick_country: orderItem.pick_country,
            // Receiver
            send_name: orderItem.send_name,
            send_contact: orderItem.send_contact,
            send_email: orderItem.send_email || "(empty)",
            send_addr1: (orderItem as any).send_addr1,
            send_addr2: (orderItem as any).send_addr2 || "(empty)",
            send_city: orderItem.send_city,
            send_state: orderItem.send_state,
            send_postcode: orderItem.send_postcode,
            send_country: orderItem.send_country,
            // Parcel
            service_id: orderItem.service_id,
            rate_id: (orderItem as any).rate_id,
            courier_id: (orderItem as any).courier_id,
            courier: (orderItem as any).courier,
            price: (orderItem as any).price,
            cid: (orderItem as any).cid,
            sid: (orderItem as any).sid,
            parcel_weight: orderItem.parcel_weight,
            parcel_value: orderItem.parcel_value,
            parcel_content: orderItem.parcel_content,
            payment_method: orderItem.payment_method,
          },
        })}`
      )
      
      if (emptyFields.length > 0) {
        const errorMsg = `EasyParcel order item has empty required fields: ${emptyFields.join(", ")}`
        this.logger_?.error(errorMsg)
        throw new Error(errorMsg)
      }
      
      if (invalidFields.length > 0) {
        const errorMsg = `EasyParcel order item validation failed: ${invalidFields.join("; ")}`
        this.logger_?.error(errorMsg)
        throw new Error(errorMsg)
      }

      const submitResponse = await this.client_.submitOrderBulk({
        bulk: [orderItem],
      })

      // Log full response for debugging
      this.logger_?.info(
        `EasyParcel submitOrderBulk response: ${JSON.stringify({
          api_status: submitResponse.api_status,
          error_code: submitResponse.error_code,
          error_remark: submitResponse.error_remark,
          result_count: submitResponse.result?.length || 0,
          first_result: submitResponse.result?.[0] ? {
            status: submitResponse.result[0].status,
            message: submitResponse.result[0].message,
            error_messages: submitResponse.result[0].error_messages,
          } : null,
        })}`
      )

      if (submitResponse.api_status !== "Success") {
        const errorMsg = submitResponse.error_remark || submitResponse.error_code || "Unknown error"
        this.logger_?.error(
          `EasyParcel API error: ${JSON.stringify({
            api_status: submitResponse.api_status,
            error_code: submitResponse.error_code,
            error_remark: submitResponse.error_remark,
            full_response: submitResponse,
          })}`
        )
        throw new Error(`EasyParcel order submission failed: ${errorMsg}`)
      }

      const orderResult = submitResponse.result?.[0]
      if (!orderResult || orderResult.status !== "Success") {
        // EasyParcel returns errors in different fields: remarks, message, error_messages
        const errorDetails = 
          (orderResult as any)?.remarks ||
          orderResult?.error_messages?.join(", ") ||
          orderResult?.message ||
          "Unknown error"
        
        this.logger_?.error(
          `EasyParcel order creation failed: ${JSON.stringify({
            order_result: orderResult,
            full_response: submitResponse,
          })}`
        )
        
        throw new Error(`EasyParcel order creation failed: ${errorDetails}`)
      }

      this.logger_?.info(
        `EasyParcel order created successfully: ${JSON.stringify({
          order_no: orderResult.order_no,
          tracking_no: orderResult.tracking_no,
          waybill_no: orderResult.waybill_no,
          courier_name: orderResult.courier_name,
          service_name: orderResult.service_name,
          full_result: orderResult,
        })}`
      )

      // Make payment for the order
      if (orderResult.order_no) {
        try {
          const paymentResponse = await this.client_.makeOrderPayment({
            order_nos: [orderResult.order_no],
          })

          if (paymentResponse.api_status !== "Success") {
            this.logger_?.warn(
              `EasyParcel payment failed: ${JSON.stringify({
              order_no: orderResult.order_no,
              error: paymentResponse.error_remark,
              })}`
            )
          } else {
            this.logger_?.info(
              `EasyParcel payment successful: ${JSON.stringify({
              order_no: orderResult.order_no,
              receipt_no: paymentResponse.payment?.receipt_no,
              })}`
            )
          }
        } catch (paymentError) {
          this.logger_?.warn(
            `EasyParcel payment error: ${JSON.stringify({
            order_no: orderResult.order_no,
            error: paymentError instanceof Error ? paymentError.message : String(paymentError),
            })}`
          )
        }
      }

      return {
        data: {
          ...data,
          easyparcel_service_id: orderItem.service_id,
          easyparcel_order_no: orderResult.order_no,
          easyparcel_tracking_no: orderResult.tracking_no,
          easyparcel_waybill_no: orderResult.waybill_no,
          easyparcel_courier_name: orderResult.courier_name,
          easyparcel_service_name: orderResult.service_name,
        },
        labels: orderResult.waybill_no ? [{
          tracking_number: orderResult.tracking_no || orderResult.waybill_no,
          tracking_url: `https://www.easyparcel.com/my/en/track?tracking_no=${orderResult.tracking_no || orderResult.waybill_no}`,
          label_url: "",
        }] : [],
      }
    } catch (error) {
      this.logger_?.error(
        `EasyParcel createFulfillment error: ${JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        order_id: order?.id,
        })}`
      )

      // Fall back to storing rate info without creating EasyParcel order
      let rate: EasyParcelRate | undefined
      try {
        rate = await this.bestEffortRateFromStoredData(data)
      } catch (e) {
        this.logger_?.warn(
          `EasyParcel: createFulfillment couldn't recompute rate: ${
            e instanceof Error ? e.message : String(e)
          }`
        )
      }

      return {
        data: {
          ...data,
          easyparcel_rate: rate,
          easyparcel_error: error instanceof Error ? error.message : String(error),
        },
        labels: [],
      }
    }
  }

  private resolveMarkupForCurrency(
    context: CalculateShippingOptionPriceDTO["context"]
  ): number {
    const currencyCode =
      (context as any)?.currency_code ||
      (context as any)?.cart?.currency_code ||
      (context as any)?.currency?.code ||
      "myr"

    if (currencyCode.toLowerCase() === "myr") {
      // EasyParcel expects cents; Medusa works in smallest unit.
      return 2 // 2 MYR -> 200 sen
    }

    // No markup for other currencies yet.
    return 0
  }

  async cancelFulfillment(): Promise<any> {
    // Optional: implement cancellation with third-party once order submission is added.
    return {}
  }

  async createReturnFulfillment(): Promise<any> {
    // Optional: implement return fulfillment with third-party once order submission is added.
    return {}
  }

  private buildRateCheckInput(
    data: Record<string, unknown>,
    context: Record<string, unknown>
  ): {
    sender: { postcode: string; state_code: string; country_code: string }
    receiver: { postcode: string; state_code: string; country_code: string }
    parcel: { weight: number; width?: number; length?: number; height?: number; date_coll?: string }
  } {
    const sender = this.resolveSender(context)
    const receiver = this.resolveReceiver(data, context)
    const parcel = this.resolveParcel(data, context)

    return { sender, receiver, parcel }
  }

  private resolveSender(context: Record<string, unknown>): {
    postcode: string
    state_code: string
    country_code: string
  } {
    const fromLocation = (context as any)?.from_location
    const address = fromLocation?.address || fromLocation

    const postcode =
      String(this.options_.sender_postcode || address?.postal_code || address?.zip || "").trim()
    const stateRaw = String(this.options_.sender_state || address?.province || address?.state || "")

    if (!postcode) {
      throw new Error(
        "EasyParcel requires a sender postcode. Set EASYPARCEL_SENDER_POSTCODE or ensure the stock location has a postal code."
      )
    }

    const state_code = resolveMalaysiaStateCode(stateRaw)
    if (!state_code) {
      throw new Error(
        `EasyParcel requires a valid sender state code (Appendix III). Got: "${stateRaw}". Set EASYPARCEL_SENDER_STATE to one of: jhr,kdh,ktn,mlk,nsn,phg,prk,pls,png,sgr,trg,kul,pjy,srw,sbh,lbn`
      )
    }

    return {
      postcode,
      state_code,
      country_code: (this.options_.sender_country || "MY").toUpperCase(),
    }
  }

  private resolveReceiver(
    data: Record<string, unknown>,
    context: Record<string, unknown>
  ): { postcode: string; state_code: string; country_code: string } {
    const shippingAddress =
      (context as any)?.shipping_address ||
      (context as any)?.cart?.shipping_address ||
      (data as any)?.shipping_address ||
      (data as any)?.address ||
      {}

    const postcode = String(shippingAddress?.postal_code || shippingAddress?.zip || "").trim()
    const stateRaw = String(shippingAddress?.province || shippingAddress?.state || "")
    const country = String(shippingAddress?.country_code || "MY").trim().toUpperCase()

    if (!postcode) {
      throw new Error("EasyParcel requires a receiver postcode (shipping address postal_code).")
    }
    if (country !== "MY") {
      throw new Error(`EasyParcel provider currently supports Malaysia only. Got country: ${country}`)
    }

    const state_code = resolveMalaysiaStateCode(stateRaw)
    if (!state_code) {
      throw new Error(
        `EasyParcel requires a valid receiver state code (Appendix III). Got: "${stateRaw}".`
      )
    }

    return { postcode, state_code, country_code: "MY" }
  }

  private resolveParcel(
    data: Record<string, unknown>,
    context: Record<string, unknown>
  ): { weight: number; width?: number; length?: number; height?: number; date_coll?: string } {
    const weight =
      toNumber((data as any)?.weight_kg) ??
      toNumber((data as any)?.weight) ??
      this.deriveWeightFromContext(context) ??
      this.options_.default_weight_kg ??
      1

    const width = toNumber((data as any)?.width)
    const length = toNumber((data as any)?.length)
    const height = toNumber((data as any)?.height)
    const date_coll = typeof (data as any)?.date_coll === "string" ? (data as any)?.date_coll : undefined

    return {
      weight: Number(weight),
      ...(Number.isFinite(width) ? { width } : {}),
      ...(Number.isFinite(length) ? { length } : {}),
      ...(Number.isFinite(height) ? { height } : {}),
      ...(date_coll ? { date_coll } : {}),
    }
  }

  private deriveWeightFromContext(context: Record<string, unknown>): number | undefined {
    const items = (context as any)?.items || (context as any)?.cart?.items
    if (!Array.isArray(items) || !items.length) {
      return undefined
    }

    let total = 0
    let sawAny = false

    for (const item of items) {
      const qty = Number(item?.quantity ?? 0)
      const w = toNumber(item?.variant?.weight ?? item?.product?.weight ?? item?.weight)
      if (!Number.isFinite(qty) || qty <= 0) continue
      if (!Number.isFinite(w) || (w as number) <= 0) continue

      sawAny = true
      total += Number(w) * qty
    }

    return sawAny ? total : undefined
  }

  private selectRate(resp: any, selection: string): EasyParcelRate {
    const apiStatus = String(resp?.api_status || "").toLowerCase()
    if (apiStatus && apiStatus !== "success" && apiStatus !== "ok") {
      const msg =
        resp?.error_remark ||
        resp?.error_message ||
        `EasyParcel API returned status: ${resp?.api_status}`
      throw new MedusaError(MedusaError.Types.INVALID_DATA, msg)
    }

    const rates = resp?.result?.[0]?.rates
    if (!Array.isArray(rates) || !rates.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "EasyParcel returned no rates for the provided addresses/parcel."
      )
    }

    if (String(selection).includes("fast")) {
      return [...rates].sort((a, b) => {
        const ad = extractMinDays(a?.delivery)
        const bd = extractMinDays(b?.delivery)
        return ad - bd
      })[0]
    }

    // Default: cheapest
    return [...rates].sort((a, b) => {
      const ap = toNumber(a?.price) ?? Number.POSITIVE_INFINITY
      const bp = toNumber(b?.price) ?? Number.POSITIVE_INFINITY
      return ap - bp
    })[0]
  }

  /**
   * Format phone number for EasyParcel (Malaysian format: 60123456789 or +60123456789)
   * EasyParcel accepts: digits only, or + followed by digits
   */
  private formatMalaysianPhone(phone: string | null | undefined): string {
    if (!phone) return ""
    
    // Remove all non-digit characters except +
    let cleaned = String(phone).replace(/[^\d+]/g, "")
    
    // If it starts with +60, keep it
    if (cleaned.startsWith("+60")) {
      return cleaned
    }
    
    // If it starts with 60, add +
    if (cleaned.startsWith("60")) {
      return `+${cleaned}`
    }
    
    // If it starts with 0, replace with +60
    if (cleaned.startsWith("0")) {
      return `+60${cleaned.substring(1)}`
    }
    
    // Otherwise, assume it's a local number and add +60
    if (cleaned.length >= 9) {
      return `+60${cleaned}`
    }
    
    // If too short, return as-is (will fail validation but at least we tried)
    return cleaned
  }

  /**
   * EasyParcel order submission is picky about phone formatting. In practice it
   * accepts digits-only with country code (no spaces/dashes). We normalize to:
   * - "60123456789" (no leading "+")
   */
  private formatEasyParcelPhone(phone: string | null | undefined): string {
    const withPlus = this.formatMalaysianPhone(phone)
    return String(withPlus).replace(/^\+/, "")
  }

  private async buildOrderItem(
    data: Record<string, unknown>,
    order: Partial<FulfillmentOrderDTO> | undefined
  ): Promise<EasyParcelOrderItem> {
    // Extract sender information
    const senderPostcode = String(data.pick_code || this.options_.sender_postcode || "")
    const senderState = String(data.pick_state || this.options_.sender_state || "")
    const senderCountry = String(data.pick_country || this.options_.sender_country || "MY")
    
    // Sender phone: prefer from data, then from provider options/env, then use a default
    // EasyParcel requires a valid Malaysian phone number for sender
    const senderPhoneRaw = 
      (data as any)?.pick_contact ||
      (this.options_ as any)?.sender_phone ||
      process.env.EASYPARCEL_SENDER_PHONE ||
      ""
    const senderPhone = this.formatMalaysianPhone(String(senderPhoneRaw))

    if (!senderPostcode) {
      throw new Error("Sender postcode is required for order submission")
    }
    if (!senderState) {
      throw new Error("Sender state is required for order submission")
    }
    if (!senderPhone) {
      throw new Error(
        "Sender phone number is required for EasyParcel. Set EASYPARCEL_SENDER_PHONE or configure sender_phone in provider options."
      )
    }

    // Extract receiver information from shipping address
    const shippingAddress = order?.shipping_address
    if (!shippingAddress) {
      throw new Error("Shipping address is required for order submission")
    }

    const receiverPostcode = String(shippingAddress.postal_code || "")
    const receiverState = resolveMalaysiaStateCode(shippingAddress.province || "")
    const receiverCountry = String(shippingAddress.country_code || "MY").toUpperCase()
    const receiverPhone = this.formatEasyParcelPhone(shippingAddress.phone)

    if (!receiverPostcode) {
      throw new Error("Receiver postcode is required")
    }
    if (!receiverState) {
      throw new Error(`Invalid receiver state: ${shippingAddress.province}`)
    }

    // Extract parcel details
    const weight = Number(data.weight || this.options_.default_weight_kg || 1)
    const serviceId = String((data as any)?.service_id || "")
    
    // Do not recalculate rate during fulfillment. `service_id` must be captured
    // at checkout when the shipping method is selected and persisted in the
    // shipping method's `data`.
    if (!serviceId) {
      throw new Error(
        "Missing EasyParcel service_id on shipping method data. Please re-select the shipping method during checkout so service_id is captured."
      )
    }

    // Calculate parcel value from order.
    // IMPORTANT: In this codebase totals are already in major units (e.g. MYR 30.18),
    // so we must NOT divide by 100 here (doing so produces 0.3018 and can cause
    // EasyParcel to reject the submission as incomplete/invalid).
    const parcelValue = toNumber((order as any)?.total) ?? 0

    // Ensure required fields are not empty (EasyParcel rejects empty strings for required fields)
    const pickAddress1 = String(data.pick_address1 || (this.options_ as any)?.sender_address1 || "").trim()
    const pickCity = String(data.pick_city || (this.options_ as any)?.sender_city || "").trim()
    const sendAddress1 = String(shippingAddress.address_1 || "").trim()
    const sendCity = String(shippingAddress.city || "").trim()
    
    if (!pickAddress1) {
      throw new Error("Sender address (pick_address1) is required. Set EASYPARCEL_SENDER_ADDRESS1 or provide in fulfillment data.")
    }
    if (!pickCity) {
      throw new Error("Sender city (pick_city) is required. Set EASYPARCEL_SENDER_CITY or provide in fulfillment data.")
    }
    if (!sendAddress1) {
      throw new Error("Receiver address (send_address1) is required in shipping address.")
    }
    if (!sendCity) {
      throw new Error("Receiver city (send_city) is required in shipping address.")
    }

    const pickEmail = String(
      (data as any)?.pick_email ||
        (this.options_ as any)?.sender_email ||
        process.env.EASYPARCEL_SENDER_EMAIL ||
        ""
    ).trim()

    if (!pickEmail || !pickEmail.includes("@")) {
      throw new Error(
        "Sender email is required for EasyParcel. Set EASYPARCEL_SENDER_EMAIL (or sender_email in provider options)."
      )
    }

    // Medusa can have email on multiple places depending on how the order was created.
    // Prefer order.email, but fall back to customer email if order.email is empty.
    const sendEmail = String(
      (order as any)?.email ||
        (order as any)?.customer?.email ||
        (order as any)?.customer_email ||
        ""
    ).trim()
    if (!sendEmail || !sendEmail.includes("@")) {
      throw new Error(
        "Receiver email is required for EasyParcel. Please ensure the order has a valid email (order.email or customer.email)."
      )
    }

    const orderItem: EasyParcelOrderItem = {
      // Sender details
      pick_name: String(data.pick_name || (this.options_ as any)?.sender_name || "Sender").trim(),
      pick_company: String(data.pick_company || (this.options_ as any)?.sender_company || "").trim(),
      pick_contact: this.formatEasyParcelPhone(senderPhone),
      pick_email: pickEmail,
      pick_addr1: pickAddress1,
      pick_addr2: String(data.pick_address2 || (this.options_ as any)?.sender_address2 || "").trim(),
      pick_city: pickCity,
      pick_state: senderState,
      pick_postcode: senderPostcode,
      pick_country: senderCountry,
      // Alias fields for compatibility with some EasyParcel accounts/docs
      ...(true
        ? ({
            pick_code: senderPostcode,
          } as any)
        : {}),

      // Receiver details
      send_name: `${shippingAddress.first_name || ""} ${shippingAddress.last_name || ""}`.trim() || "Receiver",
      send_company: String(shippingAddress.company || "").trim(),
      send_contact: receiverPhone || this.formatEasyParcelPhone(senderPhone), // Fallback to sender phone if receiver phone missing
      send_email: sendEmail,
      send_addr1: sendAddress1,
      send_addr2: String(shippingAddress.address_2 || "").trim(),
      send_city: sendCity,
      send_state: receiverState,
      send_postcode: receiverPostcode,
      send_country: receiverCountry,
      ...(true
        ? ({
            send_code: receiverPostcode,
          } as any)
        : {}),

      // Parcel details
      service_id: serviceId,
      ...(String((data as any)?.rate_id || "").trim()
        ? { rate_id: String((data as any).rate_id).trim() }
        : {}),
      ...(String((data as any)?.courier_id || "").trim()
        ? { courier_id: String((data as any).courier_id).trim() }
        : {}),
      ...(String((data as any)?.courier_name || "").trim()
        ? { courier_name: String((data as any).courier_name).trim() }
        : {}),
      ...((data as any)?.price !== undefined && (data as any)?.price !== null
        ? { price: (data as any).price }
        : {}),
      ...((data as any)?.cid !== undefined && (data as any)?.cid !== null
        ? { cid: (data as any).cid }
        : {}),
      ...((data as any)?.sid !== undefined && (data as any)?.sid !== null
        ? { sid: (data as any).sid }
        : {}),
      // EasyParcel submit API often expects `courier` and `price` fields explicitly.
      // Prefer numeric `cid` when present, otherwise fall back to courier_id.
      ...(String((data as any)?.courier || "").trim()
        ? { courier: (data as any).courier }
        : (data as any)?.cid !== undefined && (data as any)?.cid !== null
          ? { courier: (data as any).cid }
          : String((data as any)?.courier_id || "").trim()
            ? { courier: String((data as any).courier_id).trim() }
            : {}),
      parcel_weight: weight,
      parcel_width: data.width ? Number(data.width) : undefined,
      parcel_height: data.height ? Number(data.height) : undefined,
      parcel_length: data.length ? Number(data.length) : undefined,
      parcel_content: String(data.parcel_content || "General Goods"),
      parcel_value: parcelValue,

      // ---- MPSubmitOrderBulk compatibility fields ----
      // The example payload uses: weight/width/length/height/content/value + pick_code/send_code + pick_mobile/send_mobile + collect_date + sms + reference
      weight: weight,
      width: (data as any)?.width ?? 0,
      length: (data as any)?.length ?? 0,
      height: (data as any)?.height ?? 0,
      content: String((data as any)?.parcel_content || "General Goods"),
      value: parcelValue,
      pick_code: senderPostcode,
      send_code: receiverPostcode,
      pick_mobile: this.formatMalaysianPhone(senderPhone),
      send_mobile: this.formatMalaysianPhone(shippingAddress.phone || receiverPhone),
      collect_date: resolveCollectDate(data),
      sms: 1,
      reference: String(order?.id || order?.display_id || ""),

      // References
      reference_1: String(order?.id || ""),
      reference_2: String(order?.display_id || ""),

      // Payment
      payment_method: "CREDIT", // Use credit account
    }

    return orderItem
  }

  private async bestEffortRateFromStoredData(data: Record<string, unknown>): Promise<EasyParcelRate> {
    const sender_postcode = String((data as any)?.sender_postcode || this.options_.sender_postcode || "").trim()
    const sender_state = String((data as any)?.sender_state || this.options_.sender_state || "")
    const receiver_postcode = String((data as any)?.receiver_postcode || (data as any)?.postal_code || "").trim()
    const receiver_state = String((data as any)?.receiver_state || (data as any)?.state || "")
    const weight = toNumber((data as any)?.weight_kg) ?? toNumber((data as any)?.weight) ?? this.options_.default_weight_kg ?? 1

    if (!sender_postcode || !receiver_postcode) {
      throw new Error("Missing stored sender/receiver postcode.")
    }

    const pick_state = resolveMalaysiaStateCode(sender_state)
    const send_state = resolveMalaysiaStateCode(receiver_state)
    if (!pick_state || !send_state) {
      throw new Error("Missing or invalid stored sender/receiver state.")
    }

    const resp = await this.client_.rateCheckingBulk({
      bulk: [
        {
          pick_code: sender_postcode,
          pick_state,
          pick_country: "MY",
          send_code: receiver_postcode,
          send_state,
          send_country: "MY",
          weight: Number(weight),
        },
      ],
    })

    // Default to cheapest for best-effort.
    return this.selectRate(resp, "cheapest")
  }
}

export default EasyParcelFulfillmentProviderService

function toNumber(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined
  const n = typeof v === "number" ? v : Number(String(v).trim())
  return Number.isFinite(n) ? n : undefined
}

function extractMinDays(delivery: unknown): number {
  if (typeof delivery !== "string") return Number.POSITIVE_INFINITY
  const nums = delivery.match(/\d+/g)?.map((x) => Number(x)).filter((n) => Number.isFinite(n))
  if (!nums?.length) return Number.POSITIVE_INFINITY
  return Math.min(...nums)
}

export { EasyParcelFulfillmentProviderService }

function resolveCollectDate(data: Record<string, unknown>): string {
  const explicit = (data as any)?.collect_date || (data as any)?.date_coll
  if (typeof explicit === "string" && /^\d{4}-\d{2}-\d{2}$/.test(explicit.trim())) {
    return explicit.trim()
  }

  // Default to tomorrow (local time) in YYYY-MM-DD
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}


