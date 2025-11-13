import { createWorkflow, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import {
  CreateProductWorkflowInputDTO,
  ProductDTO,
  UpsertProductDTO,
} from "@medusajs/framework/types"
import {
  createProductsWorkflow,
  updateProductsWorkflow,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"
import { getWooCommerceProductsStep } from "./steps/get-woocommerce-products"
import { downloadWooCommerceImagesStep } from "./steps/download-woocommerce-images"
import { WooCommerceProductWithRelations, WooCommerceImage } from "../modules/woocommerce/types"

const DEFAULT_OPTION_NAME = "Default"

const sanitizeText = (value?: string | null): string => {
  if (!value) {
    return ""
  }

  const withoutTags = value.replace(/<[^>]*>/g, " ")
  const decoded = withoutTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")

  return decoded.replace(/\s+/g, " ").trim()
}

const sanitizeOptionName = (value?: string | null): string => {
  const text = value?.trim()
  if (!text) {
    return ""
  }
  const normalized = text.replace(/\s+/g, " ")
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

const sanitizeOptionValue = (value?: string | null): string => {
  return value?.trim()?.slice(0, 100) || ""
}

const sanitizeSkuBase = (value?: string | null): string => {
  if (!value) {
    return ""
  }

  return value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
}

type ImageCandidate = WooCommerceImage & {
  position?: number | null
  source: "product" | "variant"
}

const collectProductImages = (
  product: WooCommerceProductWithRelations,
): Array<{ url: string; metadata: Record<string, unknown> }> => {
  const map = new Map<string, { url: string; metadata: Record<string, unknown> }>()

  const pushImage = (candidate?: ImageCandidate | null) => {
    if (!candidate?.src) {
      return
    }

    const url = candidate.src.trim()
    if (!url) {
      return
    }

    const key = url.toLowerCase()
    const metadata: Record<string, unknown> = {
      source: candidate.source,
    }

    if (candidate.id) {
      metadata.external_id = candidate.id.toString()
    }

    if (candidate.position !== undefined && candidate.position !== null) {
      metadata.position = candidate.position
    }

    const alt = sanitizeText(candidate.alt)
    if (alt) {
      metadata.alt = alt
    }

    const name = sanitizeText(candidate.name)
    if (name) {
      metadata.name = name
    }

    if (!map.has(key)) {
      map.set(key, {
        url,
        metadata,
      })
    } else {
      const existing = map.get(key)!
      existing.metadata = {
        ...metadata,
        ...existing.metadata,
      }
    }
  }

  product.images?.forEach((image, index) => {
    pushImage({
      ...image,
      position: image.position ?? index,
      source: "product",
    })
  })

  product.variations?.forEach((variation, index) => {
    if (!variation.image) {
      return
    }

    pushImage({
      ...variation.image,
      position:
        variation.image.position ??
        (product.images?.length ?? 0) + index,
      source: "variant",
    })
  })

  return Array.from(map.values()).sort((a, b) => {
    const aPos = typeof a.metadata.position === "number" ? (a.metadata.position as number) : 0
    const bPos = typeof b.metadata.position === "number" ? (b.metadata.position as number) : 0
    return aPos - bPos
  })
}

const parseAmount = (value?: string | number | null): number | null => {
  if (value === null || value === undefined || value === "") {
    return null
  }

  const numeric = typeof value === "string" ? Number.parseFloat(value) : Number(value)
  if (!Number.isFinite(numeric)) {
    return null
  }

  return Math.round(numeric * 100)
}

type MigrateProductsFromWooCommerceInput = {
  currentPage: number
  pageSize: number
}

export const migrateProductsFromWooCommerceWorkflowId = "migrate-products-from-woocommerce"

export const migrateProductsFromWooCommerceWorkflow = createWorkflow(
  {
    name: migrateProductsFromWooCommerceWorkflowId,
    retentionTime: 10000,
    store: true,
  },
  (input: MigrateProductsFromWooCommerceInput) => {
    const { pagination, products } = getWooCommerceProductsStep({
      currentPage: input.currentPage,
      pageSize: input.pageSize,
    })

    const { data: stores } = useQueryGraphStep({
      entity: "store",
      fields: ["supported_currencies.*", "default_sales_channel_id", "default_currency_code"],
      pagination: {
        take: 1,
        skip: 0,
      },
    })

    const { data: shippingProfiles } = useQueryGraphStep({
      entity: "shipping_profile",
      fields: ["id"],
      pagination: {
        take: 1,
        skip: 0,
      },
    }).config({ name: "get-shipping-profiles" })

    const categoryExternalIds = transform({ products }, ({ products: productList }) => {
      const ids = new Set<string>()
      productList.forEach((product) => {
        product.categories?.forEach((category) => {
          ids.add(category.id.toString())
        })
      })
      return Array.from(ids)
    })

    const categoryFilters = transform({ categoryExternalIds }, ({ categoryExternalIds }) => {
      if (!categoryExternalIds?.length) {
        return undefined
      }

      return {
        metadata: {
          external_id: {
            $in: categoryExternalIds,
          },
        },
      }
    })

    const { data: categories } = useQueryGraphStep({
      entity: "product_category",
      fields: ["id", "metadata"],
      filters: categoryFilters as any,
    }).config({ name: "get-categories" })

    const externalIdFilters = transform({ products }, ({ products: productList }) => {
      return productList.map((product) => product.id.toString())
    })

    const requestedVariantSkus = transform({ products }, ({ products: productList }) => {
      const skus = new Set<string>()

      const addSkuCandidate = (value?: string | null) => {
        const sanitized = sanitizeSkuBase(value)
        if (sanitized) {
          skus.add(sanitized)
        }
      }

      productList.forEach((product) => {
        addSkuCandidate(product.sku)

        product.variations?.forEach((variation) => {
          addSkuCandidate(variation.sku)
        })
      })

      return Array.from(skus)
    })

    const variantSkuFilters = transform({ requestedVariantSkus }, ({ requestedVariantSkus }) => {
      const values = requestedVariantSkus?.filter((sku) => sku)?.map((sku) => sku.trim())

      return {
        sku: {
          $in: values?.length ? values : ["__medusa_woocommerce_sku_placeholder__"],
        },
      }
    })

    const { data: existingVariantsBySku } = useQueryGraphStep({
      entity: "product_variant",
      fields: ["id", "sku"],
      filters: variantSkuFilters,
    }).config({ name: "get-existing-variants-by-sku" })

    const existingVariantSkus = transform(
      { existingVariantsBySku },
      ({ existingVariantsBySku }) =>
        existingVariantsBySku
          ?.map((variant) =>
            typeof variant?.sku === "string" ? variant.sku.toLowerCase() : null,
          )
          .filter((sku): sku is string => Boolean(sku)) ?? [],
    )

    const productFilters = transform(
      { externalIdFilters },
      ({ externalIdFilters }) => {
        const values = externalIdFilters?.filter((id) => typeof id === "string" && id.trim())
        if (!values?.length) {
          return undefined
        }

        return {
          external_id: {
            $in: values,
          },
        }
      },
    )

    const handleFilters = transform({ products }, ({ products: productList }) => {
      const handles = productList
        .map((product) => product.slug)
        .filter((handle): handle is string => Boolean(handle?.trim()))

      if (!handles.length) {
        return undefined
      }

      return {
        handle: {
          $in: handles,
        },
      }
    })

    const { data: existingProducts } = useQueryGraphStep({
      entity: "product",
      fields: [
        "id",
        "external_id",
        "variants.id",
        "variants.metadata",
        "variants.sku",
        "images.id",
        "images.url",
        "images.metadata",
      ],
      filters: productFilters,
    }).config({ name: "get-existing-products" })

    const { data: existingProductsByHandle } = useQueryGraphStep({
      entity: "product",
      fields: ["id", "handle"],
      filters: handleFilters,
    }).config({ name: "get-products-by-handle" })

    const {
      productsToCreate: rawProductsToCreate,
      productsToUpdate: rawProductsToUpdate,
    } = transform(
      {
        products,
        stores,
        categories,
        shippingProfiles,
        existingProducts,
        existingVariantSkus,
        existingProductsByHandle,
      },
      ({
        products: wooProducts,
        stores,
        categories,
        shippingProfiles,
        existingProducts,
        existingVariantSkus,
        existingProductsByHandle,
      }) => {
        const productsToCreate = new Map<string, CreateProductWorkflowInputDTO>()
        const productsToUpdate = new Map<string, UpsertProductDTO>()
        const usedSkus = new Set<string>()

        for (const sku of existingVariantSkus ?? []) {
          usedSkus.add(sku.toLowerCase())
        }

        existingProducts?.forEach((product) => {
          product.variants?.forEach((variant) => {
            const existingSku = (variant as { sku?: string }).sku
            if (existingSku) {
              usedSkus.add(existingSku.toLowerCase())
            }
          })
        })

        const defaultSalesChannelId = stores?.[0]?.default_sales_channel_id || null
        const shippingProfileId = shippingProfiles?.[0]?.id || null

        const normalizeCurrencyCode = (code?: string | null) => code?.trim().toUpperCase()
        const currencyCodeCandidates = new Set<string>()

        const supportedCurrencies =
          (stores?.[0]?.supported_currencies as Array<{ currency_code?: string | null }> | undefined) ?? []

        supportedCurrencies.forEach((currency) => {
          const normalized = normalizeCurrencyCode(currency?.currency_code)
          if (normalized) {
            currencyCodeCandidates.add(normalized)
          }
        })

        const defaultCurrencyCode = normalizeCurrencyCode(
          (stores?.[0] as { default_currency_code?: string | null } | undefined)?.default_currency_code,
        )

        if (defaultCurrencyCode) {
          currencyCodeCandidates.add(defaultCurrencyCode)
        }

        const envCurrencyFallback = normalizeCurrencyCode(
          process.env.WOOCOMMERCE_DEFAULT_CURRENCY ||
            process.env.MEDUSA_FALLBACK_CURRENCY ||
            process.env.DEFAULT_CURRENCY_CODE ||
            process.env.DEFAULT_REGION_CURRENCY,
        )

        if (!currencyCodeCandidates.size && envCurrencyFallback) {
          currencyCodeCandidates.add(envCurrencyFallback)
        }

        if (!currencyCodeCandidates.size) {
          currencyCodeCandidates.add("USD")
        }

        const currencyCodes = Array.from(currencyCodeCandidates)

        const reserveSku = (
          candidate: string | null | undefined,
          fallback: string,
          allowedSku?: { normalized: string; original: string } | null,
        ) => {
          let base = sanitizeSkuBase(candidate)
          if (!base) {
            base = sanitizeSkuBase(fallback)
          }

          if (!base) {
            base = fallback
          }

          if (!base) {
            base = `SKU-${usedSkus.size + 1}`
          }

          const allowedSkuNormalized = allowedSku?.normalized
            ? allowedSku.normalized.toLowerCase()
            : undefined
          let sku = base
          let normalized = sku.toLowerCase()

          if (allowedSkuNormalized && normalized === allowedSkuNormalized) {
            usedSkus.add(normalized)
            return allowedSku?.original ?? sku
          }

          let suffix = 1
          while (usedSkus.has(normalized)) {
            suffix += 1
            sku = `${base}-${suffix}`
            normalized = sku.toLowerCase()
          }

          usedSkus.add(normalized)
          return sku
        }

        const existingByHandle = new Map<string, { id: string }>()
        existingProductsByHandle?.forEach((product) => {
          if (product.handle) {
            existingByHandle.set(product.handle, { id: product.id })
          }
        })

        wooProducts.forEach((wooProduct) => {
          const productExternalId = wooProduct.id.toString()
          const productTitle = sanitizeText(wooProduct.name) || `Product ${productExternalId}`
          const productDescription =
            sanitizeText(wooProduct.description) || sanitizeText(wooProduct.short_description)
          const galleryImages = collectProductImages(wooProduct)
          const productThumbnail = galleryImages[0]?.url || wooProduct.images?.[0]?.src

          const productData: CreateProductWorkflowInputDTO | UpsertProductDTO = {
            title: productTitle,
            description: productDescription,
            status: wooProduct.status === "publish" ? "published" : "draft",
            handle: wooProduct.slug || undefined,
            external_id: productExternalId,
            thumbnail: productThumbnail,
            shipping_profile_id: shippingProfileId || undefined,
            sales_channels: defaultSalesChannelId ? [{ id: defaultSalesChannelId }] : [],
          }

          const existingProduct = existingProducts?.find(
            (product) => product.external_id === productExternalId,
          )

          if (existingProduct) {
            productData.id = existingProduct.id
          }

          if (!productData.id && productData.handle && existingByHandle.has(productData.handle)) {
            return
          }

          const existingImagesByExternalId = new Map<
            string,
            {
              id: string
              url: string | null
              metadata: Record<string, unknown> | null | undefined
            }
          >()

          existingProduct?.images?.forEach((image) => {
            if (!image) {
              return
            }

            const metadata = image.metadata as Record<string, unknown> | null | undefined
            const externalId = metadata?.external_id

            if (!externalId) {
              return
            }

            existingImagesByExternalId.set(String(externalId), {
              id: image.id as string,
              url: typeof image.url === "string" ? image.url : null,
              metadata,
            })
          })

          if (galleryImages.length) {
            const resolvedGalleryImages = galleryImages.map((image) => {
              const metadata = {
                ...(image.metadata ?? {}),
              }

              const externalIdCandidate = metadata.external_id
              const normalizedExternalId =
                externalIdCandidate !== undefined && externalIdCandidate !== null
                  ? String(externalIdCandidate)
                  : undefined

              if (!metadata.source_url) {
                metadata.source_url = image.url
              }

              if (normalizedExternalId) {
                metadata.external_id = normalizedExternalId
              }

              const existingImage = normalizedExternalId
                ? existingImagesByExternalId.get(normalizedExternalId)
                : undefined

              if (existingImage) {
                if (existingImage.metadata && typeof existingImage.metadata === "object") {
                  Object.entries(existingImage.metadata).forEach(([key, value]) => {
                    if (value !== undefined && value !== null) {
                      metadata[key] = value
                    }
                  })
                }

                if (existingImage.url) {
                  return {
                    url: existingImage.url,
                    metadata,
                  }
                }
              }

              return {
                url: image.url,
                metadata,
              }
            })

            const resolvedThumbnail = resolvedGalleryImages[0]?.url || productThumbnail

            if (resolvedThumbnail) {
              productData.thumbnail = resolvedThumbnail
            }

            productData.images = resolvedGalleryImages
          }

          if (!productData.images?.length && productThumbnail) {
            productData.thumbnail = productThumbnail
          }

          productData.category_ids = wooProduct.categories
            ?.map((category) =>
              categories
                ?.find(
                  (targetCategory) => targetCategory.metadata?.external_id === category.id.toString(),
                )
                ?.id,
            )
            .filter((id): id is string => Boolean(id))

          const optionValueMap = new Map<string, Set<string>>()

          const assignOptionValue = (name?: string | null, value?: string | null) => {
            const optionName = sanitizeOptionName(name)
            const optionValue = sanitizeOptionValue(value)

            if (!optionName || !optionValue) {
              return { optionName: "", optionValue: "" }
            }

            if (!optionValueMap.has(optionName)) {
              optionValueMap.set(optionName, new Set())
            }

            optionValueMap.get(optionName)!.add(optionValue)
            return { optionName, optionValue }
          }

          const variationSource =
            wooProduct.type === "variable" && wooProduct.variations?.length
              ? wooProduct.variations
              : [
                  {
                    id: wooProduct.id,
                    sku: wooProduct.sku,
                    price: wooProduct.price,
                    regular_price: wooProduct.regular_price,
                    sale_price: wooProduct.sale_price,
                    stock_status: wooProduct.stock_status,
                    stock_quantity: wooProduct.stock_quantity,
                    description:
                      sanitizeText(wooProduct.short_description) ||
                      sanitizeText(wooProduct.description) ||
                      productTitle,
                    attributes:
                      wooProduct.default_attributes?.length
                        ? wooProduct.default_attributes.map((attr) => ({
                            id: attr.id,
                            name: attr.name,
                            option: attr.option,
                          }))
                        : wooProduct.attributes?.map((attr) => ({
                            id: attr.id,
                            name: attr.name,
                            option: attr.options?.[0] || "",
                          })) || [],
                  },
                ]

          const existingVariantByExternalId = new Map<string, { id: string; sku?: string | null }>()
          existingProduct?.variants?.forEach((variant) => {
            const externalIdValue = variant.metadata?.external_id
            if (!externalIdValue) {
              return
            }

            const normalizedExternalId = String(externalIdValue)

            existingVariantByExternalId.set(normalizedExternalId, {
              id: variant.id,
              sku: (variant as { sku?: string | null }).sku,
            })
          })

          const variants = variationSource
            .map((variation, index) => {
              const priceAmount =
                parseAmount(variation.regular_price) ||
                parseAmount(variation.price) ||
                parseAmount(wooProduct.regular_price) ||
                parseAmount(wooProduct.price)

              if (!priceAmount) {
                return null
              }

              const variantTitle = sanitizeText(variation.description) || productTitle
              const fallbackSkuBase = `${sanitizeSkuBase(wooProduct.slug) || "PROD"}-${index + 1}`
              const existingVariant = existingVariantByExternalId.get(variation.id.toString())
              const allowedSkuNormalized = existingVariant?.sku
                ? sanitizeSkuBase(existingVariant.sku)
                : ""
              const sku = reserveSku(
                variation.sku,
                fallbackSkuBase || `${productExternalId}-${variation.id}`,
                allowedSkuNormalized
                  ? {
                      normalized: allowedSkuNormalized,
                      original: existingVariant?.sku ?? allowedSkuNormalized,
                    }
                  : undefined,
              )

              const variantOptions: Record<string, string> = {}

              variation.attributes?.forEach((attr) => {
                const { optionName, optionValue } = assignOptionValue(attr.name, attr.option)
                if (optionName && optionValue) {
                  variantOptions[optionName] = optionValue
                }
              })

              if (!Object.keys(variantOptions).length) {
                const { optionName, optionValue } = assignOptionValue(
                  DEFAULT_OPTION_NAME,
                  variantTitle,
                )
                if (optionName && optionValue) {
                  variantOptions[optionName] = optionValue
                }
              }

              const variantMetadata: Record<string, unknown> = {
                external_id: variation.id.toString(),
              }

              if (variation.image?.src) {
                variantMetadata.image_url = variation.image.src
                variantMetadata.image_original_url = variation.image.src
                const imageAlt = sanitizeText(variation.image.alt)
                if (imageAlt) {
                  variantMetadata.image_alt = imageAlt
                }

                if (variation.image?.id) {
                  variantMetadata.image_external_id = variation.image.id.toString()

                  const existingVariantImage = existingImagesByExternalId.get(
                    variation.image.id.toString(),
                  )

                  if (existingVariantImage) {
                    if (existingVariantImage.url) {
                      variantMetadata.image_url = existingVariantImage.url
                    }

                    const existingMetadata = existingVariantImage.metadata
                    if (existingMetadata && typeof existingMetadata === "object") {
                      const fileId = (existingMetadata as Record<string, unknown>).file_id
                      if (fileId) {
                        variantMetadata.image_file_id = fileId
                      }
                    }
                  }
                }
              }

              return {
                title: variantTitle,
                sku,
                options: variantOptions,
                prices: currencyCodes.map((currency_code) => ({
                  currency_code,
                  amount: priceAmount,
                })),
                metadata: variantMetadata,
                id: existingVariant?.id,
              }
            })
            .filter((variant): variant is NonNullable<typeof variant> => Boolean(variant))

          if (!variants.length) {
            return
          }

          const optionNames = Array.from(optionValueMap.keys())
          variants.forEach((variant) => {
            optionNames.forEach((name) => {
              if (!variant.options[name]) {
                const fallbackValue = sanitizeOptionValue(variant.title)
                variant.options[name] = fallbackValue || name
                optionValueMap.get(name)?.add(variant.options[name])
              }
            })
          })

          productData.options = optionNames.map((name) => ({
            title: name,
            values: Array.from(optionValueMap.get(name) || []),
          }))

          productData.variants = variants

          if (productData.id) {
            productsToUpdate.set(productData.id, productData as UpsertProductDTO)
          } else {
            productsToCreate.set(productExternalId, productData as CreateProductWorkflowInputDTO)
          }
        })

        return {
          productsToCreate: Array.from(productsToCreate.values()),
          productsToUpdate: Array.from(productsToUpdate.values()),
        }
      },
  )

    const processedProducts = downloadWooCommerceImagesStep({
      productsToCreate: rawProductsToCreate,
      productsToUpdate: rawProductsToUpdate,
    }).config({ name: "download-woocommerce-images" })

    const productsToCreate = transform({ processedProducts }, ({ processedProducts }) => {
      return processedProducts.productsToCreate ?? []
    })

    const productsToUpdate = transform({ processedProducts }, ({ processedProducts }) => {
      return processedProducts.productsToUpdate ?? []
    })

    const createdProducts = productsToCreate.length
      ? createProductsWorkflow
          .runAsStep({
            input: {
              products: productsToCreate,
            },
          })
          .config({ name: "create-woocommerce-products" })
      : transform({}, () => [] as ProductDTO[])

    const updatedProductsResult = productsToUpdate.length
      ? updateProductsWorkflow
          .runAsStep({
            input: {
              products: productsToUpdate,
            },
          })
          .config({ name: "update-woocommerce-products" })
      : transform({}, () => [] as ProductDTO[])

    const productsNeedingCategorySync = transform(
      {
        createdProducts,
        updatedProducts: updatedProductsResult,
        productsToCreate,
        productsToUpdate,
      },
      ({ createdProducts, updatedProducts: _updatedProducts, productsToCreate, productsToUpdate }) => {
        const assignments: UpsertProductDTO[] = []

        if (createdProducts?.length) {
          const categoriesByExternalId = new Map<string, string[] | undefined>()

          productsToCreate.forEach((product) => {
            const externalId = (product as UpsertProductDTO).external_id
            const categoryIds = (product as UpsertProductDTO).category_ids

            if (!externalId || typeof categoryIds === "undefined") {
              return
            }

            categoriesByExternalId.set(externalId, categoryIds)
          })

          createdProducts.forEach((product) => {
            const externalId = product?.external_id
            const productId = product?.id

            if (!externalId || !productId || !categoriesByExternalId.has(externalId)) {
              return
            }

            const categoryIds = categoriesByExternalId.get(externalId)
            if (typeof categoryIds === "undefined") {
              return
            }

            assignments.push({
              id: productId,
              category_ids: categoryIds ?? [],
            })
          })
        }

        productsToUpdate.forEach((product) => {
          if (!product?.id || typeof product.category_ids === "undefined") {
            return
          }

          assignments.push({
            id: product.id,
            category_ids: product.category_ids ?? [],
          })
        })

        return assignments
      },
    )

    updateProductsWorkflow
      .runAsStep({
        input: {
          products: productsNeedingCategorySync,
        },
      })
      .config({ name: "sync-woocommerce-product-categories" })

    return new WorkflowResponse(pagination)
  },
)
