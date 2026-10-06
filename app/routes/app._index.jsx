import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

import { recordExecutionMonitor } from "../services/execution-monitor.server.js";
import { verifyExecutionMonitor } from "../services/execution-monitor.server.js";
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const { getRecentAnalyses } = await import(
    "../services/supabase.server.js"
  );

  let history = [];

  try {
    history = await getRecentAnalyses({
      shopDomain: session.shop,
      limit: 10,
    });
  } catch (error) {
    console.error("Failed to load Supabase history:", error);
  }

  return { history };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "manual");

  try {
    if (intent === "preview_executions") {
      const rawExecutions = String(
        formData.get("executions") || "[]",
      );

      let executions;

      try {
        executions = JSON.parse(rawExecutions);
      } catch {
        return {
          error: "Invalid batch execution payload.",
        };
      }

      if (!Array.isArray(executions) || !executions.length) {
        return {
          error: "No executable changes were selected.",
        };
      }

      const { previewProductDescriptionChanges } = await import(
        "../services/product-execution.server.js"
      );

      return {
        executionPreviews:
          await previewProductDescriptionChanges({
            admin,
            changes: executions.slice(0, 20),
          }),
      };
    }

    if (intent === "apply_executions") {
      const rawExecutions = String(
        formData.get("executions") || "[]",
      );

      let executions;

      try {
        executions = JSON.parse(rawExecutions);
      } catch {
        return {
          error: "Invalid batch execution payload.",
        };
      }

      if (!Array.isArray(executions) || !executions.length) {
        return {
          error: "No changes were selected.",
        };
      }

      const { applyProductDescriptionChanges } = await import(
        "../services/product-execution.server.js"
      );

      const results =
        await applyProductDescriptionChanges({
          admin,
          changes: executions.slice(0, 20),
        });

      // MONITOR_AUTO_RECORD_V3

      // Record every successfully applied execution.

      for (const item of results) {

        if (!item?.success) {

          continue;

        }


        const execution =

          item.execution ||

          item.change ||

          executions.find(

            (candidate) =>

              candidate.productId === item.productId ||

              candidate.target === item.target ||

              candidate.productTitle === item.productTitle,

          );


        if (!execution) {

          console.warn(

            "Monitor record skipped: execution metadata not found.",

            item,

          );

          continue;

        }


        try {

          await recordExecutionMonitor({

            admin,
      shopDomain: session.shop,

            productId:

              item.productId ||

              execution.productId ||

              execution.targetId ||

              "",

            productTitle:

              item.productTitle ||

              execution.productTitle ||

              execution.title ||

              execution.target ||

              "",

            target:

              execution.target ||

              execution.productTitle ||

              execution.title ||

              "",

            beforeHtml:

              item.before ||

              execution.before ||

              "",

            afterHtml:

              item.after ||

              execution.after ||

              execution.proposedChange ||

              "",

            changeSummary:

              execution.changeSummary ||

              execution.reason ||

              execution.proposedChange ||

              "",

          });

        } catch (monitorError) {

          console.error(

            "Monitor auto-record failed:",

            monitorError,

          );

        }

      }



      return {
        batchExecutionResult: {
          total: results.length,
          successCount: results.filter(
            (item) => item.success,
          ).length,
          results,
        },
      };
    }


    if (intent === "record_monitor") {
      const shopDomain = String(session?.shop || "").trim();
      const productId = String(formData.get("productId") || "").trim();
      const productTitle = String(formData.get("productTitle") || "").trim();
      const target = String(formData.get("target") || "").trim();
      const beforeHtml = String(formData.get("beforeHtml") || "");
      const afterHtml = String(formData.get("afterHtml") || "");
      const changeSummary = String(
        formData.get("changeSummary") || "",
      ).trim();

      if (!shopDomain || !productId || !target || !afterHtml) {
        throw new Error(
          "Missing execution monitor data.",
        );
      }

      const monitor = await recordExecutionMonitor({
        /* MONITOR_V2_SINGLE_ADMIN */
        admin,
        shopDomain,
        productId,
        productTitle,
        target,
        beforeHtml,
        afterHtml,
        changeSummary,
      });

      return {
        monitorRecorded: true,
        monitor,
      };
    }

    if (intent === "verify_execution") {
      const shopDomain = String(session?.shop || "").trim();
      const monitorId = String(formData.get("monitorId") || "").trim();

      const verification = await verifyExecutionMonitor({
        admin,
        shopDomain,
        monitorId,
      });

      return {
        monitorVerified: true,
        verification,
      };
    }

    if (intent === "preview_execution") {
      const target = String(formData.get("target") || "").trim();
      const proposedChange = String(
        formData.get("proposedChange") || "",
      ).trim();

      const { buildProductDescriptionPreview } = await import(
        "../services/product-execution.server.js"
      );

      return {
        executionPreview: await buildProductDescriptionPreview({
          admin,
          target,
          proposedChange,
        }),
      };
    }

    if (intent === "apply_execution") {
      const productId = String(formData.get("productId") || "").trim();
      const proposedChange = String(
        formData.get("proposedChange") || "",
      ).trim();

      const { updateProductDescription } = await import(
        "../services/product-execution.server.js"
      );

      const product = await updateProductDescription({
        admin,
        productId,
        descriptionHtml: proposedChange,
      });

      return {
        executionApplied: true,
        product,
      };
    }

    const {
      analyzeWithAnalyzer,
      analyzeWithAnalyzerEntries,
      getAnalyzerProvider,
      getAnalyzerConfig,
    } = await import("../services/analyzer.server.js");

    const config = getAnalyzerConfig();

    const {
      upsertStore,
      saveAnalysis,
      getFeedbackForAnalysis,
      saveAnalysisFromFeedback,
    } = await import("../services/supabase.server.js");

    const store = await upsertStore({
      shopDomain: session.shop,
      shopName: session.shop,
    });

    if (intent === "analyze_judgeme") {
      const feedbackRows = await getFeedbackForAnalysis({
        shopDomain: session.shop,
        source: "judgeme",
        limit: 100,
      });

      if (!feedbackRows.length) {
        return {
          error:
            "No Judge.me feedback has been synced yet. Sync Judge.me reviews first.",
        };
      }

      const { getProductByTitle } = await import(
        "../services/product-execution.server.js"
      );

      const productContextCache = new Map();

      const entries = [];

      for (const row of feedbackRows) {
        const productName = row.product_name;

        let productContext = null;

        if (productName) {
          const cacheKey = productName.toLowerCase();

          if (productContextCache.has(cacheKey)) {
            productContext = productContextCache.get(cacheKey);
          } else {
            try {
              productContext = await getProductByTitle(
                admin,
                productName,
              );
            } catch (productError) {
              console.warn(
                `Could not load Shopify product context for ${productName}:`,
                productError,
              );
            }

            productContextCache.set(cacheKey, productContext);
          }
        }

        entries.push({
          text: row.text,
          productName,
          productContext,
        });
      }

      const analysis = await analyzeWithAnalyzerEntries(
        entries,
        config,
      );
      if (analysis.execution) {
        const proposedChange = String(
          analysis.execution.proposedChange || "",
        ).trim();

        const hasPlaceholder = /\[[^\]]+\]/.test(proposedChange);

        if (hasPlaceholder) {
          analysis.execution = {
            ...analysis.execution,
            canExecute: false,
          };
        }
      }
      const saved = await saveAnalysisFromFeedback({
        storeId: store.id,
        feedbackRows,
        analysis,
        provider: config.vendor || config.provider,
        model: config.model,
      });

      return {
        analysis,
        mode: config.provider,
        model: config.model,
        source: "judgeme",
        savedAnalysisId: saved.analysisId,
        savedFeedbackCount: saved.feedbackCount,
      };
    }

    const feedback = String(formData.get("feedback") || "").trim();

    if (!feedback) {
      return { error: "Please enter some customer feedback first." };
    }

    if (feedback.length < 10) {
      return { error: "Please enter at least 10 characters of feedback." };
    }

    const MAX_FEEDBACK_LENGTH = 50000;

    if (feedback.length > MAX_FEEDBACK_LENGTH) {
      return {
        error:
          "Feedback is too large. Please analyze 50,000 characters or less at a time.",
      };
    }

    const feedbackEntries = feedback
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean);

    const MAX_FEEDBACK_ENTRIES = 500;

    if (feedbackEntries.length > MAX_FEEDBACK_ENTRIES) {
      return {
        error:
          "Please analyze 500 feedback responses or fewer at a time.",
      };
    }

    const analysis = await analyzeWithAnalyzer({
      feedback,
      provider: getAnalyzerProvider(),
    });

    const saved = await saveAnalysis({
      storeId: store.id,
      feedbackEntries,
      analysis,
      provider: config.vendor || config.provider,
      model: config.model,
    });

    return {
      analysis,
      mode: config.provider,
      model: config.model,
      savedAnalysisId: saved.analysisId,
      savedFeedbackCount: saved.feedbackCount,
    };
  } catch (error) {
    console.error("Customer Voice AI action failed:", error);

    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to analyze or save feedback.",
    };
  }
};

