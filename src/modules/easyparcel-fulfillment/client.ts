import {
  EasyParcelRateCheckingBulkRequest,
  EasyParcelRateCheckingBulkResponse,
  EasyParcelSubmitOrderRequest,
  EasyParcelSubmitOrderResponse,
  EasyParcelPaymentRequest,
  EasyParcelPaymentResponse,
} from "./types"

export type EasyParcelClientOptions = {
  apiKey: string
  /**
   * Base URL including protocol and trailing slash is optional.
   * - Live: https://connect.easyparcel.my/
   * - Demo: http://demo.connect.easyparcel.my/
   *
   * Reference: `file://Malaysia_Individual_1.4.0.0.pdf`
   */
  baseUrl: string
  timeoutMs?: number
}

export class EasyParcelClient {
  protected apiKey_: string
  protected baseUrl_: string
  protected timeoutMs_: number

  constructor(options: EasyParcelClientOptions) {
    if (!options?.apiKey?.trim()) {
      throw new Error("EasyParcel client requires apiKey")
    }
    if (!options?.baseUrl?.trim()) {
      throw new Error("EasyParcel client requires baseUrl")
    }

    this.apiKey_ = options.apiKey.trim()
    this.baseUrl_ = options.baseUrl.trim().replace(/\/?$/, "/")
    // EasyParcel responses can be slow and their endpoints are sometimes behind
    // rate limits / queueing. Use a more forgiving default, but keep it configurable.
    this.timeoutMs_ = options.timeoutMs ?? 60_000
  }

  async rateCheckingBulk(
    payload: EasyParcelRateCheckingBulkRequest
  ): Promise<EasyParcelRateCheckingBulkResponse> {
    return await this.request<EasyParcelRateCheckingBulkResponse>(
      "EPRateCheckingBulk",
      payload
    )
  }

  async submitOrderBulk(
    payload: EasyParcelSubmitOrderRequest
  ): Promise<EasyParcelSubmitOrderResponse> {
    // EasyParcel has multiple "submit order" actions depending on account/API version.
    // Some accounts expect `MPSubmitOrderBulk` and will return generic "Please fill all the required data."
    // if the action doesn't match. We try EP first, then fall back to MP when needed.
    const first = await this.request<EasyParcelSubmitOrderResponse>(
      "EPSubmitOrderBulk",
      payload as any
    )

    const firstResult: any = (first as any)?.result?.[0]
    const firstStatus = String(firstResult?.status || "").toLowerCase()
    const firstRemarks = String(firstResult?.remarks || firstResult?.message || "").toLowerCase()

    const looksLikeWrongAction =
      firstStatus === "fail" &&
      (firstRemarks.includes("please fill") ||
        firstRemarks.includes("required data") ||
        firstRemarks.includes("required field"))

    if (!looksLikeWrongAction) {
      return first
    }

    return await this.request<EasyParcelSubmitOrderResponse>(
      "MPSubmitOrderBulk",
      payload as any
    )
  }

  async makeOrderPayment(
    payload: EasyParcelPaymentRequest
  ): Promise<EasyParcelPaymentResponse> {
    return await this.request<EasyParcelPaymentResponse>(
      "EP-MakingOrderPayment",
      payload
    )
  }

  protected async request<TResponse>(
    action: string,
    payload: Record<string, unknown>
  ): Promise<TResponse> {
    const url = `${this.baseUrl_}?ac=${encodeURIComponent(action)}`

    // EasyParcel is PHP-oriented; in practice some accounts accept JSON,
    // others require form-encoded values. We try JSON first then fall back.
    const body = {
      api: this.apiKey_,
      ...payload,
    }

    // Some EasyParcel accounts/endpoints are picky about request format.
    // We try JSON first, but if it errors (including timeout/abort), we fall back
    // to x-www-form-urlencoded with the same payload.
    let lastError: unknown = undefined

    const tryJson = async (): Promise<TResponse | undefined> => {
      try {
        const jsonAttempt = await fetchWithTimeout(url, this.timeoutMs_, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
        })

        const jsonText = await jsonAttempt.text()
        const jsonParsed = safeJsonParse(jsonText)
        if (jsonAttempt.ok && jsonParsed.ok) {
          // If EasyParcel's endpoint didn't parse JSON POST bodies properly,
          // it often responds with errors about "bulk" format. In that case,
          // fall back to form-encoding.
          const v: any = jsonParsed.value
          const apiStatus = String(v?.api_status || "").toLowerCase()
          const remark = String(v?.error_remark || v?.error_message || "")

          const hasBulk = Object.prototype.hasOwnProperty.call(payload, "bulk")
          const looksLikeBulkParseError =
            hasBulk && /bulk/i.test(remark || "") && apiStatus && apiStatus !== "success"

          if (looksLikeBulkParseError) {
            lastError = new Error(`EasyParcel JSON body not accepted: ${remark || jsonText}`)
            return undefined
          }

          return jsonParsed.value as TResponse
        }

        // If JSON returned a non-ok response, allow the form fallback to try.
        lastError = new Error(
          `EasyParcel JSON request failed (${jsonAttempt.status} ${jsonAttempt.statusText}): ${jsonText}`
        )
        return undefined
      } catch (e) {
        lastError = e
        return undefined
      }
    }

    const tryForm = async (): Promise<TResponse> => {
      const form = new URLSearchParams()
      // EasyParcel's PHP backend expects nested params for bulk requests, e.g.
      // bulk[0][pick_postcode]=...&exclude_fields[0]=...
      appendFormValue(form, "api", this.apiKey_)
      for (const [k, v] of Object.entries(payload)) {
        if (v === undefined) continue
        appendFormValue(form, k, v as any)
      }

      const formAttempt = await fetchWithTimeout(url, this.timeoutMs_, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: form.toString(),
      })

      const formText = await formAttempt.text()
      const formParsed = safeJsonParse(formText)
      if (!formAttempt.ok) {
        throw new Error(
          `EasyParcel request failed (${formAttempt.status} ${formAttempt.statusText}): ${
            (formParsed.ok && JSON.stringify(formParsed.value)) || formText
          }`
        )
      }
      if (!formParsed.ok) {
        throw new Error(`EasyParcel response was not JSON: ${formText}`)
      }

      return formParsed.value as TResponse
    }

    const hasBulk = Object.prototype.hasOwnProperty.call(payload, "bulk")

    // EasyParcel bulk endpoints are the most finicky about request encoding.
    // For these, skip JSON entirely and go straight to PHP-style form encoding.
    if (hasBulk) {
      return await tryForm()
    }

    const jsonOk = await tryJson()
    if (jsonOk !== undefined) {
      return jsonOk
    }

    try {
      return await tryForm()
    } catch (e) {
      // Prefer the "real" form error if it exists, otherwise surface the JSON error.
      throw e ?? lastError ?? new Error("EasyParcel request failed")
    }
  }
}

function safeJsonParse(input: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(input) }
  } catch {
    return { ok: false }
  }
}

function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init: Omit<RequestInit, "signal">
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  return fetch(url, {
    ...init,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout))
}

function appendFormValue(form: URLSearchParams, key: string, value: any) {
  if (value === undefined) {
    return
  }

  if (value === null) {
    form.append(key, "")
    return
  }

  if (Array.isArray(value)) {
    value.forEach((v, idx) => appendFormValue(form, `${key}[${idx}]`, v))
    return
  }

  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      appendFormValue(form, `${key}[${k}]`, v)
    }
    return
  }

  form.append(key, String(value))
}


