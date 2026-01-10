import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { payloadCategorySyncWorkflow } from "../workflows/payload-sync-categories";

export default async function upsertPayloadCategory({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  await payloadCategorySyncWorkflow(container).run({
    input: {
      category_ids: [data.id],
    },
  });
}

export const config: SubscriberConfig = {
  event: ["product-category.created", "product-category.updated"],
};
