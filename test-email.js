/**
 * Test script to send a test email via Resend
 * 
 * Usage:
 *   node test-email.js
 *   node test-email.js ammar.alqadasi@gmail.com
 */

const { Resend } = require("resend");
const fs = require("fs");
const path = require("path");

// Read environment variables from backend.env
function loadEnvFile(filePath) {
  const envContent = fs.readFileSync(filePath, "utf8");
  const env = {};
  envContent.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...valueParts] = trimmed.split("=");
      if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join("=").trim();
      }
    }
  });
  return env;
}

const env = loadEnvFile(path.join(__dirname, "backend.env"));

const email = process.argv[2] || "ammar.alqadasi@gmail.com";
const resendApiKey = env.RESEND_API_KEY;
const fromEmail = env.RESEND_FROM_EMAIL || "orders@yourdomain.com";

if (!resendApiKey) {
  console.error("❌ ERROR: RESEND_API_KEY is not configured in backend.env");
  console.error("Please add your Resend API key to medusa/backend.env:");
  console.error("RESEND_API_KEY=your_api_key_here");
  process.exit(1);
}

const resend = new Resend(resendApiKey);

async function sendTestEmail() {
  try {
    console.log(`📧 Sending test email to: ${email}`);
    console.log(`📤 From: ${fromEmail}`);
    console.log(`🔑 Using API key: ${resendApiKey.substring(0, 10)}...`);

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
      console.error("❌ Error sending email:", error);
      process.exit(1);
    }

    console.log("✅ Email sent successfully!");
    console.log(`📬 Email ID: ${data?.id}`);
    console.log(`✉️  Check your inbox at: ${email}`);
  } catch (error) {
    console.error("❌ Unexpected error:", error);
    process.exit(1);
  }
}

sendTestEmail();

