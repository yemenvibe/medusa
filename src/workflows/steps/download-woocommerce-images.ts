import path from "path"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import type { CreateProductWorkflowInputDTO, UpsertProductDTO } from "@medusajs/framework/types"

export const WOOCOMMERCE_IMAGE_PENDING_METADATA_KEY = "woocommerce_image_download_pending"

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".tiff": "image/tiff",
}

const EXTENSIONS_BY_MIME: Record<string, string> = Object.entries(MIME_TYPES_BY_EXTENSION).reduce(
  (acc, [ext, mime]) => {
    acc[mime] = ext.slice(1)
    return acc
  },
  {} as Record<string, string>,
)

const isHttpUrl = (value?: string | null): value is string => {
  if (!value) {
    return false
  }

  return value.startsWith("http://") || value.startsWith("https://")
}

const guessMimeType = (url: string, headerMimeType?: string | null): string => {
  const normalizedHeader = headerMimeType?.split(";")[0]?.trim().toLowerCase()
  if (normalizedHeader && normalizedHeader !== "application/octet-stream") {
    return normalizedHeader
  }

  try {
    const parsed = new URL(url)
    const base = path.posix.basename(parsed.pathname || "")
    const ext = base ? path.extname(base).toLowerCase() : ""
    if (ext && MIME_TYPES_BY_EXTENSION[ext]) {
      return MIME_TYPES_BY_EXTENSION[ext]
    }
  } catch {
    // ignore
  }

  return "image/jpeg"
}

const slugifyFilename = (value: string): string => {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

  return normalized || "woocommerce-image"
}

const ensureFilename = (url: string, mimeType: string): string => {
  const fallbackExt = EXTENSIONS_BY_MIME[mimeType] || "jpg"

  try {
    const parsed = new URL(url)
    const pathname = parsed.pathname || ""
    const base = path.posix.basename(pathname)
    if (base) {
      const ext = path.extname(base)
      const name = slugifyFilename(ext ? base.slice(0, -ext.length) : base)
        .replace(/-[a-z0-9]{20,}$/, "")
      const safeExt = ext ? ext.toLowerCase().replace(/[^a-z0-9.]/g, "") : `.${fallbackExt}`
      return `${name}${safeExt.startsWith(".") ? safeExt : `.${safeExt}`}`
    }
  } catch {
    // ignore parsing issues
  }

  return `${slugifyFilename("woocommerce-image")}-${Date.now()}.${fallbackExt}`
}

const cloneProduct = <T extends CreateProductWorkflowInputDTO | UpsertProductDTO>(product: T): T => {
  return {
    ...product,
    options: product.options?.map((option) => ({
      ...option,
      values: Array.isArray(option.values) ? [...option.values] : option.values,
    })),
    variants: product.variants?.map((variant) => ({
      ...variant,
      metadata: variant.metadata ? { ...variant.metadata } : {},
      options: variant.options ? { ...variant.options } : {},
      prices: variant.prices?.map((price) => ({ ...price })) ?? [],
    })),
    ...("sales_channels" in product && Array.isArray(product.sales_channels)
      ? { sales_channels: product.sales_channels.map((channel) => ({ ...channel })) }
      : {}),
    images: product.images?.map((image) => ({
      ...image,
      metadata: image.metadata ? { ...image.metadata } : undefined,
    })),
  }
}

type DownloadWooCommerceImagesInput = {
  productsToCreate: CreateProductWorkflowInputDTO[]
  productsToUpdate: UpsertProductDTO[]
  forceDownload?: boolean
}

type UploadedImageInfo = {
  fileId: string
  url: string
}

type ImageReference = {
  target: "create" | "update"
  productIndex: number
  imageIndex: number
  originalUrl: string
}

type ThumbnailReference = {
  target: "create" | "update"
  productIndex: number
  originalUrl: string
}

type VariantImageReference = {
  target: "create" | "update"
  productIndex: number
  variantIndex: number
  originalUrl: string
}

const DEFAULT_CONCURRENCY = 3
const MAX_CONCURRENCY = 8

export const downloadWooCommerceImagesStepId = "download-woocommerce-images"

