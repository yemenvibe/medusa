import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { LoadStrategy } from "@medusajs/framework/mikro-orm/core";

export async function POST(
  req: MedusaRequest<{ orderId?: string; email?: string }>,
  res: MedusaResponse
) {
  try {
    const { orderId, email: testEmail } = req.body;
    const notificationModuleService = req.scope.resolve("notification");
    const orderModuleService = req.scope.resolve("order");

    let order;

    if (orderId) {
      // Use existing order (minimal fields; avoid relation population issues in this project setup)
      order = await orderModuleService.retrieveOrder(orderId, {
        select: ["id", "email", "display_id", "currency_code", "total"],
        options: {},
      });
    } else {
      // List recent orders and use the first one
      const [orders] = await orderModuleService.listOrders(
        {},
        {
          take: 1,
          order: { created_at: "DESC" },
          select: ["id", "email", "display_id", "currency_code", "total"],
          options: {},
        }
      );

      if (orders && orders.length > 0) {
        order = orders[0];
      } else {
        return res.status(404).json({
          error: "No orders found. Please provide an order ID.",
        });
      }
    }

    if (!order) {
      return res.status(404).json({
        error: "Order not found",
      });
    }

    if (!order.email) {
      return res.status(400).json({
        error: "Order does not have an email address",
      });
    }

    // Override email if test email is provided
    const emailToSend = testEmail || order.email;

    // Send notification using the notification module service
    const result = await notificationModuleService.createNotifications({
      to: emailToSend,
      channel: "email",
      template: "order.placed",
      data: {
        order,
      },
    });

    return res.json({
      success: true,
      message: `Order confirmation email sent successfully to ${emailToSend}`,
      emailId: result.id,
      sentTo: emailToSend,
      orderId: order.id,
      orderDisplayId: order.display_id,
    });
  } catch (error) {
    console.error("Error sending order confirmation email:", error);
    return res.status(500).json({
      error: "Failed to send order confirmation email",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

