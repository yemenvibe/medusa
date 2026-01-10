/* eslint-disable @typescript-eslint/no-explicit-any */
// PayloadModuleService: syncs Medusa entities into a Payload CMS instance via REST.
// Config via constructor options: { serverUrl, apiKey, type_map? }
export default class PayloadModuleService {
  private baseUrl: string
  private apiKey?: string
  private typeMap: Record<string, string>
  private userCollection?: string

  constructor(_: any, options: { serverUrl: string; apiKey?: string; type_map?: Record<string, string>; userCollection?: string }) {
    if (!options || !options.serverUrl) {
      throw new Error('PayloadModuleService requires options.serverUrl')
    }

    const raw = String(options.serverUrl).trim()
    const withProto = /^(https?:)?\/\//i.test(raw) ? raw : `https://${raw}`
    let normalized: string
    try {
      const u = new URL(withProto)
      normalized = `${u.protocol}//${u.host}${u.pathname}`.replace(/\/$/, '')
    } catch (e) {
      throw new Error(`Invalid Payload serverUrl '${options.serverUrl}': ${(e as Error).message}`)
    }
    // Payload REST is mounted under /api
    this.baseUrl = `${normalized}/api`
    this.apiKey = options.apiKey
    this.userCollection = options.userCollection
    
    console.log(`PayloadModuleService initialized with baseUrl: ${this.baseUrl}`, {
      serverUrl: options.serverUrl,
      normalized,
      hasApiKey: !!this.apiKey,
      userCollection: this.userCollection,
    })
    this.typeMap = Object.assign(
      {
        product: 'products',
        category: 'categories',
        collection: 'collections',
      },
      options.type_map || {},
    )
  }

  private _fetch = (globalThis as any).fetch || (() => {
    // lazy require to avoid crashing if project doesn't have node-fetch
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nf = require('node-fetch')
    return nf
  })()

  private normalizeHandle(value?: string | null) {
    if (!value) {
      return undefined
    }

    const trimmed = value.trim().toLowerCase()
    if (!trimmed) {
      return undefined
    }

    const normalized = trimmed
      .replace(/https?:\/\/[^/]+/g, "")
      .replace(/[^a-z0-9/]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/\/+/g, "/")
      .replace(/^-+|-+$/g, "")
      .replace(/^\/+/g, "")
      .replace(/\/+$/g, "")

    if (!normalized) {
      return undefined
    }

    const truncated = normalized.slice(0, 120)

    return truncated.replace(/-+$/g, "")
  }

  private normalizePathname(value?: string | null) {
    if (!value) {
      return undefined
    }

    const handle = this.normalizeHandle(value)
    if (!handle) {
      return undefined
    }

    return handle.startsWith('/') ? handle : `/${handle}`
  }

  private headers() {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    
    // Use Payload API-Key header format: "<userCollection> API-Key <token>"
    if (this.apiKey) h['Authorization'] = `${this.userCollection || 'users'} API-Key ${this.apiKey}`
    return h
  }

  private async getCollectionDoc(
    collection: string,
    lookup: string | {
      medusaId?: string | null
      pathname?: string | null
      directId?: string | null
    },
  ) {
    const medusaId = typeof lookup === 'string' ? lookup : lookup?.medusaId ?? lookup?.directId ?? undefined
    const pathname = typeof lookup === 'string' ? undefined : lookup?.pathname ?? undefined
    const directId = typeof lookup === 'string' ? lookup : lookup?.directId ?? lookup?.medusaId ?? undefined

    const queries: Array<{ field: string; value: string }> = []

    if (medusaId) {
      queries.push({ field: 'medusa_id', value: medusaId })
    }

    if (pathname) {
      queries.push({ field: 'pathname', value: pathname })
    }

    for (const query of queries) {
      const searchUrl = `${this.baseUrl}/${collection}?where[${query.field}][equals]=${encodeURIComponent(query.value)}`
      try {
        const res = await this._fetch(searchUrl, { 
          method: 'GET', 
          headers: this.headers(),
          signal: AbortSignal.timeout(10000), // 10 second timeout for lookups
        })
        if (res.ok) {
          const json = await res.json()
          if (json?.docs && json.docs.length) return json.docs[0]
          if (Array.isArray(json) && json.length) return json[0]
        }
      } catch (e) {
        // ignore and try next lookup
      }
    }

    if (!directId) {
      return null
    }

    try {
      const directUrl = `${this.baseUrl}/${collection}/${encodeURIComponent(directId)}`
      const res = await this._fetch(directUrl, { 
        method: 'GET', 
        headers: this.headers(),
        signal: AbortSignal.timeout(10000), // 10 second timeout for lookups
      })
      if (!res.ok) return null
      return res.json()
    } catch (e) {
      return null
    }
  }

