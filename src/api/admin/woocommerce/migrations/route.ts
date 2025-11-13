import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  migrateCategoriesFromWooCommerceWorkflowId,
  migrateProductsFromWooCommerceWorkflowId,
} from "../../../../workflows"
import { z } from "zod"
import { AdminWooCommerceMigrationsPost } from "../../../middlewares"

const parseRequestBody = (req: MedusaRequest): AdminWooCommerceMigrationsPostType => {
  const maybeValidated = (req as MedusaRequest & {
    validatedBody?: AdminWooCommerceMigrationsPostType
  }).validatedBody

  if (maybeValidated) {
    return maybeValidated
  }

  return AdminWooCommerceMigrationsPost.parse(req.body ?? {})
}

type AdminWooCommerceMigrationsPostType = z.infer<typeof AdminWooCommerceMigrationsPost>

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const workflowEngine = req.scope.resolve("workflows")

  const [executions, count] = await workflowEngine.listAndCountWorkflowExecutions(
    {
      workflow_id: [
        migrateProductsFromWooCommerceWorkflowId,
        migrateCategoriesFromWooCommerceWorkflowId,
      ],
    },
    {
      order: {
        created_at: "DESC",
      },
    },
  )

  res.json({ workflow_executions: executions, count })
}

export async function POST(
  req: MedusaRequest<AdminWooCommerceMigrationsPostType>,
  res: MedusaResponse,
) {
  const body = parseRequestBody(req)

  const eventBusService = req.scope.resolve("event_bus")

  const types = Array.isArray(body.type) && body.type.length ? body.type : ["product"]

  eventBusService.emit({
    name: "migrate.woocommerce",
    data: {
      type: types,
      currentPage: body.current_page,
      pageSize: body.page_size,
      syncAllPages: body.sync_all_pages ?? false,
    },
  })

  res.json({ success: true })
}
