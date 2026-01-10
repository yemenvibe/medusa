import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Button, Checkbox, Container, Heading, Label, toast } from "@medusajs/ui"
import { useMutation } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { sdk } from "../../../lib/sdk"

type SyncPayload = {
  sync_products: boolean
  sync_categories: boolean
  sync_collections: boolean
  page?: number
  limit?: number
}

const PayloadSettingsPage = () => {
  const [entities, setEntities] = useState({
    products: true,
    categories: true,
    collections: true,
  })
  const [pageInput, setPageInput] = useState("1")
  const [limitInput, setLimitInput] = useState("")

  const parsePositiveInteger = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const num = Number(trimmed)
    if (!Number.isFinite(num) || num <= 0) return undefined
    return Math.floor(num)
  }

  const toggleEntity = (key: keyof typeof entities) => {
    setEntities((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  const selectedCount = useMemo(() => Object.values(entities).filter(Boolean).length, [entities])
  const nothingSelected = selectedCount === 0
  const limitValue = useMemo(() => parsePositiveInteger(limitInput), [limitInput])
  const pageValue = useMemo(() => parsePositiveInteger(pageInput), [pageInput])
  const limitError = limitInput.trim().length > 0 && typeof limitValue === "undefined"
  const pageError =
    limitInput.trim().length > 0 && pageInput.trim().length > 0 && typeof pageValue === "undefined"
  const disableSync = nothingSelected || limitError || pageError

  useEffect(() => {
    if (!limitInput.trim().length) {
      setPageInput("1")
    }
  }, [limitInput])

  const { 
    mutateAsync: syncProductsToPayload,
    isPending: isSyncingProductsToPayload,
  } = useMutation({
    mutationFn: async (payload: SyncPayload) => {
      if (!payload.sync_products && !payload.sync_categories && !payload.sync_collections) {
        throw new Error("Select at least one entity to sync.")
      }

      return sdk.client.fetch(`/admin/payload/full-sync/`, {
        method: "POST",
        body: payload,
      })
    },
    onSuccess: () => toast.success(`Triggered syncing selected data with Payload`),
    onError: (err: Error) => toast.error(err.message),
  })

  const handleSync = () => {
    const payload: SyncPayload = {
      sync_products: entities.products,
      sync_categories: entities.categories,
      sync_collections: entities.collections,
    }

    if (typeof limitValue !== "undefined") {
      payload.limit = limitValue
      payload.page = typeof pageValue !== "undefined" ? pageValue : 1
    }

    void syncProductsToPayload(payload)
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h1">Payload Settings</Heading>
      </div>
      <div className="flex flex-col gap-4 px-6 py-4">
        <p>
          This page allows you to trigger syncing your Medusa data with Payload. It
          will only create items not in Payload.
        </p>
        <div className="flex flex-col gap-3 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
          <Label size="small" weight="plus">
            Entities
          </Label>
          <div className="flex flex-col gap-2 text-sm text-ui-fg-base">
            <div className="flex items-center gap-2">
              <Checkbox
                id="entity-products"
                checked={entities.products}
                onCheckedChange={() => toggleEntity("products")}
                disabled={isSyncingProductsToPayload}
              />
              <Label htmlFor="entity-products">Products</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="entity-categories"
                checked={entities.categories}
                onCheckedChange={() => toggleEntity("categories")}
                disabled={isSyncingProductsToPayload}
              />
              <Label htmlFor="entity-categories">Categories</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="entity-collections"
                checked={entities.collections}
                onCheckedChange={() => toggleEntity("collections")}
                disabled={isSyncingProductsToPayload}
              />
              <Label htmlFor="entity-collections">Collections</Label>
            </div>
          </div>
          {nothingSelected && (
            <p className="text-xs text-ui-fg-subtle">Select at least one entity to sync.</p>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label size="small" weight="plus" htmlFor="payload-limit">
              Limit
            </Label>
            <input
              id="payload-limit"
              type="number"
              min={1}
              className="h-9 rounded-md border border-ui-border-base bg-ui-bg-field px-3 text-ui-fg-base outline-none"
              value={limitInput}
              onChange={(event) => setLimitInput(event.target.value)}
              placeholder="Leave empty to sync all"
              disabled={isSyncingProductsToPayload}
            />
            {limitError && (
              <p className="text-xs text-ui-fg-danger">
                Enter a positive number or clear the limit to sync everything.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label size="small" weight="plus" htmlFor="payload-page">
              Page
            </Label>
            <input
              id="payload-page"
              type="number"
              min={1}
              className="h-9 rounded-md border border-ui-border-base bg-ui-bg-field px-3 text-ui-fg-base outline-none"
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              disabled={isSyncingProductsToPayload || !limitInput.trim().length}
            />
            <p className="text-xs text-ui-fg-subtle">
              Applies when limit is set. Page is 1-based.
            </p>
            {pageError && (
              <p className="text-xs text-ui-fg-danger">
                Enter a positive page number or leave the field blank.
              </p>
            )}
          </div>
        </div>
        <Button
          variant="primary"
          onClick={handleSync}
          isLoading={isSyncingProductsToPayload}
          disabled={disableSync}
        >
          Sync Selected Data to Payload
        </Button>
         
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Payload",
})

export default PayloadSettingsPage