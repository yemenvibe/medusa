export type WooCommerceCategory = {
  id: number
  name: string
  slug: string
  parent?: number
}

export type WooCommerceImage = {
  id: number
  src: string
  name?: string
  alt?: string
  position?: number
}

export type WooCommerceAttribute = {
  id: number
  name: string
  options: string[]
}

export type WooCommerceProduct = {
  id: number
  name: string
  slug: string
  status: string
  type: string
  sku: string | null
  description: string
  short_description: string
  price: string
  regular_price: string
  sale_price?: string
  categories: WooCommerceCategory[]
  images: WooCommerceImage[]
  attributes: WooCommerceAttribute[]
  default_attributes?: Array<{
    id?: number
    name: string
    option: string
  }>
  stock_status?: string
  stock_quantity?: number | null
}

export type WooCommerceVariation = {
  id: number
  sku: string | null
  description: string
  price: string
  regular_price: string
  sale_price?: string
  stock_status?: string
  stock_quantity?: number | null
  image?: WooCommerceImage | null
  attributes: Array<{
    id?: number
    name: string
    option: string
  }>
}

export type WooCommerceProductWithRelations = WooCommerceProduct & {
  variations?: WooCommerceVariation[]
}

export type WooCommercePagination = {
  total: number
  totalPages: number
  currentPage: number
  pageSize: number
  hasMore: boolean
}
