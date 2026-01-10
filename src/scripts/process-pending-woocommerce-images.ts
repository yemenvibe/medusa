import { MedusaContainer } from "@medusajs/framework/types";
import { processPendingWooCommerceImagesWorkflow } from "../workflows";

const DEFAULT_BATCH_SIZE = 25;

const parseBatchSize = () => {
  const raw = process.env.WOOCOMMERCE_PENDING_IMAGE_BATCH_SIZE || "";
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_BATCH_SIZE;
};

export default async function processPendingWooCommerceImagesJob(
  container: MedusaContainer,
) {
  const logger = container.resolve("logger") as {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  } | undefined;

  const batchSize = parseBatchSize();

  const workflow = processPendingWooCommerceImagesWorkflow(container);

  try {
    const result = await workflow.run({
      input: {
        limit: batchSize,
      },
    });

    const summary = (result as { result?: { fetched?: number; updated?: number; totalPending?: number } })
      ?.result;

    const message = `[woocommerce-images] Processed pending images batch fetched=${summary?.fetched ?? 0} updated=${summary?.updated ?? 0} totalPending=${summary?.totalPending ?? "n/a"}`;

    logger?.info?.(message);
    console.log(message);
  } catch (error) {
    const errorMessage = `[woocommerce-images] Failed to process pending images: ${(error as Error)?.message}`;
    logger?.error?.(errorMessage);
    console.error(errorMessage);
    throw error;
  }
}

