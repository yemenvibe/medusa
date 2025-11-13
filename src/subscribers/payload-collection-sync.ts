import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa";
import { payloadCollectionSyncWorkflow } from "../workflows/payload-sync-collections";

export default async function upsertPayloadCollection({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  await payloadCollectionSyncWorkflow(container).run({
    input: {
      collection_ids: [data.id],
    },
  });
}

export const config: SubscriberConfig = {
  event: ["product-collection.created", "product-collection.updated"],
};
