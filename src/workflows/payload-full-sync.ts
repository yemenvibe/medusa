import {
  parallelize,
  createWorkflow as wf,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";

import { payloadCategorySyncWorkflow } from "./payload-sync-categories";
import { payloadCollectionSyncWorkflow } from "./payload-sync-collections";
import { payloadProductSyncWorkflow } from "./payload-sync-products";

type Input = {
  category_ids?: string[];
  product_ids?: string[];
  collection_ids?: string[];
};

const id = "payload-full-sync";

export const payloadFullSyncWorkflow = wf(
  { name: id, retentionTime: 10000 },
  function (input: Input) {
    const [product_total, category_total, collection_total] = parallelize(
      payloadProductSyncWorkflow.runAsStep({
        input: { product_ids: input.product_ids },
      }),
      payloadCategorySyncWorkflow.runAsStep({
        input: { category_ids: input.category_ids },
      }),
      payloadCollectionSyncWorkflow.runAsStep({
        input: { collection_ids: input.collection_ids },
      }),
    );

    return new WorkflowResponse({
      product_total,
      category_total,
      collection_total,
    });
  },
);