  private resolveLookup(type: string, data: any) {
    const lookup: { medusaId?: string; pathname?: string; directId?: string } = {
      medusaId: data?.id,
      directId: data?.id,
    }

    if (!data) {
      return lookup
    }

    switch (type) {
      case 'product':
        if (typeof data.pathname === 'string' && data.pathname.trim()) {
          lookup.pathname = this.normalizePathname(data.pathname)
        } else if (data.handle) {
          const normalizedHandle = this.normalizeHandle(data.handle)
          lookup.pathname = normalizedHandle ? `/products/${normalizedHandle}` : `/products/${data.handle}`
        } else if (data.slug) {
          const normalizedHandle = this.normalizeHandle(data.slug)
          lookup.pathname = normalizedHandle ? `/products/${normalizedHandle}` : `/products/${data.slug}`
        }
        break
      case 'category':
        if (typeof data.pathname === 'string' && data.pathname.trim()) {
          lookup.pathname = this.normalizePathname(data.pathname)
        } else if (data.handle) {
          const normalizedHandle = this.normalizeHandle(data.handle)
          lookup.pathname = normalizedHandle
            ? `/categories/${normalizedHandle}`
            : `/categories/${data.handle}`
        }
        break
      case 'collection':
        if (typeof data.pathname === 'string' && data.pathname.trim()) {
          lookup.pathname = this.normalizePathname(data.pathname)
        } else if (data.handle) {
          const normalizedHandle = this.normalizeHandle(data.handle)
          lookup.pathname = normalizedHandle
            ? `/collections/${normalizedHandle}`
            : `/collections/${data.handle}`
        }
        break
      default:
        break
    }

    return lookup
  }

  private withMedusaQuery(url: string) {
    return url.includes('?') ? `${url}&is_from_medusa=true` : `${url}?is_from_medusa=true`
  }

