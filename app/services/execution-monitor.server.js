import { createClient } from "@supabase/supabase-js";

async function getSupabaseAdmin() {
  // Prefer the project's existing Supabase server helper.
  try {
    const module = await import("./supabase.server.js");

    const candidates = [
      "getSupabaseAdmin",
      "getSupabaseServerClient",
      "getSupabaseClient",
      "createSupabaseAdmin",
      "createSupabaseClient",
    ];

    for (const name of candidates) {
      const candidate = module[name];

      if (typeof candidate === "function" && candidate.length === 0) {
        const client = await candidate();
        if (client?.from) return client;
      }

      if (candidate?.from) {
        return candidate;
      }
    }

    if (module.default?.from) {
      return module.default;
    }
  } catch {
    // Fall through to direct server client.
  }

  const url =
    process.env.SUPABASE_URL ||
    process.env.SUPABASE_PROJECT_URL;

  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase server credentials are missing. Expected SUPABASE_URL plus SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

async function getStoreId(supabase, shopDomain) {
  const { data, error } = await supabase
    .from("stores")
    .select("id")
    .eq("shop_domain", shopDomain)
    .maybeSingle();

  if (error) {
    throw new Error(`Store lookup failed: ${error.message}`);
  }

  if (!data?.id) {
    throw new Error(`No Supabase store found for ${shopDomain}.`);
  }

  return data.id;
}


async function captureFeedbackMetrics(
  supabase,
  productTitle,
  startAt = null,
  endAt = null,
) {
  const title = String(productTitle || "").trim();

  if (!title) {
    return {
      feedbackCount: 0,
      negativeFeedbackCount: 0,
      negativeRate: 0,
    };
  }

  let query = supabase
    .from("feedback")
    .select("id,created_at")
    .eq("product_name", title)
    .limit(1000);

  if (startAt) {
    query = query.gte("created_at", startAt);
  }

  if (endAt) {
    query = query.lt("created_at", endAt);
  }

  const { data: feedbackRows, error } = await query;

  if (error) {
    console.warn(
      "Feedback metric capture failed:",
      error.message,
    );

    return {
      feedbackCount: 0,
      negativeFeedbackCount: 0,
      negativeRate: 0,
    };
  }

  const rows = feedbackRows || [];
  const feedbackCount = rows.length;

  if (!feedbackCount) {
    return {
      feedbackCount: 0,
      negativeFeedbackCount: 0,
      negativeRate: 0,
    };
  }

  const ids = rows.map((row) => row.id);

  const { data: analysisRows, error: analysisError } =
    await supabase
      .from("analysis_items")
      .select("feedback_id,sentiment")
      .in("feedback_id", ids)
      .limit(2000);

  if (analysisError) {
    console.warn(
      "Analysis sentiment capture failed:",
      analysisError.message,
    );

    return {
      feedbackCount,
      negativeFeedbackCount: 0,
      negativeRate: 0,
    };
  }

  const negativeIds = new Set(
    (analysisRows || [])
      .filter(
        (row) =>
          String(row.sentiment || "").toLowerCase() ===
          "negative",
      )
      .map((row) => row.feedback_id),
  );

  const negativeFeedbackCount = negativeIds.size;

  return {
    feedbackCount,
    negativeFeedbackCount,
    negativeRate:
      feedbackCount > 0
        ? Number(
            (
              negativeFeedbackCount /
              feedbackCount
            ).toFixed(4),
          )
        : 0,
  };
}

async function captureShopifySalesMetrics(
  admin,
  productId,
  startAt = null,
  endAt = null,
) {
  if (!admin || !productId) {
    return {
      orderCount: null,
      grossSales: null,
    };
  }

  const numericProductId =
    String(productId).split("/").pop();

  let query =
    `line_items.product_id:${numericProductId}`;

  if (startAt) {
    const date = new Date(startAt);
    if (!Number.isNaN(date.getTime())) {
      query +=
        ` created_at:>=${date.toISOString().slice(0, 10)}`;
    }
  }

  try {
    const response = await admin.graphql(
      `#graphql
        query MonitorProductOrders($query: String!) {
          orders(first: 100, query: $query) {
            nodes {
              id
              currentTotalPriceSet {
                shopMoney {
                  amount
                }
              }
            }
          }
        }
      `,
      {
        variables: { query },
      },
    );

    const payload = await response.json();

    if (payload.errors?.length) {
      console.warn(
        "Shopify sales metric capture failed:",
        payload.errors[0].message,
      );

      return {
        orderCount: null,
        grossSales: null,
      };
    }

    const orders =
      payload.data?.orders?.nodes || [];

    const grossSales = orders.reduce(
      (sum, order) =>
        sum +
        Number(
          order?.currentTotalPriceSet
            ?.shopMoney?.amount || 0,
        ),
      0,
    );

    return {
      orderCount: orders.length,
      grossSales: Number(
        grossSales.toFixed(2),
      ),
    };
  } catch (error) {
    console.warn(
      "Shopify sales metric capture failed:",
      error.message,
    );

    return {
      orderCount: null,
      grossSales: null,
    };
  }
}

async function captureMonitorSnapshot({
  supabase,
  admin,
  monitorId,
  productTitle,
  productId,
  snapshotType,
  appliedAt,
}) {
  const applied = new Date(appliedAt);

  if (Number.isNaN(applied.getTime())) {
    return null;
  }

  const now = new Date();

  let startAt;
  let endAt;

  if (snapshotType === "baseline") {
    const baselineStart = new Date(applied);
    baselineStart.setUTCDate(
      baselineStart.getUTCDate() - 7,
    );

    startAt = baselineStart.toISOString();
    endAt = applied.toISOString();
  } else {
    startAt = applied.toISOString();
    endAt = now.toISOString();
  }

  const feedback =
    await captureFeedbackMetrics(
      supabase,
      productTitle,
      startAt,
      endAt,
    );

  const sales =
    await captureShopifySalesMetrics(
      admin,
      productId,
      startAt,
      endAt,
    );

  const snapshot = {
    monitor_id: monitorId,
    snapshot_type: snapshotType,
    feedback_count: feedback.feedbackCount,
    negative_feedback_count:
      feedback.negativeFeedbackCount,
    negative_rate: feedback.negativeRate,
    order_count: sales.orderCount,
    gross_sales: sales.grossSales,
    metrics: {
      windowStart: startAt,
      windowEnd: endAt,
      capturedAt: now.toISOString(),
      productId,
      productTitle,
    },
  };

  // Baseline is a single reference snapshot.
  // Follow-up snapshots are historical observations and
  // must be inserted as new rows on every verification.
  if (snapshotType === "baseline") {
    const { error: deleteError } = await supabase
      .from("execution_monitor_snapshots")
      .delete()
      .eq("monitor_id", monitorId)
      .eq("snapshot_type", "baseline");

    if (deleteError) {
      console.warn(
        "Monitor baseline cleanup failed:",
        deleteError.message,
      );
      return null;
    }
  }

  const { data, error } = await supabase
    .from("execution_monitor_snapshots")
    .insert(snapshot)
    .select()
    .single();

  if (error) {
    console.warn(
      `Monitor ${snapshotType} snapshot failed:`,
      error.message,
    );
    return null;
  }

  return data;
}

export async function recordExecutionMonitor({
  admin,
  shopDomain,
  productId,
  productTitle,
  target,
  beforeHtml = "",
  afterHtml = "",
  changeSummary = "",
}) {
  const supabase = await getSupabaseAdmin();
  const storeId = await getStoreId(supabase, shopDomain);

  const { data, error } = await supabase
    .from("execution_monitors")
    .insert({
      store_id: storeId,
      shop_domain: shopDomain,
      product_id: productId,
      product_title: productTitle || null,
      target,
      before_html: beforeHtml || "",
      after_html: afterHtml || "",
      change_summary: changeSummary || null,
      status: "monitoring",
      verification: {},
      next_verify_at: new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      monitoring_interval_days: 7,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Execution monitor save failed: ${error.message}`);
  }

  await captureMonitorSnapshot({
    supabase,
    admin,
    monitorId: data.id,
    productTitle,
    productId,
    snapshotType: "baseline",
    appliedAt: data.applied_at,
  });

  return data;
}

export async function listExecutionMonitors(shopDomain) {
  const supabase = await getSupabaseAdmin();

  const { data, error } = await supabase
    .from("execution_monitors")
    .select("*")
    .eq("shop_domain", shopDomain)
    .order("applied_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(`Execution monitor load failed: ${error.message}`);
  }

  const monitors = data || [];

  if (!monitors.length) {
    return [];
  }

  const monitorIds = monitors.map((monitor) => monitor.id);

  const {
    data: snapshots,
    error: snapshotError,
  } = await supabase
    .from("execution_monitor_snapshots")
    .select("*")
    .in("monitor_id", monitorIds)
    .order("captured_at", { ascending: true });

  if (snapshotError) {
    throw new Error(
      `Execution monitor snapshots load failed: ${snapshotError.message}`,
    );
  }

  const snapshotsByMonitor = new Map();

  for (const snapshot of snapshots || []) {
    if (!snapshotsByMonitor.has(snapshot.monitor_id)) {
      snapshotsByMonitor.set(snapshot.monitor_id, []);
    }

    snapshotsByMonitor
      .get(snapshot.monitor_id)
      .push(snapshot);
  }

  return monitors.map((monitor) => {
    const monitorSnapshots =
      snapshotsByMonitor.get(monitor.id) || [];

    const baseline =
      monitorSnapshots.find(
        (snapshot) =>
          snapshot.snapshot_type === "baseline",
      ) || null;

    const followupSnapshots =
      monitorSnapshots.filter(
        (snapshot) =>
          snapshot.snapshot_type === "followup",
      );

    const followup =
      followupSnapshots.length
        ? followupSnapshots[
            followupSnapshots.length - 1
          ]
        : null;

    return {
      ...monitor,
      snapshots: {
        baseline,
        followup,
        history: monitorSnapshots,
      },
      baseline,
      followup,
    };
  });
}


export async function listDueExecutionMonitors() {
  const supabase = await getSupabaseAdmin();

  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("execution_monitors")
    .select("*")
    .eq("status", "monitoring")
    .not("next_verify_at", "is", null)
    .lte("next_verify_at", now)
    .order("next_verify_at", { ascending: true })
    .limit(50);

  if (error) {
    throw new Error(
      `Due execution monitors lookup failed: ${error.message}`,
    );
  }

  return data || [];
}

export async function scheduleNextExecutionMonitor({
  monitorId,
  shopDomain,
  intervalDays = 7,
  verifiedAt,
}) {
  const supabase = await getSupabaseAdmin();

  const verifiedDate = new Date(
    verifiedAt || new Date(),
  );

  const nextVerifyAt = new Date(
    verifiedDate.getTime() +
      Number(intervalDays || 7) *
        24 *
        60 *
        60 *
        1000,
  );

  const { data, error } = await supabase
    .from("execution_monitors")
    .update({
      next_verify_at: nextVerifyAt.toISOString(),
      last_auto_verified_at:
        verifiedDate.toISOString(),
      monitoring_interval_days:
        Number(intervalDays || 7),
      updated_at:
        new Date().toISOString(),
    })
    .eq("id", monitorId)
    .eq("shop_domain", shopDomain)
    .select()
    .single();

  if (error) {
    throw new Error(
      `Execution monitor scheduling failed: ${error.message}`,
    );
  }

  return data;
}

export async function verifyExecutionMonitor({
  admin,
  shopDomain,
  monitorId,
}) {
  const supabase = await getSupabaseAdmin();

  const { data: monitor, error: loadError } = await supabase
    .from("execution_monitors")
    .select("*")
    .eq("id", monitorId)
    .eq("shop_domain", shopDomain)
    .maybeSingle();

  if (loadError) {
    throw new Error(`Monitor lookup failed: ${loadError.message}`);
  }

  if (!monitor) {
    throw new Error("Execution monitor not found.");
  }

  const response = await admin.graphql(
    `#graphql
      query VerifyExecutionProduct($id: ID!) {
        product(id: $id) {
          id
          title
          descriptionHtml
          updatedAt
        }
      }
    `,
    {
      variables: {
        id: monitor.product_id,
      },
    },
  );

  const payload = await response.json();

  if (payload.errors?.length) {
    throw new Error(
      `Shopify product verification failed: ${payload.errors[0].message}`,
    );
  }

  const product = payload.data?.product;

  if (!product) {
    throw new Error("Shopify product no longer exists.");
  }

  const currentDescription = product.descriptionHtml || "";
  const expectedDescription = monitor.after_html || "";

  const exactMatch = currentDescription === expectedDescription;

  let status = "no_change";
  let reason = "The applied change could not be confirmed.";

  if (exactMatch) {
    status = "improved";
    reason = "The applied product change is still present in Shopify.";
  } else if (
    currentDescription.includes(expectedDescription) &&
    expectedDescription
  ) {
    status = "improved";
    reason = "The applied change is still present within the current description.";
  } else if (
    monitor.before_html &&
    currentDescription === monitor.before_html
  ) {
    status = "declined";
    reason = "The product description has reverted to its pre-change state.";
  }

  const verification = {
    checkedAt: new Date().toISOString(),
    productId: product.id,
    productTitle: product.title,
    productUpdatedAt: product.updatedAt,
    exactMatch,
    currentDescriptionLength: currentDescription.length,
    expectedDescriptionLength: expectedDescription.length,
    status,
    reason,
  };

  const { data, error } = await supabase
    .from("execution_monitors")
    .update({
      status,
      last_verified_at: verification.checkedAt,
      verification,
      updated_at: verification.checkedAt,
    })
    .eq("id", monitor.id)
    .eq("shop_domain", shopDomain)
    .select()
    .single();

  if (error) {
    throw new Error(`Execution monitor update failed: ${error.message}`);
  }

  await captureMonitorSnapshot({
    supabase,
    admin,
    monitorId: monitor.id,
    productTitle: product.title,
    productId: product.id,
    snapshotType: "followup",
    appliedAt: monitor.applied_at,
  });

  return data;
}
