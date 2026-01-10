# Resend Email Notification Setup Guide

This guide walks you through setting up email notifications in your Medusa store using Resend.

## 🎯 What You'll Get

Automatic email notifications for:
- ✅ Order confirmations
- 📦 Shipping notifications (with tracking)
- ❌ Order cancellations
- 👋 Welcome emails for new customers
- 🔐 Password reset emails

## 📋 Prerequisites

1. A Resend account (sign up at [resend.com](https://resend.com))
2. A verified domain in Resend
3. Resend API key

## 🚀 Quick Start

### Step 1: Get Your Resend API Key

1. Go to [https://resend.com/api-keys](https://resend.com/api-keys)
2. Click "Create API Key"
3. Copy the key (starts with `re_`)

### Step 2: Verify Your Domain

1. Go to [https://resend.com/domains](https://resend.com/domains)
2. Add your domain (e.g., `yourdomain.com`)
3. Add the required DNS records
4. Wait for verification (usually takes a few minutes)

### Step 3: Configure Environment Variables

Edit `medusa/backend.env` and add:

```bash
RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_FROM_EMAIL=orders@yourdomain.com
```

Optional - BCC all emails to admin:
```bash
RESEND_BCC_EMAILS=admin@yourdomain.com,backup@yourdomain.com
```

### Step 4: Install Dependencies

```bash
cd medusa
yarn add resend
```

### Step 5: Restart Medusa

```bash
yarn dev
# or
yarn start
```

## ✅ Verify Setup

Run the configuration checker:

```bash
powershell -ExecutionPolicy Bypass -File check-resend-config.ps1
```

You should see:
```
✅ Configuration looks good! Resend notification provider should be available after restarting Medusa.
```

## 📧 Email Templates

### Order Confirmation

**Triggered on**: New order placed  
**Includes**:
- Order number
- Items ordered with quantities and prices
- Total amount
- Shipping address

### Shipping Notification

**Triggered on**: Order fulfillment created  
**Includes**:
- Order number
- Tracking number
- Carrier name (if using EasyParcel)
- Estimated delivery

### Order Cancellation

**Triggered on**: Order canceled  
**Includes**:
- Order number
- Cancellation notice

### Welcome Email

**Triggered on**: New customer registration  
**Includes**:
- Welcome message
- Link to start shopping

### Password Reset

**Triggered on**: Password reset requested  
**Includes**:
- Reset link (expires in 1 hour)
- Security notice

## 🧪 Testing

### Test Order Confirmation

1. Go to Medusa Admin
2. Create a test order
3. Check your Resend dashboard at [resend.com/emails](https://resend.com/emails)
4. Verify email was sent

### Test Shipping Notification

1. Open an existing order in Admin
2. Create a fulfillment
3. Check Resend dashboard for the shipped email

### Test Welcome Email

1. Create a new customer account
2. Check Resend dashboard for the welcome email

## 📊 Monitoring

View sent emails in your Resend dashboard:
- [resend.com/emails](https://resend.com/emails)

Track:
- Delivery status
- Open rates
- Click rates
- Bounce rates

## 🎨 Customizing Email Templates

To customize email templates, edit:

```
medusa/src/modules/resend-notification/service.ts
```

Find the template methods:
- `generateOrderConfirmationEmail()` - Order confirmations
- `generateOrderShippedEmail()` - Shipping notifications
- `generateOrderCanceledEmail()` - Cancellation emails
- `generateWelcomeEmail()` - Welcome emails
- `generatePasswordResetEmail()` - Password reset

Example customization:

```typescript
private generateOrderConfirmationEmail(data: Record<string, any>): string {
  const order = data.order || {}
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        /* Your custom styles */
      </style>
    </head>
    <body>
      <!-- Your custom HTML -->
    </body>
    </html>
  `
}
```

## 🔧 Advanced Configuration

### Adding New Event Subscribers

Create a new subscriber file in `medusa/src/subscribers/`:

```typescript
// my-custom-notification.ts
import { type SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"

export default async function myCustomNotificationHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const notificationModuleService = container.resolve("notification")

  await notificationModuleService.createNotifications({
    to: "customer@email.com",
    channel: "email",
    template: "my-custom-template",
    data: {
      // Your custom data
    },
  })
}

export const config: SubscriberConfig = {
  event: "your.event.name",
}
```

### Using Resend Templates

If you create templates in Resend dashboard:

```typescript
return {
  from: fromEmail,
  to,
  subject: "Your Subject",
  react: YourReactTemplate({ /* props */ }),
}
```

## 🐛 Troubleshooting

### Emails not sending

**Check 1**: Verify API key is set
```bash
echo $env:RESEND_API_KEY
```

**Check 2**: Verify domain is verified
- Go to [resend.com/domains](https://resend.com/domains)
- Status should be "Verified" (green)

**Check 3**: Check Medusa logs
```bash
yarn dev
```
Look for errors mentioning "Resend" or "notification"

**Check 4**: Check Resend dashboard
- Go to [resend.com/emails](https://resend.com/emails)
- Check for failed sends

### Wrong "from" address

Make sure `RESEND_FROM_EMAIL` matches your verified domain:

✅ Correct:
- `orders@yourdomain.com` (if yourdomain.com is verified)
- `support@yourdomain.com` (if yourdomain.com is verified)

❌ Incorrect:
- `orders@gmail.com` (Gmail domain not verified)
- `test@unverified.com` (Domain not verified)

### Emails going to spam

1. Add SPF, DKIM, and DMARC records (Resend provides these)
2. Use a verified domain
3. Avoid spammy content in emails
4. Include unsubscribe links for marketing emails

### Rate limits

Resend free tier limits:
- 100 emails/day
- 3,000 emails/month

Upgrade at [resend.com/pricing](https://resend.com/pricing) for higher limits.

## 📚 Resources

- [Resend Documentation](https://resend.com/docs)
- [Medusa Notification Docs](https://docs.medusajs.com/learn/fundamentals/modules/notification)
- [Resend React Email](https://react.email)
- [Email Testing Tools](https://www.mail-tester.com)

## 🆘 Support

If you encounter issues:

1. Check Medusa logs for errors
2. Check Resend dashboard for delivery status
3. Run the config checker script
4. Review this guide again
5. Contact Resend support: [resend.com/support](https://resend.com/support)

## 🎉 Success Checklist

- [ ] Resend account created
- [ ] Domain verified
- [ ] API key obtained
- [ ] Environment variables configured
- [ ] Resend SDK installed (`yarn add resend`)
- [ ] Medusa restarted
- [ ] Config checker passed
- [ ] Test order email sent successfully
- [ ] Emails appearing in Resend dashboard

Once all items are checked, your email notification system is live! 🚀

