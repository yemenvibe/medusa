import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa";
import { payloadProductSyncWorkflow } from "../workflows/payload-sync-products";

export default async function upsertPayloadProduct({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  await payloadProductSyncWorkflow(container).run({
    input: {
      product_ids: [data.id],
    },
  });
}

export const config: SubscriberConfig = {
  event: ["product.created", "product.updated"],
};
