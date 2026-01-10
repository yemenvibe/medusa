import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"

import { EasyParcelClient } from "../../../../modules/easyparcel-fulfillment/client"
import { resolveMalaysiaStateCode } from "../../../../modules/easyparcel-fulfillment/states"
import type { EasyParcelRate } from "../../../../modules/easyparcel-fulfillment/types"

const BodySchema = z.object({
  receiver_postcode: z.string().min(4),
  receiver_state: z.string().min(1),
  receiver_country: z.string().optional().default("MY"),
  service_id: z.string().optional(),
  selection: z.enum(["cheapest", "fastest"]).optional().default("cheapest"),
  weight_kg: z.coerce.number().positive().optional().default(1),
  width: z.coerce.number().positive().optional(),
  height: z.coerce.number().positive().optional(),
  length: z.coerce.number().positive().optional(),
  date_coll: z.string().optional(),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    })
  }

  const body = parsed.data

  const apiKey = String(process.env.EASYPARCEL_API_KEY || "").trim()
  if (!apiKey) {
    return res.status(500).json({ error: "Missing EASYPARCEL_API_KEY" })
  }

  const baseUrl =
    String(process.env.EASYPARCEL_BASE_URL || "").trim() ||
    (process.env.EASYPARCEL_DEMO === "true"
      ? "http://demo.connect.easyparcel.my/"
      : "https://connect.easyparcel.my/")

  const timeoutMs = process.env.EASYPARCEL_TIMEOUT_MS
    ? Number(process.env.EASYPARCEL_TIMEOUT_MS)
    : undefined

  const senderPostcode = String(process.env.EASYPARCEL_SENDER_POSTCODE || "").trim()
  const senderStateRaw = String(process.env.EASYPARCEL_SENDER_STATE || "").trim()
  const senderCountry = String(process.env.EASYPARCEL_SENDER_COUNTRY || "MY").trim().toUpperCase()

  if (!senderPostcode) {
    return res.status(500).json({ error: "Missing EASYPARCEL_SENDER_POSTCODE" })
  }
  if (!senderStateRaw) {
    return res.status(500).json({ error: "Missing EASYPARCEL_SENDER_STATE" })
  }

  const pick_state = resolveMalaysiaStateCode(senderStateRaw)
  if (!pick_state) {
    return res.status(400).json({ error: `Invalid sender state: ${senderStateRaw}` })
  }

  const send_state = resolveMalaysiaStateCode(body.receiver_state)
  if (!send_state) {
    return res.status(400).json({ error: `Invalid receiver state: ${body.receiver_state}` })
  }

  const receiverCountry = String(body.receiver_country || "MY").trim().toUpperCase()
  if (receiverCountry !== "MY") {
    return res.status(400).json({ error: `Only MY supported. Got: ${receiverCountry}` })
  }

  const client = new EasyParcelClient({
    apiKey,
    baseUrl,
    timeoutMs: typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : undefined,
  })

  let resp: unknown
  try {
    resp = await client.rateCheckingBulk({
      bulk: [
        {
          pick_code: senderPostcode,
          pick_state,
          pick_country: senderCountry,
          send_code: body.receiver_postcode,
          send_state,
          send_country: receiverCountry,
          weight: body.weight_kg,
          ...(typeof body.width === "number" ? { width: body.width } : {}),
          ...(typeof body.height === "number" ? { height: body.height } : {}),
          ...(typeof body.length === "number" ? { length: body.length } : {}),
          ...(typeof body.date_coll === "string" ? { date_coll: body.date_coll } : {}),
        },
      ],
      exclude_fields: ["pgeon_point", "rates.*.dropoff_point", "rates.*.pickup_point"],
    })
  } catch (e) {
    // If EasyParcel is unreachable, times out, or returns a non-JSON response,
    // the client may throw. Surface a useful error for checkout debugging.
    const message = e instanceof Error ? e.message : String(e)
    // eslint-disable-next-line no-console
    console.error("EasyParcel rateCheckingBulk failed", {
      message,
      senderPostcode,
      pick_state,
      senderCountry,
      receiver_postcode: body.receiver_postcode,
      receiver_state: body.receiver_state,
      send_state,
      receiverCountry,
    })

    return res.status(502).json({
      error: "Failed to fetch rates from EasyParcel",
      message,
    })
  }

  const apiStatus = String((resp as any)?.api_status || "").toLowerCase()
  if (apiStatus && apiStatus !== "success" && apiStatus !== "ok") {
    return res.status(400).json({
      error: (resp as any)?.error_remark || (resp as any)?.error_message || "EasyParcel rate error",
      response: resp,
    })
  }

  const rates: EasyParcelRate[] = (resp as any)?.result?.[0]?.rates || []
  if (!Array.isArray(rates) || !rates.length) {
    return res.status(400).json({
      error: "No rates returned",
      hint:
        "Common causes: sender postcode/state mismatch (check EASYPARCEL_SENDER_POSTCODE + EASYPARCEL_SENDER_STATE), invalid receiver_state, unsupported receiver_country, or parcel details (weight/dimensions).",
      response: resp,
    })
  }

  let selected: EasyParcelRate | undefined

  if (body.service_id) {
    selected = rates.find((r) => String((r as any)?.service_id || "") === String(body.service_id))
    if (!selected) {
      return res.status(400).json({
        error: `Requested service_id not available for this address: ${body.service_id}`,
        available_service_ids: rates.map((r) => (r as any)?.service_id).filter(Boolean),
      })
    }
  } else {
    selected =
      body.selection === "fastest"
        ? [...rates].sort((a, b) => extractMinDays(a?.delivery) - extractMinDays(b?.delivery))[0]
        : [...rates].sort((a, b) => toNumber(a?.price) - toNumber(b?.price))[0]
  }

  return res.json({
    selection: body.selection,
    rate: selected,
  })
}

function toNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim())
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY
}

function extractMinDays(delivery: unknown): number {
  if (typeof delivery !== "string") return Number.POSITIVE_INFINITY
  const nums = delivery
    .match(/\d+/g)
    ?.map((x) => Number(x))
    .filter((n) => Number.isFinite(n))
  if (!nums?.length) return Number.POSITIVE_INFINITY
  return Math.min(...nums)
}


