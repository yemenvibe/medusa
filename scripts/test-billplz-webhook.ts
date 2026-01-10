/**
 * Test script to simulate Billplz webhook callback
 * 
 * Usage:
 *   npx tsx scripts/test-billplz-webhook.ts
 * 
 * Or with specific parameters:
 *   npx tsx scripts/test-billplz-webhook.ts --session-id=payses_01KE2QBT9HYSQKBPNA712RDX2H --cart-id=cart_01KE2Q5KF2N1T9A7EJN6Q24Z89 --bill-id=test_bill_123
 */

import crypto from "crypto"

// Extract command line arguments
const args = process.argv.slice(2)
const getArg = (name: string, defaultValue?: string): string | undefined => {
  const arg = args.find((a) => a.startsWith(`--${name}=`))
  return arg ? arg.split("=")[1] : defaultValue
}

// Default values based on your logs
const sessionId = getArg("session-id", "payses_01KE2QBT9HYSQKBPNA712RDX2H")
const cartId = getArg("cart-id", "cart_01KE2Q5KF2N1T9A7EJN6Q24Z89")
const billId = getArg("bill-id", `test_bill_${Date.now()}`)
const paid = getArg("paid", "true") === "true"
const amount = parseInt(getArg("amount", "2350") || "2350")
const email = getArg("email", "ammar@rentsooq.com")

// Billplz webhook payload structure
const webhookPayload: Record<string, unknown> = {
  id: billId,
  collection_id: "riq0mt8s", // From your logs
  paid: paid,
  state: paid ? "paid" : "due",
  amount: amount,
  paid_amount: paid ? amount : 0,
  due_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
  email: email,
  mobile: "+60123456789",
  name: "Test Customer",
  url: `https://www.billplz.com/bills/${billId}`,
  reference_1: sessionId, // Payment session ID stored here
  reference_1_label: "Payment Session ID",
  reference_2: cartId, // Cart ID stored here
  reference_2_label: "Cart ID",
  redirect_url: "http://localhost:8000/order/confirmed",
  callback_url: "http://localhost:9000/hooks/billplz",
  description: "Test payment",
  paid_at: paid ? new Date().toISOString() : null,
}

// Generate X-Signature if BILLPLZ_X_SIGNATURE_KEY is set
const xSignatureKey = process.env.BILLPLZ_X_SIGNATURE_KEY
if (xSignatureKey) {
  const signature = generateBillplzSignature(webhookPayload, xSignatureKey)
  webhookPayload.x_signature = signature
  console.log("Generated X-Signature:", signature.substring(0, 20) + "...")
} else {
  console.warn("BILLPLZ_X_SIGNATURE_KEY not set, skipping signature generation")
}

// Function to generate Billplz signature (same as in route.ts)
function generateBillplzSignature(
  data: Record<string, unknown>,
  xSignatureKey: string
): string {
  const entries: string[] = []

  for (const [rawKey, rawValue] of Object.entries(data || {})) {
    if (!rawKey) continue

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

    normalizedValue = normalizedValue.trim()
    entries.push(`${normalizedKey}${normalizedValue}`)
  }

  entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  const stringToSign = entries.join("|")

  return crypto.createHmac("sha256", xSignatureKey).update(stringToSign).digest("hex")
}

// Send webhook to local server
async function testWebhook() {
  const webhookUrl = process.env.MEDUSA_BACKEND_URL 
    ? `${process.env.MEDUSA_BACKEND_URL}/hooks/billplz`
    : "http://localhost:9000/hooks/billplz"

  console.log("\n=== Billplz Webhook Test ===")
  console.log("Webhook URL:", webhookUrl)
  console.log("\nPayload:")
  console.log(JSON.stringify(webhookPayload, null, 2))
  console.log("\nSending webhook...\n")

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(
        Object.entries(webhookPayload).reduce((acc, [key, value]) => {
          acc[key] = value === null || value === undefined ? "" : String(value)
          return acc
        }, {} as Record<string, string>)
      ),
    })

    const responseText = await response.text()
    let responseData: any
    try {
      responseData = JSON.parse(responseText)
    } catch {
      responseData = responseText
    }

    console.log("Response Status:", response.status)
    console.log("Response Body:", JSON.stringify(responseData, null, 2))

    if (response.ok) {
      console.log("\n✅ Webhook test successful!")
    } else {
      console.log("\n❌ Webhook test failed!")
    }
  } catch (error) {
    console.error("\n❌ Error sending webhook:", error)
    if (error instanceof Error) {
      console.error("Error message:", error.message)
    }
  }
}

// Run the test
testWebhook()