/* eslint-disable react/prop-types */

function MetricCard({ value, label }) {
  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background="subdued"
    >
      <s-stack direction="block" gap="small">
        <s-heading>{value}</s-heading>
        <s-paragraph>{label}</s-paragraph>
      </s-stack>
    </s-box>
  );
}

function PriorityBadge({ priority }) {
  return (
    <s-badge
      tone={
        priority === "High"
          ? "critical"
          : priority === "Medium"
            ? "caution"
            : priority === "Positive Signal"
              ? "success"
              : "info"
      }
    >
      {priority}
    </s-badge>
  );
}

function formatDate(value) {
  if (!value) return "";

  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}


function buildTextDiff(beforeHtml = "", afterHtml = "") {
  const stripHtml = (html) =>
    String(html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|ul|ol)>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#039;/gi, "'")
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .trim();

  const splitBlocks = (text) =>
    String(text || "")
      .split(/\n+|(?<=[.!?])\s+/)
      .map((item) => item.trim())
      .filter(Boolean);

  const beforeText = stripHtml(beforeHtml);
  const afterText = stripHtml(afterHtml);

  if (beforeText === afterText) {
    return {
      html: `<div>${escapeHtml(
        beforeText || "(empty)",
      )}</div>`,
      added: 0,
      removed: 0,
    };
  }

  const beforeBlocks = splitBlocks(beforeText);
  const afterBlocks = splitBlocks(afterText);

  if (beforeBlocks.length * afterBlocks.length > 40000) {
    return {
      html:
        `<div style="margin-bottom:8px;background:#ffd6d6;color:#8a1c1c;padding:8px;text-decoration:line-through;">` +
        `${escapeHtml(beforeText || "(empty)")}</div>` +
        `<div style="background:#d9f7df;color:#146c2e;padding:8px;">` +
        `${escapeHtml(afterText || "(empty)")}</div>`,
      added: countWords(afterText),
      removed: countWords(beforeText),
    };
  }

  const rows = beforeBlocks.length + 1;
  const cols = afterBlocks.length + 1;

  const dp = Array.from({ length: rows }, () =>
    Array(cols).fill(0),
  );

  for (let i = beforeBlocks.length - 1; i >= 0; i -= 1) {
    for (let j = afterBlocks.length - 1; j >= 0; j -= 1) {
      dp[i][j] =
        beforeBlocks[i] === afterBlocks[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const parts = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;

  const removedStyle =
    "background:#ffd6d6;color:#8a1c1c;text-decoration:line-through;padding:8px;margin:0 0 6px 0;";
  const addedStyle =
    "background:#d9f7df;color:#146c2e;padding:8px;margin:0 0 6px 0;";
  const unchangedStyle =
    "padding:4px 0;margin:0 0 4px 0;";

  while (i < beforeBlocks.length && j < afterBlocks.length) {
    if (beforeBlocks[i] === afterBlocks[j]) {
      parts.push(
        `<div style="${unchangedStyle}">${escapeHtml(
          beforeBlocks[i],
        )}</div>`,
      );
      i += 1;
      j += 1;
      continue;
    }

    if (dp[i + 1][j] >= dp[i][j + 1]) {
      removed += countWords(beforeBlocks[i]);
      parts.push(
        `<div style="${removedStyle}">${escapeHtml(
          beforeBlocks[i],
        )}</div>`,
      );
      i += 1;
    } else {
      added += countWords(afterBlocks[j]);
      parts.push(
        `<div style="${addedStyle}">${escapeHtml(
          afterBlocks[j],
        )}</div>`,
      );
      j += 1;
    }
  }

  while (i < beforeBlocks.length) {
    removed += countWords(beforeBlocks[i]);
    parts.push(
      `<div style="${removedStyle}">${escapeHtml(
        beforeBlocks[i],
      )}</div>`,
    );
    i += 1;
  }

  while (j < afterBlocks.length) {
    added += countWords(afterBlocks[j]);
    parts.push(
      `<div style="${addedStyle}">${escapeHtml(
        afterBlocks[j],
      )}</div>`,
    );
    j += 1;
  }

  return {
    html: parts.join(""),
    added,
    removed,
  };
}

function countWords(value) {
  return (
    String(value || "").match(
      /\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu,
    ) || []
  ).length;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export default function Index() {
  const { history = [] } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [currentAnalysis, setCurrentAnalysis] = useState(null);
  const [executionPreview, setExecutionPreview] =
    useState(null);
  const [executionPreviews, setExecutionPreviews] =
    useState([]);
  const [selectedExecutionIds, setSelectedExecutionIds] =
    useState([]);
  const [batchExecutionResult, setBatchExecutionResult] =
    useState(null);
  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  const lastHandledAnalysisId = useRef(null);

  useEffect(() => {
    const savedAnalysisId = fetcher.data?.savedAnalysisId;

    if (
      !savedAnalysisId ||
      savedAnalysisId === lastHandledAnalysisId.current
    ) {
      return;
    }

    lastHandledAnalysisId.current = savedAnalysisId;

    shopify.toast.show("Feedback analysis complete");
  }, [
    fetcher.data?.savedAnalysisId,
    shopify,
  ]);

  const analyze = (event) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);

    fetcher.submit(formData, {
      method: "POST",
    });
  };

  useEffect(() => {
  if (fetcher.data?.analysis) {
    setCurrentAnalysis(fetcher.data.analysis);
  }

  if (fetcher.data?.executionPreview) {
    setExecutionPreview(fetcher.data.executionPreview);
    setExecutionPreviews([
      {
        ...fetcher.data.executionPreview,
        executionId:
          fetcher.data.executionPreview.executionId ||
          "legacy-execution-0",
      },
    ]);
    setSelectedExecutionIds(
      fetcher.data.executionPreview.canApply
        ? [
            fetcher.data.executionPreview.executionId ||
              "legacy-execution-0",
          ]
        : [],
    );
    setBatchExecutionResult(null);
  }

  if (fetcher.data?.executionPreviews) {
    const previews = fetcher.data.executionPreviews;
    setExecutionPreviews(previews);
    setSelectedExecutionIds(
      previews
        .filter((item) => item.canApply)
        .map((item) => item.executionId),
    );
    setBatchExecutionResult(null);
  }

  if (fetcher.data?.batchExecutionResult) {
    const result = fetcher.data.batchExecutionResult;

    setBatchExecutionResult(result);

    const failedIds =
      result.results
        ?.filter((item) => !item.success)
        .map((item) => item.executionId) || [];

    setExecutionPreviews((current) =>
      current.filter((item) =>
        failedIds.includes(item.executionId),
      ),
    );

    setSelectedExecutionIds(failedIds);
  }
}, [fetcher.data]);

  const analysis = currentAnalysis;

  const positivePercent = analysis
    ? Math.round(
        (analysis.sentimentCounts.Positive / analysis.feedbackCount) * 100,
      )
    : 0;

  const neutralPercent = analysis
    ? Math.round(
        (analysis.sentimentCounts.Neutral / analysis.feedbackCount) * 100,
      )
    : 0;

  const negativePercent = analysis
    ? Math.round(
        (analysis.sentimentCounts.Negative / analysis.feedbackCount) * 100,
      )
    : 0;

  return (
    <s-page heading="Customer Voice AI">

          <s-button
            href="/app/monitor"
            variant="secondary"
          >
            Monitor & Verify
          </s-button>

      <s-section heading="Analyze customer feedback">
        <s-paragraph>
          Paste customer reviews, survey responses, support messages, or other
          customer feedback below.
        </s-paragraph>

        <form onSubmit={analyze}>
          <s-stack direction="block" gap="base">
            <textarea
              name="feedback"
              rows="12"
              placeholder={`Paste customer feedback here, one response per line.
Example:

Love the product, the quality is excellent.

Shipping was very slow and my order arrived late.

The product looks great but the size was too small.

Customer service helped me get a refund quickly.

The price is a little expensive but the quality is good.`}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "12px",
                border: "1px solid #8c9196",
                borderRadius: "6px",
                fontFamily: "inherit",
                fontSize: "14px",
                lineHeight: "1.5",
                resize: "vertical",
              }}
            />

            <s-button
              type="submit"
              {...(isLoading ? { loading: true } : {})}
            >
              {isLoading ? "Analyzing..." : "Analyze Feedback"}
            </s-button>
          </s-stack>
        </form>

        <s-section heading="Judge.me">
          <s-stack direction="block" gap="small">
            <s-paragraph>
              Analyze the Judge.me reviews already synced to Customer Voice AI.
            </s-paragraph>
            <form onSubmit={analyze}>
              <input
                type="hidden"
                name="intent"
                value="analyze_judgeme"
              />
              <s-button
                type="submit"
                {...(isLoading ? { loading: true } : {})}
              >
                {isLoading ? "Analyzing Judge.me..." : "Analyze Judge.me Reviews"}
              </s-button>
            </form>
          </s-stack>
        </s-section>

        {fetcher.data?.error && (
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-paragraph>{fetcher.data.error}</s-paragraph>
          </s-box>
        )}

        {fetcher.data?.savedAnalysisId && (
          <s-paragraph>
            Saved to Customer Voice history ·{" "}
            {fetcher.data.savedFeedbackCount} feedback responses
          </s-paragraph>
        )}
      </s-section>

      {analysis && (
        <>
          <s-section heading="Customer Voice Summary">
            <s-stack direction="inline" gap="base">
              <MetricCard
                value={analysis.feedbackCount}
                label="Feedback analyzed"
              />

              <MetricCard
                value={`${positivePercent}%`}
                label="Positive"
              />

              <MetricCard
                value={`${neutralPercent}%`}
                label="Neutral"
              />

              <MetricCard
                value={`${negativePercent}%`}
                label="Negative"
              />
            </s-stack>
          </s-section>

          <s-section heading="Sentiment Breakdown">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Positive: {analysis.sentimentCounts.Positive} responses (
                {positivePercent}%)
              </s-paragraph>

              <s-paragraph>
                Neutral: {analysis.sentimentCounts.Neutral} responses (
                {neutralPercent}%)
              </s-paragraph>

              <s-paragraph>
                Negative: {analysis.sentimentCounts.Negative} responses (
                {negativePercent}%)
              </s-paragraph>
            </s-stack>
          </s-section>

          <s-section heading="Top Customer Topics">
            <s-stack direction="block" gap="base">
              {analysis.topicCounts.length === 0 ? (
                <s-paragraph>
                  No recurring topic was detected in this dataset.
                </s-paragraph>
              ) : (
                analysis.topicCounts.map((topic) => (
                  <s-box
                    key={topic.name}
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                    background="subdued"
                  >
                    <s-stack direction="block" gap="small">
                      <s-stack direction="inline" gap="base">
                        <s-heading>{topic.name}</s-heading>
                        <s-badge>
                          {topic.count} mentions
                        </s-badge>
                      </s-stack>

                      <s-paragraph>
                        {topic.percentage}% of all responses ·{" "}
                        {topic.positiveCount} positive ·{" "}
                        {topic.negativeCount} negative
                      </s-paragraph>
                    </s-stack>
                  </s-box>
                ))
              )}
            </s-stack>
          </s-section>

          <s-section heading="Priority Issues">
            <s-stack direction="block" gap="base">
              {analysis.priorityIssues.length === 0 ? (
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-paragraph>
                    No negative recurring issue was detected in this dataset.
                  </s-paragraph>
                </s-box>
              ) : (
                analysis.priorityIssues.map((issue) => (
                  <s-box
                    key={issue.topic}
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                    background="subdued"
                  >
                    <s-stack direction="block" gap="small">
                      <s-stack direction="inline" gap="base">
                        <s-heading>{issue.topic}</s-heading>
                        <PriorityBadge priority={issue.priority} />
                      </s-stack>

                      <s-paragraph>
                        {issue.negativeCount} negative response
                        {issue.negativeCount === 1 ? "" : "s"} ·{" "}
                        {issue.percentage}% of all feedback
                      </s-paragraph>
                    </s-stack>
                  </s-box>
                ))
              )}
            </s-stack>
          </s-section>

          <s-section heading="Customer Voice Insights">
            <s-stack direction="block" gap="base">
              {analysis.insights.map((insight) => (
                <s-paragraph key={insight}>
                  {insight}
                </s-paragraph>
              ))}
            </s-stack>
          </s-section>

          <s-section heading="Feedback Classification">
            <s-stack direction="block" gap="base">
              {analysis.classifiedFeedback.map((item) => (
                <s-box
                  key={item.id}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-stack direction="block" gap="small">
                    <s-paragraph>{item.text}</s-paragraph>

                    <s-stack direction="inline" gap="base">
                      <s-badge>{item.sentiment}</s-badge>
                      <s-badge>{item.primaryTopic}</s-badge>
                    </s-stack>

                    {item.topics.length > 1 && (
                      <s-paragraph>
                        Additional topics:{" "}
                        {item.topics.slice(1).join(", ")}
                      </s-paragraph>
                    )}
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          </s-section>

          <s-section heading="Recommended Actions">
            <s-stack direction="block" gap="base">
              {analysis.actions.map((item) => (
                <s-box
                  key={`${item.issue}-${item.action}`}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-stack direction="block" gap="small">
                    <s-stack direction="inline" gap="base">
                      <s-heading>{item.issue}</s-heading>
                      <PriorityBadge priority={item.priority} />
                    </s-stack>

                    <s-paragraph>
                      <strong>Impact:</strong> {item.impact}
                    </s-paragraph>

                    <s-paragraph>
                      <strong>Recommended action:</strong>{" "}
                      {item.action}
                    </s-paragraph>
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          </s-section>

          {Array.isArray(analysis.executions) &&
            analysis.executions.length > 0 && (
              <s-section heading="Batch Execution">
                <s-stack direction="block" gap="base">
                  <s-paragraph>
                    Customer Voice AI found{" "}
                    <strong>
                      {analysis.executions.length}
                    </strong>{" "}
                    executable optimization
                    {analysis.executions.length === 1
                      ? ""
                      : "s"}
                    . All safe changes are selected by default.
                  </s-paragraph>

                  <s-button
                    onClick={() => {
                      const changes =
                        analysis.executions
                          .map((item, index) => ({
                            ...item,
                            executionId:
                              item.executionId ||
                              `${item.target || "execution"}-${index}`,
                          }))
                          .filter(
                            (item) => item.canExecute,
                          );

                      if (!changes.length) {
                        return;
                      }

                      const form = new FormData();
                      form.append(
                        "intent",
                        "preview_executions",
                      );
                      form.append(
                        "executions",
                        JSON.stringify(changes),
                      );
                      fetcher.submit(form, {
                        method: "post",
                      });
                    }}
                  >
                    Review All Shopify Changes
                  </s-button>

                  {executionPreviews.length > 0 && (
                    <s-stack
                      direction="block"
                      gap="base"
                    >
                      <s-divider />

                      <s-heading>
                        Shopify Changes
                      </s-heading>

                      <s-paragraph>
                        {
                          executionPreviews.filter(
                            (item) => item.canApply,
                          ).length
                        }{" "}
                        safe change
                        {executionPreviews.filter(
                          (item) => item.canApply,
                        ).length === 1
                          ? ""
                          : "s"}{" "}
                        ready for batch apply.
                      </s-paragraph>

                      {executionPreviews.map(
                        (preview) => {
                          const selected =
                            selectedExecutionIds.includes(
                              preview.executionId,
                            );

                          const diff = buildTextDiff(
                            preview.before || "",
                            preview.after || "",
                          );

                          return (
                            <s-box
                              key={preview.executionId}
                              padding="base"
                              borderWidth="base"
                              borderRadius="base"
                            >
                              <s-stack
                                direction="block"
                                gap="base"
                              >
                                <s-stack
                                  direction="inline"
                                  gap="base"
                                >
                                  {preview.canApply ? (
                                    <label
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "8px",
                                        fontWeight: "600",
                                        flex: "1",
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={selected}
                                        onChange={(event) => {
                                          setSelectedExecutionIds(
                                            (current) =>
                                              event.target.checked
                                                ? [
                                                    ...new Set([
                                                      ...current,
                                                      preview.executionId,
                                                    ]),
                                                  ]
                                                : current.filter(
                                                    (id) =>
                                                      id !==
                                                      preview.executionId,
                                                  ),
                                          );
                                        }}
                                      />
                                      <span>
                                        {preview.productTitle ||
                                          preview.target ||
                                          "Product"}
                                      </span>
                                    </label>
                                  ) : (
                                    <s-heading>
                                      {preview.productTitle ||
                                        preview.target ||
                                        "Product"}
                                    </s-heading>
                                  )}

                                  <s-badge
                                    tone={
                                      preview.canApply
                                        ? "success"
                                        : "critical"
                                    }
                                  >
                                    {preview.canApply
                                      ? "Ready"
                                      : "Blocked"}
                                  </s-badge>
                                </s-stack>

                                <s-paragraph>
                                  <strong>Target:</strong>{" "}
                                  {preview.target ||
                                    preview.productTitle ||
                                    "Product"}
                                </s-paragraph>

                                {preview.reason && (
                                  <s-banner
                                    tone={
                                      preview.canApply
                                        ? "info"
                                        : "critical"
                                    }
                                  >
                                    <s-paragraph>
                                      {preview.reason}
                                    </s-paragraph>
                                  </s-banner>
                                )}

                                {preview.canApply && (
                                  <s-box
                                    padding="base"
                                    borderWidth="base"
                                    borderRadius="base"
                                    background="subdued"
                                  >
                                    <s-stack
                                      direction="block"
                                      gap="small"
                                    >
                                      <s-paragraph>
                                        <strong>
                                          Proposed change
                                        </strong>
                                      </s-paragraph>

                                      <s-paragraph>
                                        {preview.changeSummary ||
                                          "Customer-feedback optimization ready to apply."}
                                      </s-paragraph>

                                      <s-paragraph>
                                        {diff.added} added ·{" "}
                                        {diff.removed} removed
                                      </s-paragraph>
                                    </s-stack>
                                  </s-box>
                                )}

                                <details>
                                  <summary>
                                    View full before / after
                                  </summary>

                                  <s-stack
                                    direction="block"
                                    gap="small"
                                  >
                                    <s-paragraph>
                                      <strong>
                                        Before:
                                      </strong>
                                    </s-paragraph>

                                    <s-box
                                      padding="base"
                                      borderWidth="base"
                                      borderRadius="base"
                                      background="subdued"
                                    >
                                      <div
                                        dangerouslySetInnerHTML={{
                                          __html:
                                            preview.before ||
                                            "<p>(empty)</p>",
                                        }}
                                      />
                                    </s-box>

                                    <s-paragraph>
                                      <strong>
                                        Proposed after:
                                      </strong>
                                    </s-paragraph>

                                    <s-box
                                      padding="base"
                                      borderWidth="base"
                                      borderRadius="base"
                                    >
                                      <div
                                        dangerouslySetInnerHTML={{
                                          __html:
                                            preview.after ||
                                            "<p>(empty)</p>",
                                        }}
                                      />
                                    </s-box>

                                    <s-paragraph>
                                      <strong>
                                        Highlighted changes:
                                      </strong>{" "}
                                      {diff.added} added ·{" "}
                                      {diff.removed} removed
                                    </s-paragraph>

                                    <s-box
                                      padding="base"
                                      borderWidth="base"
                                      borderRadius="base"
                                    >
                                      <div
                                        style={{
                                          whiteSpace: "pre-wrap",
                                          lineHeight: "1.7",
                                        }}
                                        dangerouslySetInnerHTML={{
                                          __html:
                                            diff.html ||
                                            "<span>(no changes)</span>",
                                        }}
                                      />
                                    </s-box>
                                  </s-stack>
                                </details>

                                {preview.canApply && (
                                  <s-button
                                    variant="secondary"
                                    onClick={() => {
                                      const nextSelected =
                                        selected
                                          ? selectedExecutionIds.filter(
                                              (id) =>
                                                id !==
                                                preview.executionId,
                                            )
                                          : [
                                              ...new Set([
                                                ...selectedExecutionIds,
                                                preview.executionId,
                                              ]),
                                            ];

                                      setSelectedExecutionIds(
                                        nextSelected,
                                      );
                                    }}
                                  >
                                    {selected
                                      ? "Remove from Apply"
                                      : "Add to Apply"}
                                  </s-button>
                                )}
                              </s-stack>
                            </s-box>
                          );
                        },
                      )}

                      <s-button
                        variant="primary"
                        disabled={
                          selectedExecutionIds.length ===
                            0 ||
                          fetcher.state !== "idle"
                        }
                        onClick={() => {
                          const selected =
                            executionPreviews.filter(
                              (item) =>
                                selectedExecutionIds.includes(
                                  item.executionId,
                                ),
                            );

                          if (!selected.length) {
                            return;
                          }

                          const form = new FormData();
                          form.append(
                            "intent",
                            "apply_executions",
                          );
                          form.append(
                            "executions",
                            JSON.stringify(selected),
                          );
                          fetcher.submit(form, {
                            method: "post",
                          });
                        }}
                      >
                        Apply{" "}
                        {selectedExecutionIds.length}{" "}
                        Selected Changes
                      </s-button>
                    </s-stack>
                  )}

                  {batchExecutionResult && (
                    <s-banner
                      tone={
                        batchExecutionResult.successCount ===
                        batchExecutionResult.total
                          ? "success"
                          : "warning"
                      }
                    >
                      {
                        batchExecutionResult.successCount
                      }{" "}
                      of{" "}
                      {batchExecutionResult.total}{" "}
                      changes applied successfully.
                    </s-banner>
                  )}

                  {batchExecutionResult &&
                    batchExecutionResult.results?.some(
                      (item) => !item.success,
                    ) && (
                      <s-box
                        padding="base"
                        borderWidth="base"
                        borderRadius="base"
                      >
                        <s-stack
                          direction="block"
                          gap="small"
                        >
                          <s-heading>
                            Changes That Need Attention
                          </s-heading>

                          {batchExecutionResult.results
                            .filter(
                              (item) => !item.success,
                            )
                            .map((item) => (
                              <s-paragraph
                                key={
                                  item.executionId
                                }
                              >
                                <strong>
                                  {item.target ||
                                    item.executionId}
                                </strong>
                                : {item.error}
                              </s-paragraph>
                            ))}

                          {executionPreviews.length >
                            0 && (
                            <s-button
                              onClick={() => {
                                const retryItems =
                                  executionPreviews.filter(
                                    (item) =>
                                      batchExecutionResult.results.some(
                                        (result) =>
                                          !result.success &&
                                          result.executionId ===
                                            item.executionId,
                                      ),
                                  );

                                if (
                                  !retryItems.length
                                ) {
                                  return;
                                }

                                const form =
                                  new FormData();

                                form.append(
                                  "intent",
                                  "apply_executions",
                                );

                                form.append(
                                  "executions",
                                  JSON.stringify(
                                    retryItems,
                                  ),
                                );

                                fetcher.submit(
                                  form,
                                  {
                                    method: "post",
                                  },
                                );
                              }}
                            >
                              Retry Failed Changes
                            </s-button>
                          )}
                        </s-stack>
                      </s-box>
                    )}
                </s-stack>
              </s-section>
            )}

          {!analysis?.executions?.length &&
            analysis?.execution && (
            <s-section heading="Execution Preview">
              <s-stack direction="block" gap="base">
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-stack direction="block" gap="small">
                    <s-heading>
                      {analysis.execution.actionType ===
                      "update_product_description"
                        ? "Update product description"
                        : "Recommended execution"}
                    </s-heading>

                    <s-paragraph>
                      <strong>Target:</strong>{" "}
                      {analysis.execution.target || "Not specified"}
                    </s-paragraph>

                    <s-paragraph>
                      <strong>Status:</strong>{" "}
                      {analysis.execution.canExecute
                        ? "Ready for review"
                        : "Cannot safely apply yet"}
                    </s-paragraph>

                    <s-paragraph>
                      <strong>Proposed change:</strong>
                    </s-paragraph>

                    <s-box
                      padding="base"
                      borderWidth="base"
                      borderRadius="base"
                    >
                      <s-paragraph>
                        {analysis.execution.proposedChange ||
                          "No safe proposed change was generated."}
                      </s-paragraph>
                    </s-box>

                    {!analysis.execution.canExecute && (
                      <s-paragraph>
                        This action is blocked because the proposed change is
                        incomplete or contains unsupported product information.
                      </s-paragraph>
                    )}

                    {analysis.execution.canExecute && (
                      <s-button
                        onClick={() => {
                          const form = new FormData();
                          form.append("intent", "preview_execution");
                          form.append(
                            "target",
                            analysis.execution.target || "",
                          );
                          form.append(
                            "proposedChange",
                            analysis.execution.proposedChange || "",
                          );
                          fetcher.submit(form, { method: "post" });
                        }}
                      >
                        Review Shopify changes
                      </s-button>
                    )}
                  </s-stack>
                </s-box>

                {executionPreview && (
                  <s-box
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                  >
                    <s-stack direction="block" gap="base">
                      <s-heading>Shopify Change Preview</s-heading>

                      <s-paragraph>
                        <strong>Product:</strong>{" "}
                        {executionPreview.productTitle}
                      </s-paragraph>

                      <s-paragraph>
                        <strong>Before:</strong>
                      </s-paragraph>

                      <s-box
                        padding="base"
                        borderWidth="base"
                        borderRadius="base"
                        background="subdued"
                      >
                        <div
                          dangerouslySetInnerHTML={{
                            __html:
                              executionPreview.before || "<p>(empty)</p>",
                          }}
                        />
                      </s-box>

                      <s-paragraph>
                        <strong>Proposed after:</strong>
                      </s-paragraph>

                      <s-box
                        padding="base"
                        borderWidth="base"
                        borderRadius="base"
                      >
                        <div
                          dangerouslySetInnerHTML={{
                            __html:
                              executionPreview.after || "<p>(empty)</p>",
                          }}
                        />
                      </s-box>

                      {(() => {
                        const diff = buildTextDiff(
                          executionPreview.before || "",
                          executionPreview.after || "",
                        );

                        return (
                          <>
                            <s-divider />

                            <s-heading>Highlighted Changes</s-heading>

                            <s-paragraph>
                              <span
                                style={{
                                  backgroundColor: "#ffd6d6",
                                  color: "#8a1c1c",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  textDecoration: "line-through",
                                }}
                              >
                                Removed
                              </span>
                              {" "}
                              <span
                                style={{
                                  backgroundColor: "#d9f7df",
                                  color: "#146c2e",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                }}
                              >
                                Added
                              </span>
                              {" · "}
                              {diff.added} added · {diff.removed} removed
                            </s-paragraph>

                            <s-box
                              padding="base"
                              borderWidth="base"
                              borderRadius="base"
                            >
                              <div
                                style={{
                                  whiteSpace: "pre-wrap",
                                  lineHeight: "1.7",
                                }}
                                dangerouslySetInnerHTML={{
                                  __html:
                                    diff.html || "<span>(no text changes)</span>",
                                }}
                              />
                            </s-box>
                          </>
                        );
                      })()}

                      {executionPreview.canApply ? (
                        <s-button
                          onClick={() => {
                            const form = new FormData();
                            form.append("intent", "apply_execution");
                            form.append(
                              "productId",
                              executionPreview.productId,
                            );
                            form.append(
                              "proposedChange",
                              executionPreview.after,
                            );
                            fetcher.submit(form, { method: "post" });
                          }}
                        >
                          Apply to Shopify
                        </s-button>
                      ) : (
                        <s-paragraph>
                          Apply is disabled because this change is not safe to
                          execute.
                        </s-paragraph>
                      )}
                    </s-stack>
                  </s-box>
                )}

                {fetcher.data?.executionApplied && (
                  <s-banner tone="success">
                    Shopify product description updated successfully.
                  </s-banner>
                )}
              </s-stack>
            </s-section>
          )}

          {history.length > 0 && (
        <s-section heading="Recent Analyses">
          <s-stack direction="block" gap="base">
            {history.map((item) => (
              <s-box
                key={item.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-heading>
                    {item.source_feedback_count} feedback responses
                  </s-heading>

                  <s-paragraph>
                    {formatDate(item.created_at)}
                  </s-paragraph>

                  <s-paragraph>
                    Analyzer: {item.provider || "unknown"}
                    {item.model ? ` · ${item.model}` : ""}
                  </s-paragraph>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      )}

      <s-section heading="Analyzer Mode">
            <s-paragraph>
              {fetcher.data?.mode === "demo"
                ? "Demo analyzer is active. Analysis is generated locally using deterministic rules. No external AI API is being used."
                : `AI analyzer: ${fetcher.data?.mode || "unknown"}.`}
            </s-paragraph>
          </s-section>
        </>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
