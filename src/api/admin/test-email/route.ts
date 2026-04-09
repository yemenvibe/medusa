import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Resend } from "resend";

export async function POST(
  req: MedusaRequest<{ email?: string }>,
  res: MedusaResponse
) {
  try {
    const email = req.body?.email || "ammar.alqadasi@gmail.com";
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL || "orders@yourdomain.com";

    if (!resendApiKey) {
      return res.status(400).json({
        error: "RESEND_API_KEY is not configured in environment variables",
      });
    }

    const resend = new Resend(resendApiKey);

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: "Test Email from Al Sultan",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #333;">Test Email</h1>
          <p style="color: #666; line-height: 1.6;">
            This is a test email sent from your Al Sultan application.
          </p>
          <p style="color: #666; line-height: 1.6;">
            If you received this email, your Resend email configuration is working correctly!
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">
            Sent at: ${new Date().toLocaleString()}
          </p>
        </div>
      `,
      text: `Test Email\n\nThis is a test email sent from your Al Sultan application.\n\nIf you received this email, your Resend email configuration is working correctly!\n\nSent at: ${new Date().toLocaleString()}`,
    });

    if (error) {
      console.error("Resend error:", error);
      return res.status(500).json({
        error: "Failed to send email",
        details: error,
      });
    }

    return res.json({
      success: true,
      message: `Test email sent successfully to ${email}`,
      emailId: data?.id,
    });
  } catch (error) {
    console.error("Error sending test email:", error);
    return res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}





