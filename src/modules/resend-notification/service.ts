import { AbstractNotificationProviderService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import { Resend } from "resend"
import type {
  ResendNotificationProviderOptions,
  ResendEmailData,
  ResendEmailResponse,
} from "./types"

type InjectedDependencies = {
  logger?: Logger
}

class ResendNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "resend"

  protected logger_?: Logger
  protected options_: ResendNotificationProviderOptions
  protected resend_: Resend

  /**
   * Brand/theme settings for emails.
   * - STORE_NAME: displayed in subjects/footers
   * - STORE_LOGO_URL: absolute URL to a logo image (recommended). If unset, logo is omitted.
   *
   * Colors: use a gold primary to match AlSultan branding.
   */
  private getBrand(data?: Record<string, any>) {
    const storeName = process.env.STORE_NAME?.trim() || "AlSultan Store"
    const logoUrl = process.env.STORE_LOGO_URL?.trim() || ""
    const storeUrl =
      (data?.store_url as string | undefined) ||
      process.env.STORE_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      "http://localhost:8000"

    // Brand palette (black header + white body, gold accents)
    const primary = process.env.STORE_PRIMARY_COLOR?.trim() || "#D4AF37" // gold
    const primaryDark = process.env.STORE_PRIMARY_DARK_COLOR?.trim() || "#B88917"
    const bg = process.env.STORE_BG_COLOR?.trim() || "#f3f4f6"
    const surface = process.env.STORE_SURFACE_COLOR?.trim() || "#ffffff"
    const card = process.env.STORE_CARD_COLOR?.trim() || "#ffffff"
    const text = process.env.STORE_TEXT_COLOR?.trim() || "#111827"
    const muted = process.env.STORE_MUTED_COLOR?.trim() || "#6b7280"
    const border = process.env.STORE_BORDER_COLOR?.trim() || "#e5e7eb"
    const soft = process.env.STORE_SOFT_COLOR?.trim() || "rgba(212,175,55,0.10)"

    const headerBg = process.env.STORE_HEADER_BG_COLOR?.trim() || "#0b0b0c"
    const headerText = process.env.STORE_HEADER_TEXT_COLOR?.trim() || primary
    const headerBorder =
      process.env.STORE_HEADER_BORDER_COLOR?.trim() || "rgba(212,175,55,0.55)"

    return {
      storeName,
      logoUrl,
      storeUrl,
      colors: {
        primary,
        primaryDark,
        surface,
        card,
        bg,
        text,
        muted,
        border,
        soft,
        headerBg,
        headerText,
        headerBorder,
      },
    }
  }

  private renderHeader(brand: ReturnType<ResendNotificationProviderService["getBrand"]>) {
    return `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
        <tr>
          <td style="background:${brand.colors.headerBg}; border: 1px solid ${brand.colors.headerBorder}; border-radius: 14px; overflow: hidden;">
            <div style="padding: 22px 20px; text-align:center;">
              ${
                brand.logoUrl
                  ? `<img src="${brand.logoUrl}" alt="${brand.storeName}" style="max-width: 200px; width: 100%; height: auto; display:block; margin:0 auto 10px;" />`
                  : `<div style="font-size:22px; font-weight:800; letter-spacing:0.5px; color:${brand.colors.headerText}; margin-bottom:6px;">${brand.storeName}</div>`
              }
              <div style="height: 2px; width: 88px; background:${brand.colors.primary}; margin: 10px auto 0;"></div>
            </div>
          </td>
        </tr>
      </table>
    `
  }

  constructor(
    { logger }: InjectedDependencies,
    options: ResendNotificationProviderOptions
  ) {
    super()

    if (!options?.api_key?.trim()) {
      throw new Error(
        "Resend notification provider requires `api_key`. Please set RESEND_API_KEY."
      )
    }

    if (!options?.from?.trim()) {
      throw new Error(
        "Resend notification provider requires `from` email address. Please set RESEND_FROM_EMAIL."
      )
    }

    this.logger_ = logger
    this.options_ = {
      ...options,
      api_key: options.api_key.trim(),
      from: options.from.trim(),
    }

    this.resend_ = new Resend(this.options_.api_key)
  }

  async send(notification: {
    to: string
    channel: string
    template: string
    data: Record<string, any>
    from?: string
    attachments?: any[]
  }): Promise<{ id: string }> {
    const { to, template, data, from, attachments } = notification

    this.logger_?.info(
      `Sending email via Resend: ${JSON.stringify({
        to,
        template,
        from: from || this.options_.from,
      })}`
    )

    try {
      // Build email based on template
      const emailData = this.buildEmail(to, template, data, from, attachments)

      const response = await this.resend_.emails.send(emailData)

      if (!response.data) {
        throw new Error(`Resend API error: ${JSON.stringify(response.error)}`)
      }

      this.logger_?.info(
        `Email sent successfully via Resend: ${JSON.stringify({
          id: response.data.id,
          to,
          template,
        })}`
      )

      return {
        id: response.data.id,
      }
    } catch (error) {
      this.logger_?.error(
        `Failed to send email via Resend: ${JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          to,
          template,
        })}`
      )
      throw error
    }
  }

  private buildEmail(
    to: string,
    template: string,
    data: Record<string, any>,
    from?: string,
    attachments?: any[]
  ): any {
    const fromEmail = from || this.options_.from

    // Map templates to email content
    switch (template) {
      case "order.placed":
      case "order-confirmation":
        return {
          from: fromEmail,
          to,
          subject: `Order Confirmation #${data.order?.display_id || ""}`,
          html: this.generateOrderConfirmationEmail(data),
          bcc: this.options_.bcc,
        }

      case "order.shipment_created":
      case "order-shipped":
        return {
          from: fromEmail,
          to,
          subject: `Your Order #${data.order?.display_id || ""} Has Shipped`,
          html: this.generateOrderShippedEmail(data),
          bcc: this.options_.bcc,
        }

      case "order.canceled":
        return {
          from: fromEmail,
          to,
          subject: `Order #${data.order?.display_id || ""} Canceled`,
          html: this.generateOrderCanceledEmail(data),
          bcc: this.options_.bcc,
        }

      case "customer.created":
      case "customer-created":
        return {
          from: fromEmail,
          to,
          subject: "Welcome to Our Store!",
          html: this.generateWelcomeEmail(data),
          bcc: this.options_.bcc,
        }

      case "user.password_reset":
      case "password-reset":
        return {
          from: fromEmail,
          to,
          subject: "Password Reset Request",
          html: this.generatePasswordResetEmail(data),
        }

      default:
        // Generic template
        return {
          from: fromEmail,
          to,
          subject: data.subject || "Notification",
          html: data.html || this.generateGenericEmail(data),
          text: data.text,
          bcc: this.options_.bcc,
          attachments,
        }
    }
  }

  private generateOrderConfirmationEmail(data: Record<string, any>): string {
    const brand = this.getBrand(data)
    const order = data.order || {}
    const items = order.items || []
    const total = this.formatCurrency(order.total, order.currency_code)

    const shipping = order.shipping_address || {}
    const shippingName =
      `${shipping.first_name || ""} ${shipping.last_name || ""}`.trim() || "—"
    const shippingLine1 = shipping.address_1 || "—"
    const shippingLine2 = shipping.address_2 || ""
    const shippingCity = [shipping.city, shipping.province, shipping.postal_code]
      .filter(Boolean)
      .join(", ")
    const shippingCountry = shipping.country_code || ""

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Order Confirmation</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: ${brand.colors.text}; background: ${brand.colors.bg}; margin:0; padding:0; }
          .container { max-width: 640px; margin: 0 auto; padding: 26px 16px; }
          .content { background: ${brand.colors.surface}; border: 1px solid ${brand.colors.border}; border-radius: 14px; padding: 18px 18px 8px; }
          .card { background: ${brand.colors.card}; border: 1px solid ${brand.colors.border}; border-radius: 12px; padding: 14px; margin: 14px 0; }
          .title { margin: 10px 0 0; font-size: 20px; }
          .muted { color: ${brand.colors.muted}; }
          .item { padding: 10px 0; border-bottom: 1px solid ${brand.colors.border}; }
          .item:last-child { border-bottom: 0; }
          .total { font-size: 18px; font-weight: 800; margin-top: 12px; padding-top: 12px; border-top: 2px solid ${brand.colors.primary}; }
          .footer { text-align: center; padding: 18px 10px; color: ${brand.colors.muted}; font-size: 12px; }
          a { color: ${brand.colors.primary}; }
        </style>
      </head>
      <body>
        <div class="container">
          ${this.renderHeader(brand)}

          <div style="height: 14px;"></div>

          <div class="content">
            <div style="padding: 4px 2px 14px;">
              <div class="muted" style="font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase;">Order Confirmation</div>
              <h2 class="title">Order #${order.display_id || ""}</h2>
              <div class="muted">Thank you for your order!</div>
            </div>

            <div class="card">
              <div style="font-weight: 800; margin-bottom: 10px;">Order Details</div>
              ${
                items.length
                  ? items
                      .map(
                        (item: any) => `
                  <div class="item">
                    <div style="font-weight:700;">${item.title || "Item"}</div>
                    <div class="muted" style="font-size: 13px;">
                      Qty: ${item.quantity || 1} × ${this.formatCurrency(item.unit_price, order.currency_code)}
                    </div>
                  </div>
                `
                      )
                      .join("")
                  : `<div class="muted">Items will appear here once available.</div>`
              }

              <div class="total">Total: ${total}</div>
            </div>

            <div class="card">
              <div style="font-weight: 800; margin-bottom: 10px;">Shipping Address</div>
              <div>${shippingName}</div>
              <div class="muted">${shippingLine1}</div>
              ${shippingLine2 ? `<div class="muted">${shippingLine2}</div>` : ""}
              ${shippingCity ? `<div class="muted">${shippingCity}</div>` : ""}
              ${shippingCountry ? `<div class="muted">${shippingCountry}</div>` : ""}
            </div>
          </div>
          
          <div class="footer">
            <p>If you have any questions, please contact our support team.</p>
            <p>
              <a href="${brand.storeUrl}">${brand.storeName}</a> &middot;
              &copy; ${new Date().getFullYear()} ${brand.storeName}. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `
  }

  private generateOrderShippedEmail(data: Record<string, any>): string {
    const brand = this.getBrand(data)
    const order = data.order || {}
    const fulfillment = data.fulfillment || {}
    const trackingNumber = fulfillment.tracking_number || fulfillment.data?.easyparcel_tracking_no

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Order Shipped</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: ${brand.colors.text}; background: ${brand.colors.bg}; margin:0; padding:0; }
          .container { max-width: 640px; margin: 0 auto; padding: 26px 16px; }
          .content { background: ${brand.colors.surface}; border: 1px solid ${brand.colors.border}; border-radius: 14px; padding: 18px; }
          .card { background: ${brand.colors.card}; border: 1px solid ${brand.colors.border}; border-radius: 12px; padding: 14px; margin: 14px 0; }
          .muted { color: ${brand.colors.muted}; }
          .tracking-number { font-size: 22px; font-weight: 800; color: ${brand.colors.primary}; padding: 10px 14px; background: ${brand.colors.soft}; border: 1px solid ${brand.colors.border}; border-radius: 10px; display: inline-block; }
          .footer { text-align: center; padding: 18px 10px; color: ${brand.colors.muted}; font-size: 12px; }
          a { color: ${brand.colors.primary}; }
        </style>
      </head>
      <body>
        <div class="container">
          ${this.renderHeader(brand)}

          <div style="height: 14px;"></div>

          <div class="content">
            <div class="muted" style="font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase;">Shipment Update</div>
            <h2 style="margin: 10px 0 6px;">Your order has shipped</h2>
            <div class="muted">Order #${order.display_id || ""}</div>

            ${
              trackingNumber
                ? `
              <div class="card" style="text-align:center;">
                <div style="font-weight:800; margin-bottom: 8px;">Tracking Number</div>
                <div class="tracking-number">${trackingNumber}</div>
                ${
                  fulfillment.data?.easyparcel_courier_name
                    ? `<div class="muted" style="margin-top: 10px;">Carrier: ${fulfillment.data.easyparcel_courier_name}</div>`
                    : ""
                }
              </div>
              `
                : `
              <div class="card">
                <div style="font-weight:800; margin-bottom: 6px;">Tracking</div>
                <div class="muted">Tracking information will appear here once available.</div>
              </div>
              `
            }

            <div class="muted">You should receive your order within 3-5 business days.</div>
          </div>
          
          <div class="footer">
            <p>If you have any questions, please contact our support team.</p>
            <p>
              <a href="${brand.storeUrl}">${brand.storeName}</a> &middot;
              &copy; ${new Date().getFullYear()} ${brand.storeName}. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `
  }

  private generateOrderCanceledEmail(data: Record<string, any>): string {
    const brand = this.getBrand(data)
    const order = data.order || {}
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Order Canceled</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: ${brand.colors.text}; background: ${brand.colors.bg}; margin:0; padding:0; }
          .container { max-width: 640px; margin: 0 auto; padding: 26px 16px; }
          .content { background: ${brand.colors.surface}; border: 1px solid ${brand.colors.border}; border-radius: 14px; padding: 18px; }
          .muted { color: ${brand.colors.muted}; }
          .footer { text-align: center; padding: 18px 10px; color: ${brand.colors.muted}; font-size: 12px; }
          a { color: ${brand.colors.primary}; }
        </style>
      </head>
      <body>
        <div class="container">
          ${this.renderHeader(brand)}

          <div style="height: 14px;"></div>
          
          <div class="content">
            <div class="muted" style="font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase;">Order Update</div>
            <h2 style="margin: 10px 0 6px;">Order Canceled</h2>
            <div class="muted">Order #${order.display_id || ""}</div>
            <div style="height: 10px;"></div>
            <p>Your order has been canceled as requested.</p>
            <p class="muted">If you did not request this cancellation, please contact our support team immediately.</p>
          </div>
          
          <div class="footer">
            <p>If you have any questions, please contact our support team.</p>
            <p>
              <a href="${brand.storeUrl}">${brand.storeName}</a> &middot;
              &copy; ${new Date().getFullYear()} ${brand.storeName}. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `
  }

  private generateWelcomeEmail(data: Record<string, any>): string {
    const brand = this.getBrand(data)
    const customer = data.customer || {}
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Welcome</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: ${brand.colors.text}; background: ${brand.colors.bg}; margin:0; padding:0; }
          .container { max-width: 640px; margin: 0 auto; padding: 26px 16px; }
          .content { background: ${brand.colors.surface}; border: 1px solid ${brand.colors.border}; border-radius: 14px; padding: 18px; }
          .button { display: inline-block; padding: 12px 18px; background: ${brand.colors.primary}; color: #111827; text-decoration: none; border-radius: 10px; font-weight: 800; }
          .muted { color: ${brand.colors.muted}; }
          .footer { text-align: center; padding: 18px 10px; color: ${brand.colors.muted}; font-size: 12px; }
          a { color: ${brand.colors.primary}; }
        </style>
      </head>
      <body>
        <div class="container">
          ${this.renderHeader(brand)}

          <div style="height: 14px;"></div>
          
          <div class="content">
            <div class="muted" style="font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase;">Welcome</div>
            <h2 style="margin: 10px 0 6px;">Welcome to ${brand.storeName}!</h2>
            <p>Hi ${customer.first_name || "there"},</p>
            <p class="muted">Thanks for creating an account. We’re excited to have you.</p>
            <p style="text-align: center; margin-top: 30px;">
              <a href="${brand.storeUrl}" class="button">Start Shopping</a>
            </p>
          </div>
          
          <div class="footer">
            <p>If you have any questions, please contact our support team.</p>
            <p>
              <a href="${brand.storeUrl}">${brand.storeName}</a> &middot;
              &copy; ${new Date().getFullYear()} ${brand.storeName}. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `
  }

  private generatePasswordResetEmail(data: Record<string, any>): string {
    const brand = this.getBrand(data)
    const resetUrl = data.reset_url || data.url || ""
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Password Reset</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: ${brand.colors.text}; background: ${brand.colors.bg}; margin:0; padding:0; }
          .container { max-width: 640px; margin: 0 auto; padding: 26px 16px; }
          .content { background: ${brand.colors.surface}; border: 1px solid ${brand.colors.border}; border-radius: 14px; padding: 18px; }
          .button { display: inline-block; padding: 12px 18px; background: ${brand.colors.primary}; color: #111827; text-decoration: none; border-radius: 10px; font-weight: 800; }
          .muted { color: ${brand.colors.muted}; }
          .footer { text-align: center; padding: 18px 10px; color: ${brand.colors.muted}; font-size: 12px; }
          a { color: ${brand.colors.primary}; }
        </style>
      </head>
      <body>
        <div class="container">
          ${this.renderHeader(brand)}

          <div style="height: 14px;"></div>
          
          <div class="content">
            <div class="muted" style="font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase;">Security</div>
            <h2 style="margin: 10px 0 6px;">Password Reset</h2>
            <p>Hi there,</p>
            <p>We received a request to reset your password. Click the button below to set a new password:</p>
            <p style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" class="button">Reset Password</a>
            </p>
            <p class="muted">If you didn't request this, you can safely ignore this email.</p>
            <p class="muted">This link will expire in 1 hour.</p>
          </div>
          
          <div class="footer">
            <p>If you have any questions, please contact our support team.</p>
            <p>
              <a href="${brand.storeUrl}">${brand.storeName}</a> &middot;
              &copy; ${new Date().getFullYear()} ${brand.storeName}. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `
  }

  private generateGenericEmail(data: Record<string, any>): string {
    const brand = this.getBrand(data)
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Notification</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: ${brand.colors.text}; background: ${brand.colors.bg}; margin:0; padding:0; }
          .container { max-width: 640px; margin: 0 auto; padding: 26px 16px; }
          .content { background: ${brand.colors.surface}; border: 1px solid ${brand.colors.border}; border-radius: 14px; padding: 18px; }
          .footer { text-align: center; padding: 18px 10px; color: ${brand.colors.muted}; font-size: 12px; }
          a { color: ${brand.colors.primary}; }
        </style>
      </head>
      <body>
        <div class="container">
          ${this.renderHeader(brand)}

          <div style="height: 14px;"></div>

          <div class="content">
            <pre>${JSON.stringify(data, null, 2)}</pre>
          </div>
          
          <div class="footer">
            <p>
              <a href="${brand.storeUrl}">${brand.storeName}</a> &middot;
              &copy; ${new Date().getFullYear()} ${brand.storeName}. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `
  }

  private formatCurrency(amount: number, currencyCode: string = "MYR"): string {
    return new Intl.NumberFormat("en-MY", {
      style: "currency",
      currency: currencyCode.toUpperCase(),
    }).format(amount / 100)
  }
}

export default ResendNotificationProviderService

