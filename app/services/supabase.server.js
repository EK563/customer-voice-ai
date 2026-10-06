import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl) {
  throw new Error("Missing SUPABASE_URL.");
}

if (!supabaseSecretKey) {
  throw new Error("Missing SUPABASE_SECRET_KEY.");
}

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export async function getStoreByDomain(shopDomain) {
  const { data, error } = await supabase
    .from("stores")
    .select("id, shop_domain, shop_name, status")
    .eq("shop_domain", shopDomain)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase store lookup failed: ${error.message}`);
  }

  return data;
}

export async function upsertStore({
  shopDomain,
  shopName = null,
}) {
  const { data, error } = await supabase
    .from("stores")
    .upsert(
      {
        shop_domain: shopDomain,
        shop_name: shopName,
        status: "active",
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "shop_domain",
      },
    )
    .select()
    .single();

  if (error) {
    throw new Error(`Supabase store save failed: ${error.message}`);
  }

  return data;
}

export async function saveAnalysis({
  storeId,
  feedbackEntries,
  analysis,
  provider,
  model,
}) {
  if (!storeId) {
    throw new Error("Missing storeId.");
  }

  if (!Array.isArray(feedbackEntries) || feedbackEntries.length === 0) {
    throw new Error("No feedback entries to save.");
  }

  const feedbackRows = feedbackEntries.map((text) => ({
    store_id: storeId,
    source: "manual",
    text,
  }));

  const { data: feedbackRowsSaved, error: feedbackError } = await supabase
    .from("feedback")
    .insert(feedbackRows)
    .select("id, text");

  if (feedbackError) {
    throw new Error(
      `Supabase feedback save failed: ${feedbackError.message}`,
    );
  }

  const { data: analysisRow, error: analysisError } = await supabase
    .from("analyses")
    .insert({
      store_id: storeId,
      source_feedback_count: feedbackEntries.length,
      provider: provider || null,
      model: model || null,
      result: analysis,
    })
    .select()
    .single();

  if (analysisError) {
    throw new Error(
      `Supabase analysis save failed: ${analysisError.message}`,
    );
  }

  const itemRows = analysis.classifiedFeedback.map((item, index) => ({
    analysis_id: analysisRow.id,
    feedback_id: feedbackRowsSaved[index]?.id ?? null,
    item_index: index,
    text: item.text,
    sentiment: item.sentiment,
    topics: item.topics || [],
    primary_topic: item.primaryTopic || "General Feedback",
  }));

  const { error: itemsError } = await supabase
    .from("analysis_items")
    .insert(itemRows);

  if (itemsError) {
    throw new Error(
      `Supabase analysis items save failed: ${itemsError.message}`,
    );
  }

  return {
    analysisId: analysisRow.id,
    feedbackCount: feedbackRowsSaved.length,
  };
}

export async function getRecentAnalyses({
  shopDomain,
  limit = 10,
}) {
  const store = await getStoreByDomain(shopDomain);

  if (!store) {
    return [];
  }

  const { data, error } = await supabase
    .from("analyses")
    .select(
      "id, source_feedback_count, provider, model, result, created_at",
    )
    .eq("store_id", store.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(
      `Supabase history load failed: ${error.message}`,
    );
  }

  return data || [];
}

export async function saveJudgeMeConnection({
  storeId,
  accessToken,
  tokenType = "Bearer",
  scope = null,
}) {
  if (!storeId) {
    throw new Error("Missing storeId.");
  }

  if (!accessToken) {
    throw new Error("Missing Judge.me access token.");
  }

  const { data, error } = await supabase
    .from("judgeme_connections")
    .upsert(
      {
        store_id: storeId,
        access_token: accessToken,
        token_type: tokenType,
        scope,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "store_id",
      },
    )
    .select("id, store_id, token_type, scope, created_at, updated_at")
    .single();

  if (error) {
    throw new Error(
      `Judge.me connection save failed: ${error.message}`,
    );
  }

  return data;
}

export async function getJudgeMeConnection(shopDomain) {
  const store = await getStoreByDomain(shopDomain);

  if (!store) {
    return null;
  }

  const { data, error } = await supabase
    .from("judgeme_connections")
    .select("id, store_id, access_token, token_type, scope")
    .eq("store_id", store.id)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Judge.me connection lookup failed: ${error.message}`,
    );
  }

  return data;
}

export async function upsertFeedbackRows(rows) {
  if (!rows?.length) {
    return { count: 0 };
  }

  const { data, error } = await supabase
    .from("feedback")
    .upsert(rows, {
      onConflict: "source,external_id",
    })
    .select("id, external_id");

  if (error) {
    throw new Error(`Feedback sync failed: ${error.message}`);
  }

  return {
    count: data?.length ?? 0,
  };
}

export async function getFeedbackForAnalysis({
  shopDomain,
  source = "judgeme",
  limit = 100,
}) {
  const store = await getStoreByDomain(shopDomain);

  if (!store) {
    throw new Error(`Store not found: ${shopDomain}`);
  }

  const { data, error } = await supabase
    .from("feedback")
    .select("id, store_id, source, external_id, product_name, text, created_at")
    .eq("store_id", store.id)
    .eq("source", source)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(
      `Supabase feedback lookup failed: ${error.message}`,
    );
  }

  return data || [];
}

export async function saveAnalysisFromFeedback({
  storeId,
  feedbackRows,
  analysis,
  provider,
  model,
}) {
  if (!storeId) {
    throw new Error("Missing storeId.");
  }

  if (!Array.isArray(feedbackRows) || feedbackRows.length === 0) {
    throw new Error("No feedback rows to save.");
  }

  if (!analysis?.classifiedFeedback?.length) {
    throw new Error("No classified feedback to save.");
  }

  const { data: analysisRow, error: analysisError } = await supabase
    .from("analyses")
    .insert({
      store_id: storeId,
      source_feedback_count: feedbackRows.length,
      provider: provider || null,
      model: model || null,
      result: analysis,
    })
    .select()
    .single();

  if (analysisError) {
    throw new Error(
      `Supabase analysis save failed: ${analysisError.message}`,
    );
  }

  const itemRows = analysis.classifiedFeedback.map((item, index) => ({
    analysis_id: analysisRow.id,
    feedback_id: feedbackRows[index]?.id ?? null,
    item_index: index,
    text: item.text,
    sentiment: item.sentiment,
    topics: item.topics || [],
    primary_topic: item.primaryTopic || "General Feedback",
  }));

  const { error: itemsError } = await supabase
    .from("analysis_items")
    .insert(itemRows);

  if (itemsError) {
    throw new Error(
      `Supabase analysis items save failed: ${itemsError.message}`,
    );
  }

  return {
    analysisId: analysisRow.id,
    feedbackCount: feedbackRows.length,
  };
}
