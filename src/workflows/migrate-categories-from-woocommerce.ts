import { createWorkflow, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import {
  createProductCategoriesWorkflow,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"
import {
  CreateProductCategoryDTO,
  ProductCategoryDTO,
  UpsertProductCategoryDTO,
} from "@medusajs/framework/types"
import { getWooCommerceCategoriesStep } from "./steps/get-woocommerce-categories"
import { updateProductCategoriesStep } from "./steps/update-product-categories"

const sanitizeHandle = (name: string, id: number): string => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return base ? `${base}-${id}` : `category-${id}`
}

type MigrateCategoriesFromWooCommerceInput = {
  currentPage: number
  pageSize: number
}

export const migrateCategoriesFromWooCommerceWorkflowId = "migrate-categories-from-woocommerce"

export const migrateCategoriesFromWooCommerceWorkflow = createWorkflow(
  {
    name: migrateCategoriesFromWooCommerceWorkflowId,
    retentionTime: 10000,
    store: true,
  },
  (input: MigrateCategoriesFromWooCommerceInput) => {
    const { categories, pagination } = getWooCommerceCategoriesStep({
      currentPage: input.currentPage,
      pageSize: input.pageSize,
    })

    const optionalExternalIds = transform({ categories }, ({ categories: list }) =>
      list.map((category) => category.id.toString()),
    )

    const categoryFilters = transform({ optionalExternalIds }, ({ optionalExternalIds }) => {
      if (!optionalExternalIds?.length) {
        return undefined
      }

      return {
        metadata: {
          external_id: {
            $in: optionalExternalIds,
          },
        },
      }
    })

    const { data: existingCategories } = useQueryGraphStep({
      entity: "product_category",
      fields: ["id", "metadata", "handle", "name", "parent_category_id"],
      filters: categoryFilters as any,
    }).config({ name: "get-existing-woocommerce-categories" })

    const { categoriesToCreate, categoriesToUpdate, parentAssignments } = transform(
      {
        categories,
        existingCategories,
      },
      ({ categories: wooCategories, existingCategories }) => {
        const categoriesToCreate = new Map<string, CreateProductCategoryDTO>()
        const categoriesToUpdate = new Map<string, UpsertProductCategoryDTO>()
        const parentAssignments: Array<{ childExternalId: string; parentExternalId: string }> = []

        const existingByExternalId = new Map<string, ProductCategoryDTO>()
        existingCategories?.forEach((category) => {
          const externalId = category.metadata?.external_id
          if (externalId) {
            existingByExternalId.set(String(externalId), category as unknown as ProductCategoryDTO)
          }
        })

        wooCategories.forEach((category, index) => {
          const externalId = category.id.toString()
          const existing = existingByExternalId.get(externalId)

          const baseData: UpsertProductCategoryDTO = {
            name: category.name || `Category ${externalId}`,
            is_active: true,
            rank: index,
            metadata: {
              external_id: externalId,
            },
          }

          if (existing) {
            baseData.id = existing.id
            baseData.handle = existing.handle
            categoriesToUpdate.set(externalId, baseData)
          } else {
            baseData.handle = sanitizeHandle(category.slug || category.name, category.id)
            categoriesToCreate.set(externalId, baseData as CreateProductCategoryDTO)
          }

          if (category.parent && category.parent > 0) {
            parentAssignments.push({
              childExternalId: externalId,
              parentExternalId: category.parent.toString(),
            })
          }
        })

        return {
          categoriesToCreate: Array.from(categoriesToCreate.values()),
          categoriesToUpdate: Array.from(categoriesToUpdate.values()),
          parentAssignments,
        }
      },
    )

    const createdCategories = categoriesToCreate.length
      ? createProductCategoriesWorkflow.runAsStep({
          input: {
            product_categories: categoriesToCreate,
          },
        })
      : transform({}, () => [] as ProductCategoryDTO[])

    const updatedCategories = categoriesToUpdate.length
      ? updateProductCategoriesStep({
          product_categories: categoriesToUpdate,
        })
      : transform({}, () => [] as ProductCategoryDTO[])

    const categoriesToUpdateParent = transform(
      {
        parentAssignments,
        createdCategories,
        updatedCategories,
        existingCategories,
      },
      ({ parentAssignments, createdCategories, updatedCategories, existingCategories }) => {
        const updates: Array<{ id: string; parent_category_id: string }> = []

        const upsertedCategories: ProductCategoryDTO[] = [
          ...(createdCategories || []),
          ...(updatedCategories || []),
          ...(existingCategories || []),
        ].filter((category): category is ProductCategoryDTO => !!(category as ProductCategoryDTO).metadata)

        const byExternalId = new Map<string, ProductCategoryDTO>()
        upsertedCategories.forEach((category) => {
          const externalId = category.metadata?.external_id
          if (externalId) {
            byExternalId.set(String(externalId), category)
          }
        })

        parentAssignments.forEach(({ childExternalId, parentExternalId }) => {
          const childCategory = byExternalId.get(childExternalId)
          const parentCategory = byExternalId.get(parentExternalId)

          if (!childCategory || !parentCategory) {
            return
          }

          if (childCategory.parent_category_id === parentCategory.id) {
            return
          }

          if (!childCategory.id || !parentCategory.id) {
            return
          }

          updates.push({ id: childCategory.id, parent_category_id: parentCategory.id })
        })

        return updates.filter((update) => update?.id && update?.parent_category_id)
      },
    )

    updateProductCategoriesStep({
      product_categories: categoriesToUpdateParent,
    }).config({ name: "update-woocommerce-parent-categories" })

    return new WorkflowResponse(pagination)
  },
)
