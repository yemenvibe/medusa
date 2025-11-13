import { MedusaError } from "@medusajs/framework/utils"
import {
  WooCommerceProduct,
  WooCommerceProductWithRelations,
  WooCommerceVariation,
  WooCommercePagination,
  WooCommerceCategory,
} from "./types"

export type WooCommerceModuleOptions = {
  baseUrl: string
  consumerKey: string
  consumerSecret: string
  apiVersion?: string
  defaultPageSize?: number
  requestTimeoutMs?: number
  requestRetries?: number
}

type RequestOptions<T = unknown> = {
  path: string
  searchParams?: Record<string, string | number | undefined>
  defaultValue?: T
}

export default class WooCommerceModuleService {
  protected readonly options: Required<Omit<WooCommerceModuleOptions, "defaultPageSize" | "requestTimeoutMs">> & {
    defaultPageSize: number
    requestTimeoutMs: number
    requestRetries: number
  }

  constructor({}, options: WooCommerceModuleOptions) {
    if (!options?.baseUrl || !options?.consumerKey || !options?.consumerSecret) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "WooCommerce module requires baseUrl, consumerKey, and consumerSecret options",
      )
    }

    const sanitizedBaseUrl = options.baseUrl.replace(/\/$/, "")

    this.options = {
      baseUrl: sanitizedBaseUrl,
      consumerKey: options.consumerKey,
      consumerSecret: options.consumerSecret,
      apiVersion: options.apiVersion || "wc/v3",
      defaultPageSize: options.defaultPageSize ?? 100,
      requestTimeoutMs:
        options.requestTimeoutMs ??
        (process.env.WOOCOMMERCE_REQUEST_TIMEOUT_MS
          ? Number(process.env.WOOCOMMERCE_REQUEST_TIMEOUT_MS)
          : 25000),
      requestRetries:
        options.requestRetries ??
        (process.env.WOOCOMMERCE_REQUEST_RETRIES
          ? Number(process.env.WOOCOMMERCE_REQUEST_RETRIES)
          : 2),
    }
  }

  private buildUrl({ path, searchParams }: RequestOptions): URL {
    const url = new URL(
      path.startsWith("http")
        ? path
        : `${this.options.baseUrl}/wp-json/${this.options.apiVersion}${path}`,
    )

    url.searchParams.set("consumer_key", this.options.consumerKey)
    url.searchParams.set("consumer_secret", this.options.consumerSecret)

    if (searchParams) {
      for (const [key, value] of Object.entries(searchParams)) {
        if (value === undefined || value === null) {
          continue
        }
        url.searchParams.set(key, String(value))
      }
    }

    return url
  }

  private async fetchJson<T>({ path, searchParams, defaultValue }: RequestOptions<T>): Promise<{
    data: T
    headers: Headers
  }> {
    const url = this.buildUrl({ path, searchParams })
    let lastError: unknown

    for (let attempt = 0; attempt <= this.options.requestRetries; attempt += 1) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.options.requestTimeoutMs)

      try {
        const response = await fetch(url, {
          headers: {
            Accept: "application/json",
          },
          signal: controller.signal,
        })
        clearTimeout(timeout)

        if (!response.ok) {
          const text = await response.text()
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `WooCommerce request to ${url.pathname} failed (${response.status}): ${text}`,
          )
        }

        if (response.status === 204) {
          return {
            data: (defaultValue as T) ?? (undefined as T),
            headers: response.headers,
          }
        }

        const contentType = response.headers.get("content-type") || ""
        const rawBody = await response.text()

        if (!rawBody.trim()) {
          return {
            data: (defaultValue as T) ?? (undefined as T),
            headers: response.headers,
          }
        }

        if (!contentType.toLowerCase().includes("application/json")) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `Expected JSON from WooCommerce but received '${contentType}' with payload: ${rawBody.slice(0, 200)}`,
          )
        }

        try {
          const parsed = JSON.parse(rawBody) as T
          return { data: parsed, headers: response.headers }
        } catch (error) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `Unable to parse WooCommerce response from ${url.pathname}: ${(error as Error).message}. Raw payload: ${rawBody.slice(0, 200)}`,
          )
        }
      } catch (error) {
        clearTimeout(timeout)
        lastError = error

        const isAbort =
          error instanceof DOMException && error.name === "AbortError"
            ? true
            : (error as { name?: string }).name === "AbortError"

        if (!isAbort || attempt === this.options.requestRetries) {
          throw error
        }

        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `WooCommerce request to ${url.pathname} timed out (attempt ${
              attempt + 1
            }/${this.options.requestRetries + 1}). Retrying...`,
          )
        }
      }
    }

    throw lastError ?? new Error(`WooCommerce request to ${path} failed after retries`)
  }

  async getCategories(options?: {
    page?: number
    pageSize?: number
  }): Promise<{ categories: WooCommerceCategory[]; pagination: WooCommercePagination }> {
    const page = options?.page ?? 1
    const pageSize = options?.pageSize ?? this.options.defaultPageSize

    const { data, headers } = await this.fetchJson<WooCommerceCategory[]>({
      path: "/products/categories",
      searchParams: {
        per_page: pageSize,
        page,
        orderby: "id",
      },
      defaultValue: [],
    })

    const total = Number(headers.get("x-wp-total") || data.length)
    const totalPages = Number(headers.get("x-wp-totalpages") || 1)

    return {
      categories: data,
      pagination: {
        total,
        totalPages,
        currentPage: page,
        pageSize,
        hasMore: page < totalPages,
      },
    }
  }

  async getProducts(options?: {
    page?: number
    pageSize?: number
    status?: string
    context?: string
  }): Promise<{
    products: WooCommerceProductWithRelations[]
    pagination: WooCommercePagination
  }> {
    const page = options?.page ?? 1
  const pageSize = Math.min(options?.pageSize ?? this.options.defaultPageSize, 100)
  const statusEnv = process.env.WOOCOMMERCE_PRODUCTS_STATUS
  const statusCandidate = options?.status ?? statusEnv
  const status = statusCandidate && statusCandidate.trim().length ? statusCandidate.trim() : undefined

  const context = process.env.WOOCOMMERCE_PRODUCTS_CONTEXT || options?.context || "view"

    const strategies: Array<Record<string, string | number>> = []
    const seen = new Set<string>()

    const addStrategy = (extra?: Record<string, string | number | undefined>) => {
      const base: Record<string, string | number | undefined> = {
        per_page: pageSize,
        page,
        orderby: "date",
        order: "desc",
        status: status ?? "publish",
        context,
      }

      if (extra) {
        for (const [key, value] of Object.entries(extra)) {
          base[key] = value
        }
      }

      const sanitized: Record<string, string | number> = {}
      for (const [key, value] of Object.entries(base)) {
        if (value === undefined || value === null || value === "") {
          continue
        }
        sanitized[key] = value
      }

      const fingerprint = JSON.stringify(Object.entries(sanitized).sort())
      if (seen.has(fingerprint)) {
        return
      }

      seen.add(fingerprint)
      strategies.push(sanitized)
    }

    addStrategy({})
    addStrategy({ context: "view" })
    addStrategy({ context: "edit" })
    addStrategy({ orderby: "date", order: "desc" })

    let finalData: WooCommerceProduct[] = []
    let finalHeaders: Headers | undefined
    let usedStrategy: Record<string, string | number> | undefined

    for (const params of strategies) {
      const { data, headers } = await this.fetchJson<WooCommerceProduct[]>({
        path: "/products",
        searchParams: params,
        defaultValue: [],
      })

      if (
        Array.isArray(data) &&
        data.length === 0 &&
        Number(headers.get("x-wp-total") || 0) > 0 &&
        params.status
      ) {
        continue
      }

      finalData = data
      finalHeaders = headers
      usedStrategy = params

      const totalHeader = Number(headers.get("x-wp-total") || 0)
      const hasResults = Array.isArray(data) && data.length > 0

      if (process.env.NODE_ENV !== "production") {
        console.log(
          `WooCommerce products fetch (strategy=${JSON.stringify(params)}): received=${
            Array.isArray(data) ? data.length : "n/a"
          }, total_header=${totalHeader}`,
        )
      }

      if (hasResults || totalHeader <= 0) {
        break
      }
    }

    const total = Number(finalHeaders?.get("x-wp-total") || finalData.length)
    const totalPages = Number(finalHeaders?.get("x-wp-totalpages") || 1)

    if (process.env.NODE_ENV !== "production" && total > 0 && finalData.length === 0) {
      console.warn(
        "WooCommerce product fetch returned empty data despite total>0. Last strategy:",
        usedStrategy,
      )
    }

    const variableProducts = finalData.filter((product) => product.type === "variable")
    const variationMap = new Map<number, WooCommerceVariation[]>()

    const variationConcurrency = Number(process.env.WOOCOMMERCE_VARIATION_CONCURRENCY ?? 5)
    const chunkSize = Number.isFinite(variationConcurrency) && variationConcurrency > 0 ? variationConcurrency : 5

    for (let i = 0; i < variableProducts.length; i += chunkSize) {
      const batch = variableProducts.slice(i, i + chunkSize)
      await Promise.all(
        batch.map(async (product) => {
          const variations = await this.getAllVariations(product.id)
          variationMap.set(product.id, variations)
        }),
      )
    }

  const products: WooCommerceProductWithRelations[] = finalData.map((product) => ({
      ...product,
      variations: variationMap.get(product.id) || [],
    }))

    return {
      products,
      pagination: {
        total,
        totalPages,
        currentPage: page,
        pageSize,
        hasMore: page < totalPages,
      },
    }
  }

  private async getAllVariations(productId: number): Promise<WooCommerceVariation[]> {
    const results: WooCommerceVariation[] = []
    let page = 1
    const pageSize = this.options.defaultPageSize

    while (true) {
      const { data, headers } = await this.fetchJson<WooCommerceVariation[]>({
        path: `/products/${productId}/variations`,
        searchParams: {
          per_page: pageSize,
          page,
          orderby: "id",
        },
        defaultValue: [],
      })

      results.push(...data)

      const totalPages = Number(headers.get("x-wp-totalpages") || 1)
      if (page >= totalPages || !data.length) {
        break
      }

      page += 1
    }

    return results
  }
}
