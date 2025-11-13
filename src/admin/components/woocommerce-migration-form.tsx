import { Button, Checkbox, Drawer, Label, toast } from "@medusajs/ui"
import { Controller, FormProvider, useForm } from "react-hook-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../lib/sdk"

type FormValues = {
  current_page: number
  page_size: number
  sync_all_pages: boolean
  type: Array<"product" | "category">
}

const parsePositiveInteger = (value: number, fallback: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback
  }

  return Math.floor(value)
}

export const WooCommerceMigrationForm = () => {
  const queryClient = useQueryClient()
  const form = useForm<FormValues>({
    defaultValues: {
      current_page: 1,
      page_size: 100,
      sync_all_pages: true,
      type: ["product", "category"],
    },
  })

  const toggleType = (entry: "product" | "category") => {
    const current = form.getValues("type") || []
    if (current.includes(entry)) {
      form.setValue(
        "type",
        current.filter((value) => value !== entry),
      )
    } else {
      form.setValue("type", [...current, entry])
    }
  }

  const { mutateAsync, isLoading } = useMutation({
    mutationFn: async () => {
      const values = form.getValues()

      return sdk.client.fetch("/admin/woocommerce/migrations", {
        method: "post",
        body: {
          current_page: parsePositiveInteger(values.current_page, 1),
          page_size: parsePositiveInteger(values.page_size, 100),
          sync_all_pages: Boolean(values.sync_all_pages),
          type: values.type?.length ? values.type : ["product"],
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["woocommerce"],
      })
      toast.success("WooCommerce migration started")
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const handleSubmit = form.handleSubmit(async () => {
    await mutateAsync()
  })

  return (
    <Drawer.Content>
      <FormProvider {...form}>
        <form onSubmit={handleSubmit} className="flex h-full flex-col overflow-hidden">
          <Drawer.Header>
            <Drawer.Title>Migrate Data from WooCommerce</Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-4 p-4">
            <Controller
              control={form.control}
              name="type"
              render={({ field }) => (
                <div className="flex flex-col gap-2">
                  <Label size="small" weight="plus">
                    Entities
                  </Label>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="type-products"
                      checked={field.value?.includes("product")}
                      onCheckedChange={() => toggleType("product")}
                    />
                    <Label htmlFor="type-products">Products</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="type-categories"
                      checked={field.value?.includes("category")}
                      onCheckedChange={() => toggleType("category")}
                    />
                    <Label htmlFor="type-categories">Categories</Label>
                  </div>
                </div>
              )}
            />
            <Controller
              control={form.control}
              name="current_page"
              render={({ field }) => (
                <div className="flex flex-col gap-2">
                  <Label size="small" weight="plus">
                    Starting Page
                  </Label>
                  <input
                    type="number"
                    min={1}
                    className="h-9 rounded-md border border-ui-border-base bg-ui-bg-field px-3 text-ui-fg-base outline-none"
                    value={field.value}
                    onChange={(event) =>
                      field.onChange(parsePositiveInteger(Number(event.target.value), 1))
                    }
                  />
                </div>
              )}
            />
            <Controller
              control={form.control}
              name="page_size"
              render={({ field }) => (
                <div className="flex flex-col gap-2">
                  <Label size="small" weight="plus">
                    Page Size
                  </Label>
                  <input
                    type="number"
                    min={1}
                    className="h-9 rounded-md border border-ui-border-base bg-ui-bg-field px-3 text-ui-fg-base outline-none"
                    value={field.value}
                    onChange={(event) =>
                      field.onChange(parsePositiveInteger(Number(event.target.value), 100))
                    }
                  />
                </div>
              )}
            />
            <Controller
              control={form.control}
              name="sync_all_pages"
              render={({ field }) => (
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="sync-all-pages"
                    checked={field.value}
                    onCheckedChange={(value) => field.onChange(Boolean(value))}
                  />
                  <Label htmlFor="sync-all-pages">Process all pages</Label>
                </div>
              )}
            />
          </Drawer.Body>
          <Drawer.Footer>
            <div className="flex items-center justify-end gap-x-2">
              <Drawer.Close asChild>
                <Button size="small" variant="secondary">
                  Cancel
                </Button>
              </Drawer.Close>
              <Drawer.Close asChild>
                <Button type="submit" size="small" disabled={isLoading}>
                  {isLoading ? "Starting..." : "Migrate"}
                </Button>
              </Drawer.Close>
            </div>
          </Drawer.Footer>
        </form>
      </FormProvider>
    </Drawer.Content>
  )
}
