import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getResetToken, deleteResetToken } from "../../../../subscribers/password-reset-token"

type ChangePasswordBody = {
  oldPassword: string
  newPassword: string
  email: string
}

export async function POST(
  req: MedusaRequest<ChangePasswordBody>,
  res: MedusaResponse
) {
  try {
    const { oldPassword, newPassword, email } = req.body || ({} as ChangePasswordBody)

    // Validate all fields are present and not empty
    if (!oldPassword || typeof oldPassword !== 'string' || oldPassword.trim() === '') {
      return res.status(400).json({
        error: "Old password is required and cannot be empty",
      })
    }

    if (!newPassword || typeof newPassword !== 'string' || newPassword.trim() === '') {
      return res.status(400).json({
        error: "New password is required and cannot be empty",
      })
    }

    if (!email || typeof email !== 'string' || email.trim() === '') {
      return res.status(400).json({
        error: "Email is required and cannot be empty",
      })
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        error: "New password must be at least 8 characters long",
      })
    }

    const authModuleService = req.scope.resolve(Modules.AUTH)

    // Verify old password by attempting to authenticate
    // authenticate method signature: authenticate(actorType, provider, credentials)
    try {
      await (authModuleService as any).authenticate("customer", "emailpass", {
        email,
        password: oldPassword,
      })
    } catch (error: any) {
      return res.status(401).json({
        error: "Old password is incorrect",
      })
    }

    // Request a password reset token by calling the internal auth endpoint
    // This will trigger the auth.password_reset event which our subscriber will capture
    // We use an internal HTTP call to trigger the reset password flow
    const baseUrl = process.env.MEDUSA_BACKEND_URL || req.get("host") || "http://localhost:9000"
    const protocol = req.protocol || "http"
    const fullUrl = `${protocol}://${baseUrl.replace(/^https?:\/\//, "")}`
    
    await fetch(`${fullUrl}/auth/customer/emailpass/reset-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        identifier: email,
      }),
    })

    // Wait a moment for the event to be processed and token stored
    // In production, you might want to use a more robust mechanism like polling
    let attempts = 0
    let resetToken: string | null = null
    while (attempts < 10 && !resetToken) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      resetToken = getResetToken(email)
      attempts++
    }

    if (!resetToken) {
      return res.status(500).json({
        error: "Failed to generate reset token. Please try again.",
      })
    }

    // Update the password using the reset token
    // Use the HTTP client to call the update endpoint directly with the token
    const updateResponse = await fetch(`${fullUrl}/auth/customer/emailpass/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${resetToken}`,
      },
      body: JSON.stringify({
        email,
        password: newPassword,
      }),
    })

    if (!updateResponse.ok) {
      const errorData = await updateResponse.json().catch(() => ({}))
      return res.status(500).json({
        error: errorData.message || errorData.error || "Failed to update password",
      })
    }

    const updateData = await updateResponse.json().catch(() => ({ success: true }))

    if (!updateData?.success && updateData?.success !== undefined) {
      return res.status(500).json({
        error: updateData?.error || "Failed to update password",
      })
    }

    // Delete the token after successful use
    deleteResetToken(email)

    return res.json({
      success: true,
      message: "Password updated successfully",
    })
  } catch (error: any) {
    return res.status(500).json({
      error: error.message || "Internal server error",
    })
  }
}

