import { Modules } from "@medusajs/framework/utils";
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { UpsertProductDTO } from "@medusajs/framework/types";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";
import {
  downloadWooCommerceImagesStep,
  WOOCOMMERCE_IMAGE_PENDING_METADATA_KEY,
} from "./steps/download-woocommerce-images";

type Input = {
  limit?: number;
};

type FetchPendingResult = {
  products: Array<{
    id: string;
    title?: string | null;
    thumbnail?: string | null;
    metadata?: Record<string, unknown> | null;
    images?: Array<{
      id?: string;
      url?: string | null;
      metadata?: Record<string, unknown> | null;
    }>;
    variants?: Array<{
      id: string;
      metadata?: Record<string, unknown> | null;
    }>;
  }>;
  total: number;
};

const fetchPendingProductsStep = createStep(
  "fetch-pending-woocommerce-image-products",
  async (input: Input, { container }) => {
    const productModule = container.resolve(Modules.PRODUCT);

    const takeCandidate = Number.isFinite(input.limit) && input.limit ? Math.floor(input.limit) : 50;
    const take = Math.max(1, Math.min(takeCandidate, 200));

    // The product module's filter type (FilterableProductProps) may not yet expose "metadata".
    // Runtime filtering of metadata keys is supported in Medusa core; to avoid the TS2353 error
    // we cast the filter to any. If metadata filtering becomes officially typed, remove the cast.
    const [products, count] = await productModule.listAndCountProducts(
      {
        metadata: {
          [WOOCOMMERCE_IMAGE_PENDING_METADATA_KEY]: {
            $ne: null,
          },
        },
      } as any,
      {
        select: ["id", "title", "thumbnail", "metadata"],
        relations: ["images", "variants"],
        take,
        order: { id: "ASC" },
      },
    );

    return new StepResponse<FetchPendingResult>({
      products: products as FetchPendingResult["products"],
      total: count,
    });
  },
);

const cloneMetadata = (metadata?: Record<string, unknown> | null) => {
  if (!metadata || typeof metadata !== "object") {
    return {} as Record<string, unknown>;
  }

  return { ...metadata } as Record<string, unknown>;
};

type WorkflowResult = {
  fetched: number;
  updated: number;
  totalPending: number;
};

export const processPendingWooCommerceImagesWorkflowId = "process-pending-woocommerce-images";

export const processPendingWooCommerceImagesWorkflow = createWorkflow(
  {
    name: processPendingWooCommerceImagesWorkflowId,
    retentionTime: 10000,
  },
  (input: Input) => {
    const pending = fetchPendingProductsStep(input);

    const productsToUpdateInput = transform({ pending }, ({ pending }) => {
      return pending.products.map((product) => ({
        id: product.id,
        title: product.title ?? undefined,
        thumbnail: typeof product.thumbnail === "string" ? product.thumbnail : undefined,
        metadata: cloneMetadata(product.metadata),
        images: (product.images ?? []).map((image) => ({
          id: image.id,
          url: typeof image.url === "string" ? image.url : undefined,
          metadata: cloneMetadata(image.metadata),
        })),
        variants: (product.variants ?? []).map((variant) => ({
          id: variant.id,
          metadata: cloneMetadata(variant.metadata),
        })),
      })) as UpsertProductDTO[];
    });

    const processedProducts = downloadWooCommerceImagesStep({
      productsToCreate: [],
      productsToUpdate: productsToUpdateInput,
      forceDownload: true,
    }).config({ name: "download-pending-woocommerce-images" });

    const cleanedProducts = transform({ processedProducts }, ({ processedProducts }) => {
      return (processedProducts.productsToUpdate ?? []).map((product) => {
        const metadata = cloneMetadata(product.metadata as Record<string, unknown> | null);
        delete metadata[WOOCOMMERCE_IMAGE_PENDING_METADATA_KEY];

        const normalizedMetadata = Object.keys(metadata).length ? metadata : {};

        const images = (product.images ?? []).map((image) => (
          {
            ...(image.id ? { id: image.id } : {}),
            url: image.url,
            metadata: cloneMetadata(image.metadata as Record<string, unknown> | null),
          }
        ));

        const variants = (product.variants ?? []).map((variant) => {
          const variantMetadata = cloneMetadata(
            variant.metadata as Record<string, unknown> | null,
          );
          delete variantMetadata[WOOCOMMERCE_IMAGE_PENDING_METADATA_KEY];

          const normalizedVariantMetadata = Object.keys(variantMetadata).length
            ? variantMetadata
            : {};

          return {
            id: variant.id,
            metadata: normalizedVariantMetadata,
          };
        });

        return {
          id: product.id,
          thumbnail: typeof product.thumbnail === "string" ? product.thumbnail : undefined,
          metadata: normalizedMetadata,
          images,
          variants,
        } satisfies UpsertProductDTO;
      });
    });

    const productsToPersist = transform({ cleanedProducts }, ({ cleanedProducts }) => {
      return cleanedProducts.filter((product) => Boolean(product)) as UpsertProductDTO[];
    });

    updateProductsWorkflow
      .runAsStep({
        input: {
          products: productsToPersist,
        },
      })
      .config({ name: "update-pending-woocommerce-images" });

    const result = transform({ pending, productsToPersist }, ({ pending, productsToPersist }) => {
      return {
        fetched: pending.products.length,
        updated: productsToPersist.length,
        totalPending: pending.total,
      } satisfies WorkflowResult;
    });

    return new WorkflowResponse(result);
  },
);
