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
    // Payload REST is mounted under /api
    this.baseUrl = `${options.serverUrl.replace(/\/$/, '')}/api`
    this.apiKey = options.apiKey
    this.userCollection = options.userCollection
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

  private headers() {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    
    // Use Payload API-Key header format: "<userCollection> API-Key <token>"
    if (this.apiKey) h['Authorization'] = `${this.userCollection || 'users'} API-Key ${this.apiKey}`
    return h
  }

  private async getCollectionDoc(collection: string, id: string) {
    // Prefer searching by external id (medusa_id). Direct-by-id would require internal Payload id.
    const searchUrl = `${this.baseUrl}/${collection}?where[medusa_id][equals]=${encodeURIComponent(id)}`
    try {
      const res = await this._fetch(searchUrl, { method: 'GET', headers: this.headers() })
      if (!res.ok) return null
      const json = await res.json()
      if (json?.docs && json.docs.length) return json.docs[0]
      if (Array.isArray(json) && json.length) return json[0]
    } catch (e) {
      // swallow and return null so caller can create
    }
    return null
  }

  private withMedusaQuery(url: string) {
    return url.includes('?') ? `${url}&is_from_medusa=true` : `${url}?is_from_medusa=true`
  }

  private async createCollectionDoc(collection: string, data: any) {
    const url = this.withMedusaQuery(`${this.baseUrl}/${collection}`)
    const res = await this._fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Payload create error ${res.status}: ${txt}`)
    }
    return res.json()
  }

  private async updateCollectionDoc(collection: string, id: string, data: any) {
    const url = this.withMedusaQuery(`${this.baseUrl}/${collection}/${encodeURIComponent(id)}`)
    const res = await this._fetch(url, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Payload update error ${res.status}: ${txt}`)
    }
    return res.json()
  }

  private async deleteCollectionDoc(collection: string, id: string) {
    const url = this.withMedusaQuery(`${this.baseUrl}/${collection}/${encodeURIComponent(id)}`)
    const res = await this._fetch(url, { method: 'DELETE', headers: this.headers() })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Payload delete error ${res.status}: ${txt}`)
    }
    return res.json()
  }

  async upsertSyncDocument(type: string, data: any) {
    const collection = this.typeMap[type] || type
    const existing = await this.getCollectionDoc(collection, data.id)
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
    const existing = await this.getCollectionDoc(collection, data.id)
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
    const existing = await this.getCollectionDoc(collection, id)
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
    if (!filter?.id) throw new Error('list requires filter.id (array of ids)')
    const ids: string[] = Array.isArray(filter.id) ? filter.id : [filter.id]
    const results: any[] = []
    const collection = (config && config.type) || 'products'
    for (const id of ids) {
      const doc = await this.getCollectionDoc(collection, id)
      if (doc) results.push({ id: doc._id ?? doc.id, ...doc })
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
