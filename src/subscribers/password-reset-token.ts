import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework"

// In-memory store for reset tokens
// In production, consider using Redis or a database
const resetTokenStore = new Map<string, { token: string; expiresAt: number }>()

// Export function to get token (for use in API routes)
export function getResetToken(email: string): string | null {
  const stored = resetTokenStore.get(email)
  if (!stored) {
    return null
  }

  // Check if token has expired (1 hour TTL)
  if (Date.now() > stored.expiresAt) {
    resetTokenStore.delete(email)
    return null
  }

  return stored.token
}

// Export function to delete token after use
export function deleteResetToken(email: string): void {
  resetTokenStore.delete(email)
}

export default async function passwordResetTokenHandler({
  event: { data },
  container,
}: SubscriberArgs<{ entity_id: string; token: string; actor_type: string }>) {
  // Only handle customer password resets
  if (data.actor_type !== "customer") {
    return
  }

  const email = data.entity_id
  const token = data.token

  // Store the token with email as key, TTL of 1 hour (3600000 ms)
  resetTokenStore.set(email, {
    token,
    expiresAt: Date.now() + 3600000, // 1 hour from now
  })

  // Clean up expired tokens periodically (optional)
  // In production, use Redis with TTL instead
  if (resetTokenStore.size > 1000) {
    const now = Date.now()
    for (const [key, value] of resetTokenStore.entries()) {
      if (now > value.expiresAt) {
        resetTokenStore.delete(key)
      }
    }
  }
}

export const config: SubscriberConfig = {
  event: "auth.password_reset",
}

