# EasyParcel Fulfillment Provider for Medusa

This module provides EasyParcel (Malaysia) integration as a fulfillment provider for Medusa v2.

## Configuration

### 1. Environment Variables

Add the following to your `backend.env` file (or your environment):

#### Required:
```bash
EASYPARCEL_API_KEY=your_api_key_here
```

#### Optional:
```bash
# Base URL (defaults to live if not set)
EASYPARCEL_BASE_URL=https://connect.easyparcel.my/  # Live
# OR
EASYPARCEL_BASE_URL=http://demo.connect.easyparcel.my/  # Demo

# Or use the demo flag (convenience)
EASYPARCEL_DEMO=false  # Set to true for demo mode

# Sender defaults (used for rate checking if not available from stock location)
EASYPARCEL_SENDER_POSTCODE=50000
EASYPARCEL_SENDER_STATE=kul  # MY state code (kul=Kuala Lumpur, jhr=Johor, etc.)
EASYPARCEL_SENDER_COUNTRY=MY

# Default weight in kg if cart/item weights are missing
EASYPARCEL_DEFAULT_WEIGHT_KG=1
```

### 2. Malaysia State Codes

EasyParcel uses short state codes. Common ones:
- `kul` - Kuala Lumpur
- `jhr` - Johor
- `kdh` - Kedah
- `ktn` - Kelantan
- `mlk` - Melaka
- `nsn` - Negeri Sembilan
- `phg` - Pahang
- `prk` - Perak
- `pls` - Perlis
- `png` - Pulau Pinang
- `sgr` - Selangor
- `trg` - Terengganu
- `pjy` - Putrajaya
- `srw` - Sarawak
- `sbh` - Sabah
- `lbn` - Labuan

### 3. Restart Medusa

After setting environment variables, restart your Medusa backend:

```bash
yarn dev
# or
yarn start
```

## Using EasyParcel in Medusa Admin

### Step 1: Add Fulfillment Provider to Stock Location

1. Go to **Settings** → **Locations & Shipping**
2. Select or create a **Stock Location**
3. In the **Fulfillment Providers** section, add:
   - Provider: `easyparcel_easyparcel` (should appear if configured correctly)
   - Click **Add Provider**

### Step 2: Create Shipping Options

1. Still in **Settings** → **Locations & Shipping**
2. Go to **Shipping Options**
3. Create a new shipping option:
   - **Name**: e.g., "EasyParcel Standard"
   - **Fulfillment Provider**: Select `easyparcel_easyparcel`
   - **Fulfillment Option**: Select from available EasyParcel services (e.g., "EP-BOX", "EP-PACKET")
   - **Service Zone**: Select the appropriate service zone
   - **Shipping Profile**: Select a shipping profile
   - **Price Type**: `calculated` (recommended) or `flat`
   - **Prices**: If using flat pricing, set prices per currency/region

### Step 3: Link to Region

1. Go to **Settings** → **Regions**
2. Edit your region (e.g., Malaysia region)
3. Ensure the shipping option is available in that region

## How It Works

### Rate Checking (`calculatePrice`)

When a customer adds items to cart and proceeds to checkout:
1. Medusa calls `calculatePrice` with cart details
2. The provider extracts:
   - Destination address (from shipping address)
   - Origin address (from stock location or `EASYPARCEL_SENDER_*` env vars)
   - Weight (from cart items or `EASYPARCEL_DEFAULT_WEIGHT_KG`)
3. Calls EasyParcel `EP-RateCheckingBulk` API
4. Returns the calculated shipping price

### Creating Fulfillment (`createFulfillment`)

When an order is fulfilled:
1. Medusa calls `createFulfillment` with order details
2. The provider:
   - Creates order via EasyParcel `EPSubmitOrderBulk` API
   - Returns tracking number and order details
3. Order status is updated in Medusa

### Order Payment (`createFulfillment` - payment step)

After creating the order:
1. Provider calls EasyParcel `EP-MakingOrderPayment` API
2. Payment is processed
3. Order is confirmed with EasyParcel

## API Reference

Based on EasyParcel Malaysia Individual API v1.4.0.0:
- Rate Checking: `EP-RateCheckingBulk`
- Submit Order: `EPSubmitOrderBulk`
- Make Payment: `EP-MakingOrderPayment`
- Track Order: `EP-TrackOrderBulk`

## Troubleshooting

### Provider not showing in Admin

1. Check `EASYPARCEL_API_KEY` is set in environment
2. Restart Medusa backend
3. Check logs for initialization errors

### Rate checking fails

1. Verify sender address (postcode, state) is correct
2. Check destination address format
3. Ensure weight is provided (check `EASYPARCEL_DEFAULT_WEIGHT_KG`)
4. Check EasyParcel API logs

### Order creation fails

1. Verify API key is valid and has permissions
2. Check order data format
3. Ensure payment method is configured
4. Review EasyParcel API response for errors

## Testing

To test the provider:

1. Set up a test stock location with EasyParcel provider
2. Create a shipping option using EasyParcel
3. Add items to cart and proceed to checkout
4. Select the EasyParcel shipping option
5. Verify rate is calculated correctly
6. Complete order and check fulfillment creation

## Support

For EasyParcel API issues, refer to:
- EasyParcel API Documentation: `Malaysia_Individual_1.4.0.0.pdf`
- EasyParcel Support: https://easyparcel.com/my/en/contact-us

