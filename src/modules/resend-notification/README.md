# Resend Notification Provider for Medusa

This module provides Resend email integration as a notification provider for Medusa v2.

## Features

- Send transactional emails via Resend API
- Pre-built email templates for common events:
  - Order confirmation
  - Order shipped
  - Order canceled
  - Welcome email
  - Password reset
- Customizable email templates
- HTML email support
- Attachments support
- BCC support for all emails

## Configuration

### 1. Install Resend SDK

```bash
yarn add resend
```

### 2. Environment Variables

Add the following to your `backend.env` file:

#### Required:
```bash
RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_FROM_EMAIL=orders@yourdomain.com
```

#### Optional:
```bash
# BCC addresses for all emails (comma-separated)
RESEND_BCC_EMAILS=admin@yourdomain.com,backup@yourdomain.com
```

### 3. Get Resend API Key

1. Sign up at [https://resend.com](https://resend.com)
2. Go to API Keys section
3. Create a new API key
4. Verify your domain

### 4. Configure in medusa-config.ts

The module is automatically configured when `RESEND_API_KEY` is set.

### 5. Restart Medusa

```bash
yarn dev
# or
yarn start
```

## Email Templates

### Order Placed

Triggered when a new order is placed.

**Event**: `order.placed` or `order-confirmation`

**Data required**:
- `order` - Order object with items, shipping address, total

### Order Shipped

Triggered when an order is fulfilled/shipped.

**Event**: `order.shipment_created` or `order-shipped`

**Data required**:
- `order` - Order object
- `fulfillment` - Fulfillment object with tracking number

### Order Canceled

Triggered when an order is canceled.

**Event**: `order.canceled`

**Data required**:
- `order` - Order object

### Welcome Email

Triggered when a customer creates an account.

**Event**: `customer.created` or `customer-created`

**Data required**:
- `customer` - Customer object
- `store_url` - Link to store

### Password Reset

Triggered when a customer requests password reset.

**Event**: `user.password_reset` or `password-reset`

**Data required**:
- `reset_url` - Password reset link

## Subscribers

To send emails automatically, create subscribers for Medusa events:

```typescript
// src/subscribers/order-placed.ts
import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const notificationModuleService = container.resolve("notification")
  const orderModuleService = container.resolve("order")

  const order = await orderModuleService.retrieveOrder(data.id, {
    relations: ["items", "shipping_address"],
  })

  await notificationModuleService.createNotifications({
    to: order.email,
    channel: "email",
    template: "order.placed",
    data: {
      order,
    },
  })
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
```

## Custom Templates

You can customize email templates by modifying the `buildEmail` method in `service.ts`:

```typescript
private buildEmail(to: string, template: string, data: Record<string, any>, from?: string): any {
  switch (template) {
    case "custom-template":
      return {
        from: from || this.options_.from,
        to,
        subject: "Custom Subject",
        html: this.generateCustomEmail(data),
      }
    // ... other templates
  }
}
```

## Testing

To test the provider:

1. Create a test order in Medusa Admin
2. Check Resend dashboard for sent emails
3. Verify email delivery

## Troubleshooting

### Provider not showing

1. Check `RESEND_API_KEY` is set in environment
2. Run `yarn add resend` to install the SDK
3. Restart Medusa backend
4. Check logs for initialization errors

### Emails not sending

1. Verify API key is valid
2. Check domain is verified in Resend dashboard
3. Review Medusa logs for errors
4. Check Resend dashboard for failed sends

### Wrong "from" address

1. Verify `RESEND_FROM_EMAIL` matches a verified domain
2. Ensure email format is correct (e.g., `orders@domain.com`)
3. Check Resend domain verification status

## Support

For Resend API issues, refer to:
- Resend Documentation: https://resend.com/docs
- Resend Support: https://resend.com/support
- Medusa Notification Docs: https://docs.medusajs.com/learn/fundamentals/modules/notification

## Example Email Preview

The emails are HTML-formatted with:
- Responsive design
- Professional styling
- Order details
- Shipping information
- Tracking links (for shipped orders)
- Call-to-action buttons

All emails include your store branding and footer with copyright information.

