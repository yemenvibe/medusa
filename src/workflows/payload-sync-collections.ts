import { isDefined, Modules, promiseAll } from "@medusajs/framework/utils";
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { FilterableProductCollectionProps } from "@medusajs/types";
import PayloadModuleService from "../modules/payload/service";

const step = createStep;
const wf = createWorkflow;

type Input = {
  collection_ids?: string[];
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
    const filter: FilterableProductCollectionProps = {};
    if (isDefined(input.collection_ids)) {
      const ids = input.collection_ids.filter((value): value is string => typeof value === "string");
      if (ids.length) {
        filter.id = ids;
      }
    }

    while (hasMore) {
      const [collections, count] = await productModule.listAndCountProductCollections(filter, {
        select: ["id", "handle", "title"],
        skip: offset,
        take: batchSize,
        order: { id: "ASC" },
      });

      await promiseAll(
        collections.map((prod) => {
          return payloadModule.upsertSyncDocument("collection", prod);
        }),
      );

      offset += batchSize;
      hasMore = offset < count;
      total += collections.length;
    }

    return new StepResponse({ total });
  },
);

const id = "payload-collection-sync";

export const payloadCollectionSyncWorkflow = wf(
  { name: id, retentionTime: 10000 },
  function (input: Input) {
    const result = syncStep(input);

    return new WorkflowResponse(result);
  },
);