  private async createCollectionDoc(collection: string, data: any) {
    const url = this.withMedusaQuery(`${this.baseUrl}/${collection}`)
    
    try {
      const res = await this._fetch(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(30000), // 30 second timeout
      })
      
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(`Payload create error ${res.status}: ${txt}`)
      }
      return res.json()
    } catch (error: any) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        console.error(`Payload fetch timeout for ${url}`, { collection, productId: data?.medusa_id })
        throw new Error(`Payload request timeout: Unable to reach Payload CMS at ${this.baseUrl}. Check PAYLOAD_SERVER_URL and network connectivity.`)
      }
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.message?.includes('fetch failed')) {
        console.error(`Payload fetch failed for ${url}`, { 
          error: error.message, 
          code: error.code,
          collection,
          productId: data?.medusa_id,
          baseUrl: this.baseUrl
        })
        throw new Error(`Payload connection failed: Unable to reach Payload CMS at ${this.baseUrl}. Error: ${error.message}. Check PAYLOAD_SERVER_URL environment variable.`)
      }
      throw error
    }
  }

  private async updateCollectionDoc(collection: string, id: string, data: any) {
    const url = this.withMedusaQuery(`${this.baseUrl}/${collection}/${encodeURIComponent(id)}`)
    
    try {
      const res = await this._fetch(url, {
        method: 'PATCH',
        headers: this.headers(),
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(30000), // 30 second timeout
      })
      
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(`Payload update error ${res.status}: ${txt}`)
      }
      return res.json()
    } catch (error: any) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        console.error(`Payload fetch timeout for ${url}`, { collection, id })
        throw new Error(`Payload request timeout: Unable to reach Payload CMS at ${this.baseUrl}`)
      }
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.message?.includes('fetch failed')) {
        console.error(`Payload fetch failed for ${url}`, { 
          error: error.message, 
          code: error.code,
          collection,
          id,
          baseUrl: this.baseUrl
        })
        throw new Error(`Payload connection failed: Unable to reach Payload CMS at ${this.baseUrl}. Error: ${error.message}`)
      }
      throw error
    }
  }

  private async deleteCollectionDoc(collection: string, id: string) {
    const url = this.withMedusaQuery(`${this.baseUrl}/${collection}/${encodeURIComponent(id)}`)
    
    try {
      const res = await this._fetch(url, { 
        method: 'DELETE', 
        headers: this.headers(),
        signal: AbortSignal.timeout(30000), // 30 second timeout
      })
      
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(`Payload delete error ${res.status}: ${txt}`)
      }
      return res.json()
    } catch (error: any) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        console.error(`Payload fetch timeout for ${url}`, { collection, id })
        throw new Error(`Payload request timeout: Unable to reach Payload CMS at ${this.baseUrl}`)
      }
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.message?.includes('fetch failed')) {
        console.error(`Payload fetch failed for ${url}`, { 
          error: error.message, 
          code: error.code,
          collection,
          id,
          baseUrl: this.baseUrl
        })
        throw new Error(`Payload connection failed: Unable to reach Payload CMS at ${this.baseUrl}. Error: ${error.message}`)
      }
      throw error
    }
  }

  async upsertSyncDocument(type: string, data: any) {
    const collection = this.typeMap[type] || type
    const existing = await this.getCollectionDoc(collection, this.resolveLookup(type, data))
    if (existing) return this.updateSyncDocument(type, data)
    return this.createSyncDocument(type, data)
  }

  async createSyncDocument(type: string, data: any) {
    const collection = this.typeMap[type] || type
    const doc = this.transformForCreate(type, data)
    return this.createCollectionDoc(collection, doc)
  }

  async updateSyncDocument(type: string, data: any) {
    const collection = this.typeMap[type] || type
    // Retrieve the existing doc first to get its internal id
    const existing = await this.getCollectionDoc(collection, this.resolveLookup(type, data))
    if (!existing) {
      return this.createSyncDocument(type, data)
    }
    const internalId = existing.id || existing._id
    const doc = this.transformForUpdate(type, data)
    return this.updateCollectionDoc(collection, internalId, doc)
  }

  async deleteSyncDocument(type: string, id: string) {
  const collection = this.typeMap[type] || type
  // Look up internal Payload id via external medusa_id first
  const existing = await this.getCollectionDoc(collection, { medusaId: id, directId: id })
    if (!existing) return null
    const internalId = existing.id || existing._id
    return this.deleteCollectionDoc(collection, internalId)
  }

  __joinerConfig() {
    return {
      serviceName: 'payload',
      primaryKeys: ['id'],
      linkableKeys: {},
      alias: [{ name: 'payload' }],
    }
  }

  // Studio/admin link helper removed: studioUrl is no longer managed here

  async list(filter: any, config: any) {
    const extractIds = (value: any): string[] => {
      if (!value) {
        return []
      }

      if (Array.isArray(value)) {
        return value.map((entry) => String(entry)).filter((entry) => entry.length > 0)
      }

      if (typeof value === 'object') {
        if (value.$in) {
          return extractIds(value.$in)
        }
        if (value.$eq) {
          return extractIds(value.$eq)
        }
        if (value.equals) {
          return extractIds(value.equals)
        }
      }

      return [String(value)]
    }

    const ids = extractIds(filter?.id)
    const medusaIds = extractIds(filter?.medusa_id || filter?.medusaId)

    const searchIds = ids.length ? ids : medusaIds
    if (!searchIds.length) {
      return []
    }

    const uniqueIds = Array.from(new Set(searchIds))
    const results: any[] = []
    const collection = (config && config.type) || 'products'

    for (const id of uniqueIds) {
      const doc = await this.getCollectionDoc(collection, { medusaId: id, directId: id })
      if (doc) {
        results.push({ id: doc._id ?? doc.id, ...doc })
      }
    }

    return results
  }

  private transformForCreate(type: string, data: any) {
    // Minimal default transforms; adjust per project to map additional fields
    switch (type) {
      case 'product':
        return {
          medusa_id: data.id,
          internalTitle: data.title || data.name,
          pathname: `/products/${data.handle}`,
        }
      case 'category':
        return {
          medusa_id: data.id,
          internalTitle: data.name,
          pathname: `/categories/${data.handle}`,
        }
      case 'collection':
        return {
          medusa_id: data.id,
          internalTitle: data.title,
          pathname: `/collections/${data.handle}`,
        }
      default:
        return Object.assign({ medusa_id: data.id }, data)
    }
  }

  private transformForUpdate(type: string, data: any) {
    switch (type) {
      case 'product':
        return {
          internalTitle: data.title || data.name,
          pathname: `/products/${data.handle}`,
        }
      case 'category':
        return {
          internalTitle: data.name,
          pathname: `/categories/${data.handle}`,
        }
      case 'collection':
        return {
          internalTitle: data.title,
          pathname: `/collections/${data.handle}`,
        }
      default:
        return data
    }
  }
}
