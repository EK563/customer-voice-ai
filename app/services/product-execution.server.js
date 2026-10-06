const PLACEHOLDER_PATTERN = /\[[^\]]+\]/;

function hasUnsafePlaceholder(value) {
  return PLACEHOLDER_PATTERN.test(String(value || ""));
}

export async function getProductByTitle(admin, title) {
  const response = await admin.graphql(
    `#graphql
      query FindProduct($query: String!) {
        products(first: 5, query: $query) {
          nodes {
            id
            title
            descriptionHtml
            vendor
            productType
            options {
              name
              values
            }
            variants(first: 50) {
              nodes {
                title
              }
            }
          }
        }
      }
    `,
    {
      variables: {
        query: `title:"${String(title).replace(/"/g, '\\"')}"`,
      },
    },
  );

  const payload = await response.json();

  if (payload.errors?.length) {
    throw new Error(
      `Shopify product lookup failed: ${payload.errors[0].message}`,
    );
  }

  const products = payload.data?.products?.nodes || [];

  const product = products.find(
    (item) => item.title.toLowerCase() === String(title).toLowerCase(),
  );

  if (!product) {
    throw new Error(`Shopify product not found: ${title}`);
  }

  return product;
}

export async function buildProductDescriptionPreview({
  admin,
  target,
  proposedChange,
}) {
  if (!target) {
    return {
      canApply: false,
      reason: "No product target was provided.",
    };
  }

  if (!proposedChange) {
    return {
      canApply: false,
      reason: "No proposed product description was provided.",
    };
  }

  if (hasUnsafePlaceholder(proposedChange)) {
    return {
      canApply: false,
      reason:
        "The proposed description contains unresolved placeholders and cannot be applied safely.",
    };
  }

  const product = await getProductByTitle(admin, target);

  return {
    canApply: true,
    productId: product.id,
    productTitle: product.title,
    before: product.descriptionHtml || "",
    after: proposedChange,
  };
}

export async function updateProductDescription({
  admin,
  productId,
  descriptionHtml,
}) {
  if (!productId) {
    throw new Error("Missing Shopify product ID.");
  }

  if (!descriptionHtml) {
    throw new Error("Missing product description.");
  }

  if (hasUnsafePlaceholder(descriptionHtml)) {
    throw new Error(
      "The product description contains unresolved placeholders.",
    );
  }

  const response = await admin.graphql(
    `#graphql
      mutation UpdateProductDescription(
        $product: ProductUpdateInput!
      ) {
        productUpdate(product: $product) {
          product {
            id
            title
            descriptionHtml
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        product: {
          id: productId,
          descriptionHtml,
        },
      },
    },
  );

  const payload = await response.json();

  if (payload.errors?.length) {
    throw new Error(
      `Shopify product update failed: ${payload.errors[0].message}`,
    );
  }

  const result = payload.data?.productUpdate;

  if (result?.userErrors?.length) {
    throw new Error(
      result.userErrors.map((error) => error.message).join("; "),
    );
  }

  if (!result?.product) {
    throw new Error("Shopify product update returned no product.");
  }

  return result.product;
}


function getExecutionId(change, index) {
  return String(
    change.executionId ||
      `${String(change.target || "execution").trim() || "execution"}-${index}`,
  );
}

function getExecutionError(error) {
  return error instanceof Error
    ? error.message
    : "Unable to execute this change.";
}

export async function previewProductDescriptionChanges({
  admin,
  changes = [],
}) {
  const items = Array.isArray(changes) ? changes : [];

  return Promise.all(
    items.map(async (change, index) => {
      const executionId = getExecutionId(change, index);

      try {
        const preview = await buildProductDescriptionPreview({
          admin,
          target: String(change.target || "").trim(),
          proposedChange: String(
            change.proposedChange || change.after || "",
          ).trim(),
        });

        return {
          ...preview,
          executionId,
          target: String(change.target || "").trim(),
        };
      } catch (error) {
        return {
          executionId,
          target: String(change.target || "").trim(),
          productId: String(change.productId || ""),
          productTitle: String(change.target || "").trim(),
          before: "",
          after: String(
            change.proposedChange || change.after || "",
          ),
          canApply: false,
          reason: getExecutionError(error),
        };
      }
    }),
  );
}

export async function applyProductDescriptionChanges({
  admin,
  changes = [],
}) {
  const items = Array.isArray(changes) ? changes : [];

  return Promise.all(
    items.map(async (change, index) => {
      const executionId = getExecutionId(change, index);
      const target = String(change.target || "").trim();

      try {
        if (change.canApply === false) {
          throw new Error(
            String(
              change.reason ||
                "This change is not safe to apply.",
            ),
          );
        }

        const productId = String(change.productId || "").trim();
        const descriptionHtml = String(
          change.after || change.proposedChange || "",
        ).trim();

        const product = await updateProductDescription({
          admin,
          productId,
          descriptionHtml,
        });

        return {
          executionId,
          target,
          success: true,
          product,
        };
      } catch (error) {
        return {
          executionId,
          target,
          success: false,
          error: getExecutionError(error),
        };
      }
    }),
  );
}