export const downloadWooCommerceImagesStep = createStep(
  downloadWooCommerceImagesStepId,
  async (input: DownloadWooCommerceImagesInput, { container }) => {
    const logger = container.resolve("logger") as {
      warn?: (...args: any[]) => void
      info?: (...args: any[]) => void
    } | undefined

    const {
      productsToCreate: rawProductsToCreate = [],
      productsToUpdate: rawProductsToUpdate = [],
      forceDownload = false,
    } = input

    const delayFlagRaw = process.env.WOOCOMMERCE_DELAY_IMAGE_DOWNLOAD || ""
    const shouldDelayDownloads = forceDownload
      ? false
      : ["1", "true", "yes", "on"].includes(delayFlagRaw.toLowerCase())

    const productsToCreate = rawProductsToCreate.map((product) => cloneProduct(product))
    const productsToUpdate = rawProductsToUpdate.map((product) => cloneProduct(product))

    const imageRefs: ImageReference[] = []
    const thumbnailRefs: ThumbnailReference[] = []
    const variantRefs: VariantImageReference[] = []
    const urlsToUpload = new Set<string>()

    const trackImage = (
      target: ImageReference["target"],
      productIndex: number,
      imageIndex: number,
      originalUrl: string,
    ) => {
      imageRefs.push({ target, productIndex, imageIndex, originalUrl })
      urlsToUpload.add(originalUrl)
    }

    const trackThumbnail = (
      target: ThumbnailReference["target"],
      productIndex: number,
      originalUrl: string,
    ) => {
      thumbnailRefs.push({ target, productIndex, originalUrl })
      urlsToUpload.add(originalUrl)
    }

    const trackVariantImage = (
      target: VariantImageReference["target"],
      productIndex: number,
      variantIndex: number,
      originalUrl: string,
    ) => {
      variantRefs.push({ target, productIndex, variantIndex, originalUrl })
      urlsToUpload.add(originalUrl)
    }

    const processProductList = (
      products: (CreateProductWorkflowInputDTO | UpsertProductDTO)[],
      target: "create" | "update",
    ) => {
      products.forEach((product, productIndex) => {
        if (isHttpUrl(product.thumbnail)) {
          trackThumbnail(target, productIndex, product.thumbnail)
        }

        product.images?.forEach((image, imageIndex) => {
          if (!image?.url || image.metadata?.file_id) {
            return
          }

          if (isHttpUrl(image.url)) {
            if (!image.metadata) {
              image.metadata = {}
            }

            if (!image.metadata.source_url) {
              image.metadata.source_url = image.url
            }

            trackImage(target, productIndex, imageIndex, image.url)
          }
        })

        product.variants?.forEach((variant, variantIndex) => {
          if (!variant?.metadata) {
            variant.metadata = {}
          }

          const variantImageUrl = variant.metadata.image_url
          if (isHttpUrl(variantImageUrl) && !variant.metadata.image_file_id) {
            if (!variant.metadata.image_original_url) {
              variant.metadata.image_original_url = variantImageUrl
            }
            trackVariantImage(target, productIndex, variantIndex, variantImageUrl)
          }
        })
      })
    }

    processProductList(productsToCreate, "create")
    processProductList(productsToUpdate, "update")

    if (!urlsToUpload.size) {
      return new StepResponse(
        {
          productsToCreate,
          productsToUpdate,
        },
        [],
      )
    }

    if (shouldDelayDownloads) {
      logger?.info?.(
        `[woocommerce-images] Skipping download for ${urlsToUpload.size} image(s); will rely on delayed processing.`,
      )

      const collectProductUrls = (
        target: "create" | "update",
        productIndex: number,
      ): string[] => {
        const set = new Set<string>()

        imageRefs.forEach((ref) => {
          if (ref.target === target && ref.productIndex === productIndex) {
            set.add(ref.originalUrl)
          }
        })

        thumbnailRefs.forEach((ref) => {
          if (ref.target === target && ref.productIndex === productIndex) {
            set.add(ref.originalUrl)
          }
        })

        variantRefs.forEach((ref) => {
          if (ref.target === target && ref.productIndex === productIndex) {
            set.add(ref.originalUrl)
          }
        })

        return Array.from(set)
      }

      const markProductsAsPending = (
        products: (CreateProductWorkflowInputDTO | UpsertProductDTO)[],
        target: "create" | "update",
      ) => {
        products.forEach((product, productIndex) => {
          const urls = collectProductUrls(target, productIndex)
          if (!urls.length) {
            return
          }

          if (!product.metadata || typeof product.metadata !== "object") {
            product.metadata = {}
          }

          ;(product.metadata as Record<string, unknown>)[WOOCOMMERCE_IMAGE_PENDING_METADATA_KEY] = {
            target,
            productIndex,
            urls,
          }
        })
      }

      markProductsAsPending(productsToCreate, "create")
      markProductsAsPending(productsToUpdate, "update")

      return new StepResponse(
        {
          productsToCreate,
          productsToUpdate,
        },
        [],
      )
    }

    let fileService: {
      createFiles: (files: any) => Promise<any>
      deleteFiles: (ids: string[]) => Promise<void>
    } | null = null

    try {
      fileService = container.resolve(Modules.FILE)
    } catch (error) {
      logger?.warn?.("[woocommerce-images] File module isn't configured; skipping image downloads")
      return new StepResponse(
        {
          productsToCreate,
          productsToUpdate,
        },
        [],
      )
    }

    if (!fileService) {
      logger?.warn?.("[woocommerce-images] File module isn't available; skipping image downloads")
      return new StepResponse(
        {
          productsToCreate,
          productsToUpdate,
        },
        [],
      )
    }

  const uploadedMap = new Map<string, UploadedImageInfo>()
    const createdFileIds: string[] = []
    const concurrencyFromEnv = Number.parseInt(process.env.WOOCOMMERCE_IMAGE_DOWNLOAD_CONCURRENCY || "", 10)
    const concurrency = Number.isFinite(concurrencyFromEnv)
      ? Math.min(Math.max(concurrencyFromEnv, 1), MAX_CONCURRENCY)
      : DEFAULT_CONCURRENCY

    const urls = Array.from(urlsToUpload)
    let cursor = 0

    const worker = async () => {
      while (cursor < urls.length) {
        const currentIndex = cursor
        cursor += 1
        const url = urls[currentIndex]

        if (!url || uploadedMap.has(url)) {
          continue
        }

        try {
          const response = await fetch(url, {
            method: "GET",
            headers: {
              "user-agent":
                "Medusa WooCommerce Migrator/1.0 (+https://medusajs.com/)",
            },
          })

          if (!response.ok) {
            if (response.status === 404) {
              logger?.info?.(
                `[woocommerce-images] Skipping missing image ${url} (404)`
              )
              continue
            }

            throw new Error(`Failed to download image (${response.status})`)
          }

          const arrayBuffer = await response.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)
          const mimeType = guessMimeType(url, response.headers.get("content-type"))
          const filename = ensureFilename(url, mimeType)

          const file = await fileService!.createFiles({
            filename,
            mimeType,
            content: buffer.toString("base64"),
            access: "public",
          })

          const fileRecord = Array.isArray(file) ? file[0] : file
          if (!fileRecord?.id || !fileRecord?.url) {
            throw new Error("File provider did not return id or url")
          }

          createdFileIds.push(fileRecord.id)
          uploadedMap.set(url, {
            fileId: fileRecord.id,
            url: fileRecord.url,
          })
        } catch (error) {
          logger?.warn?.(
            `[woocommerce-images] Unable to download image from ${url}: ${(error as Error).message}`,
          )
        }
      }
    }

    await Promise.all(
      Array.from({ length: concurrency }).map(async () => worker()),
    )

    const applyUploads = (
      products: (CreateProductWorkflowInputDTO | UpsertProductDTO)[],
      target: "create" | "update",
    ) => {
      products.forEach((product, productIndex) => {
        product.images?.forEach((image, imageIndex) => {
          const reference = imageRefs.find(
            (ref) =>
              ref.target === target &&
              ref.productIndex === productIndex &&
              ref.imageIndex === imageIndex,
          )

          if (!reference) {
            return
          }

          const uploaded = uploadedMap.get(reference.originalUrl)
          if (!uploaded) {
            return
          }

          image.url = uploaded.url
          if (!image.metadata) {
            image.metadata = {}
          }

          image.metadata.file_id = uploaded.fileId
          if (!image.metadata.source_url) {
            image.metadata.source_url = reference.originalUrl
          }
        })

        const thumbnailRef = thumbnailRefs.find(
          (ref) => ref.target === target && ref.productIndex === productIndex,
        )

        if (thumbnailRef) {
          const uploaded = uploadedMap.get(thumbnailRef.originalUrl)
          if (uploaded) {
            product.thumbnail = uploaded.url
          }
        }

        product.variants?.forEach((variant, variantIndex) => {
          const reference = variantRefs.find(
            (ref) =>
              ref.target === target &&
              ref.productIndex === productIndex &&
              ref.variantIndex === variantIndex,
          )

          if (!reference) {
            return
          }

          const uploaded = uploadedMap.get(reference.originalUrl)
          if (!uploaded) {
            return
          }

          if (!variant.metadata) {
            variant.metadata = {}
          }

          variant.metadata.image_url = uploaded.url
          variant.metadata.image_file_id = uploaded.fileId
          if (!variant.metadata.image_original_url) {
            variant.metadata.image_original_url = reference.originalUrl
          }
        })
      })
    }

    applyUploads(productsToCreate, "create")
    applyUploads(productsToUpdate, "update")

    return new StepResponse(
      {
        productsToCreate,
        productsToUpdate,
      },
      createdFileIds,
    )
  },
  async (createdFileIds, { container }) => {
    if (!createdFileIds?.length) {
      return
    }

    try {
      const fileService = container.resolve(Modules.FILE)
      await fileService.deleteFiles(createdFileIds)
    } catch {
      // ignore
    }
  },
)
