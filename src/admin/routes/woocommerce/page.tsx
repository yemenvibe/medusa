import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowDownTray } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  DataTable,
  Drawer,
  Heading,
  Toaster,
  createDataTableColumnHelper,
  useDataTable,
} from "@medusajs/ui"
import { HttpTypes } from "@medusajs/framework/types"
import { useQuery } from "@tanstack/react-query"
import { sdk } from "../../lib/sdk"
import { WooCommerceMigrationForm } from "../../components/woocommerce-migration-form"

const columnHelper = createDataTableColumnHelper<HttpTypes.AdminWorkflowExecution>()

const columns = [
  columnHelper.accessor("id", {
    header: "ID",
  }),
  columnHelper.accessor("workflow_id", {
    header: "Workflow ID",
  }),
  columnHelper.accessor("state", {
    header: "State",
    cell: ({ getValue }) => {
      const state = getValue()
      return (
        <Badge
          color={state === "done" ? "green" : state === "failed" ? "red" : "grey"}
          size="xsmall"
        >
          {state}
        </Badge>
      )
    },
  }),
  columnHelper.accessor("created_at", {
    header: "Date",
    cell: ({ getValue }) => {
      const date = new Date(getValue())
      return date.toLocaleDateString()
    },
  }),
]

const WooCommerceMigrationPage = () => {
  const { data, isLoading } = useQuery<{
    workflow_executions: HttpTypes.AdminWorkflowExecution[]
    count: number
  }>({
    queryFn: async () => sdk.client.fetch("/admin/woocommerce/migrations"),
    queryKey: ["woocommerce"],
  })

  const table = useDataTable({
    columns,
    data: data?.workflow_executions || [],
    getRowId: (row) => row.id,
    rowCount: data?.count || 0,
    isLoading,
  })

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col items-start justify-between gap-2 md:flex-row md:items-center">
          <Heading>WooCommerce Migrations</Heading>
          <Drawer>
            <Drawer.Trigger asChild>
              <Button>Migrate Data</Button>
            </Drawer.Trigger>
            <WooCommerceMigrationForm />
          </Drawer>
        </DataTable.Toolbar>
        <DataTable.Table />
      </DataTable>
      <Toaster />
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "WooCommerce Migration",
  icon: ArrowDownTray,
})

export default WooCommerceMigrationPage
