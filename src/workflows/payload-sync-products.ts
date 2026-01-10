import { isDefined, Modules, promiseAll } from "@medusajs/framework/utils";
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { FilterableProductProps } from "@medusajs/types";
import PayloadModuleService from "../modules/payload/service";

const step = createStep;
const wf = createWorkflow;

type Input = {
  product_ids?: string[];
};

const syncStep = step(
  { name: "syncStep", async: true },
  async (input: Input, { container }) => {
    const productModule = container.resolve(Modules.PRODUCT);
    const payloadModule: PayloadModuleService = container.resolve("payload");

    let total = 0;

    const batchSize = 200;
    let hasMore = true;
    let offset = 0;
    let filter: FilterableProductProps = {};
    if (isDefined(input.product_ids)) {
      filter.id = input.product_ids;
    }

    while (hasMore) {
      const [products, count] = await productModule.listAndCountProducts(filter, {
        select: ["id", "handle", "title"],
        skip: offset,
        take: batchSize,
        order: { id: "ASC" },
      });

      const results = await promiseAll(
        products.map((prod) => {
          return payloadModule.upsertSyncDocument("product", prod).catch((error) => {
            console.error(`Failed to sync product ${prod.id} (${prod.handle || prod.title}):`, error.message);
            return { error: true, productId: prod.id, errorMessage: error.message };
          });
        }),
      );

      const errors = results.filter((r: any) => r?.error);
      if (errors.length > 0) {
        console.warn(`Failed to sync ${errors.length} out of ${products.length} products in this batch`);
      }

      offset += batchSize;
      hasMore = offset < count;
      total += products.length;
    }

    return new StepResponse({ total });
  },
);

const id = "payload-product-sync";

export const payloadProductSyncWorkflow = wf(
  { name: id, retentionTime: 10000 },
  function (input: Input) {
    const result = syncStep(input);

    return new WorkflowResponse(result);
  },
);
