import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { payloadFullSyncWorkflow } from "../../../../workflows/payload-full-sync";

// Admin endpoint to trigger a full payload sync in parallel.
// Optional body can include arrays of IDs to scope syncing.
// POST /admin/payload/full-sync
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { product_ids, category_ids, collection_ids } = (req.body || {}) as {
    product_ids?: string[];
    category_ids?: string[];
    collection_ids?: string[];
  };

  const result = await payloadFullSyncWorkflow.run({
    input: { product_ids, category_ids, collection_ids },
  });

  const totals = (result as any)?.result || result
  return res.status(200).json({
    product_total: totals?.product_total?.total ?? totals?.product_total,
    category_total: totals?.category_total?.total ?? totals?.category_total,
    collection_total: totals?.collection_total?.total ?? totals?.collection_total,
  });
};
