export type ResendNotificationProviderOptions = {
  /**
   * Resend API key
   * Get your API key from https://resend.com/api-keys
   */
  api_key: string

  /**
   * Default "from" email address
   * Must be a verified domain in Resend
   */
  from: string

  /**
   * Enable/disable notifications in development
   */
  enable_endpoint?: string

  /**
   * BCC addresses for all emails (optional)
   */
  bcc?: string[]
}

export type ResendEmailData = {
  to: string | string[]
  from?: string
  subject: string
  html?: string
  text?: string
  cc?: string[]
  bcc?: string[]
  reply_to?: string
  attachments?: Array<{
    filename: string
    content: Buffer | string
  }>
  template_id?: string
  template_data?: Record<string, any>
}

export type ResendEmailResponse = {
  id: string
}

