import {
  getJudgeMeConnection,
  getStoreByDomain,
  upsertFeedbackRows,
} from "./supabase.server";

const JUDGEME_API_BASE = "https://api.judge.me/api/v1";

function getReviewText(review) {
  const title = String(review.title || "").trim();
  const body = String(review.body || "").trim();

  if (title && body) {
    return `${title}\n${body}`;
  }

  return title || body;
}

function getProductName(review) {
  return (
    review.product_title ||
    review.product_name ||
    review.product?.title ||
    null
  );
}

function getReviewId(review) {
  return (
    review.id ||
    review.review_id ||
    review.external_id ||
    null
  );
}

export async function fetchJudgeMeReviews(
  shopDomain,
  { perPage = 100, maxPages = 100 } = {},
) {
  const connection = await getJudgeMeConnection(shopDomain);

  if (!connection?.access_token) {
    throw new Error("Judge.me is not connected.");
  }

  const reviews = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const params = new URLSearchParams({
      api_token: connection.access_token,
      shop_domain: shopDomain,
      per_page: String(perPage),
      page: String(page),
    });

    const response = await fetch(
      `${JUDGEME_API_BASE}/reviews?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      },
    );

    const data = await response.json();

    console.log("Judge.me Reviews API:", {
      status: response.status,
      dataType: Array.isArray(data) ? "array" : typeof data,
      reviewCount: Array.isArray(data)
        ? data.length
        : Array.isArray(data.reviews)
          ? data.reviews.length
          : 0,
      keys: data && typeof data === "object"
        ? Object.keys(data)
        : [],
    });

    if (!response.ok) {
      console.error("Judge.me Reviews API failed:", {
        status: response.status,
      });

      throw new Error(
        `Judge.me Reviews API failed with status ${response.status}.`,
      );
    }

    const pageReviews = Array.isArray(data)
      ? data
      : data.reviews || [];

    reviews.push(...pageReviews);

    if (pageReviews.length < perPage) {
      break;
    }
  }

  return reviews;
}

export async function syncJudgeMeReviews(shopDomain) {
  const store = await getStoreByDomain(shopDomain);

  if (!store) {
    throw new Error(`Store not found: ${shopDomain}`);
  }

  const reviews = await fetchJudgeMeReviews(shopDomain);

  const rows = reviews
    .map((review) => {
      const externalId = getReviewId(review);
      const text = getReviewText(review);

      if (!externalId || !text) {
        return null;
      }

      return {
        store_id: store.id,
        source: "judgeme",
        external_id: String(externalId),
        product_name: getProductName(review),
        text,
        created_at:
          review.created_at ||
          review.updated_at ||
          new Date().toISOString(),
      };
    })
    .filter(Boolean);

  const result = await upsertFeedbackRows(rows);

  return {
    fetched: reviews.length,
    normalized: rows,
    synced: result.count,
    storeId: store.id,
  };
}
