# Testing Billplz Webhook

This script simulates a Billplz webhook callback to test your webhook handler.

## Usage

### Basic Test (with default values from logs)

```bash
# Using tsx (if installed)
npx tsx scripts/test-billplz-webhook.ts

# Or using ts-node (if installed)
npx ts-node scripts/test-billplz-webhook.ts

# Or compile and run
npm run build
node dist/scripts/test-billplz-webhook.js
```

### Custom Parameters

```bash
npx tsx scripts/test-billplz-webhook.ts \
  --session-id=payses_01KE2QBT9HYSQKBPNA712RDX2H \
  --cart-id=cart_01KE2Q5KF2N1T9A7EJN6Q24Z89 \
  --bill-id=test_bill_123 \
  --paid=true \
  --amount=2350 \
  --email=ammar@rentsooq.com
```

## Parameters

- `--session-id`: Payment session ID (stored in reference_1)
- `--cart-id`: Cart ID (stored in reference_2)
- `--bill-id`: Billplz bill ID
- `--paid`: Whether payment is paid (true/false)
- `--amount`: Payment amount in smallest currency unit (e.g., 2350 = 23.50)
- `--email`: Customer email

## Environment Variables

Make sure these are set in your `.env` file:

- `MEDUSA_BACKEND_URL`: Your Medusa backend URL (default: http://localhost:9000)
- `BILLPLZ_X_SIGNATURE_KEY`: Optional, for signature verification

## What the Script Does

1. Creates a webhook payload matching Billplz's format
2. Generates X-Signature if `BILLPLZ_X_SIGNATURE_KEY` is set
3. Sends POST request to `/hooks/billplz` endpoint
4. Displays the response

## Expected Behavior

When `paid=true`:
- Payment session should be marked as authorized
- Cart should be completed
- Order should be created

Check your Medusa logs for detailed processing information.

