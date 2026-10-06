import { ProxyAgent } from "undici";

import {
  aggregateClassifications,
  splitFeedback,
  TOPIC_NAMES,
} from "../analysis-aggregate.server.js";

import { detectSentiment, detectTopics } from "../demo-analyzer.server.js";

import {
  parseModelJson,
  toClassifiedFeedback,
} from "./classification-adapter.server.js";

import { resolveProviderConfig } from "./provider-config.server.js";

const proxyUrl = "http://127.0.0.1:7890";

const dispatcher = new ProxyAgent(proxyUrl);

function normalizeEntries(entries) {
  return entries
    .map((entry) => {
      if (typeof entry === "string") {
        return {
          text: entry.trim(),
          productName: null,
          productContext: null,
        };
      }

      return {
        text: String(entry?.text || "").trim(),
        productName:
          entry?.productName === null ||
          entry?.productName === undefined
            ? null
            : String(entry.productName).trim() || null,
        productContext:
          entry?.productContext &&
          typeof entry.productContext === "object"
            ? entry.productContext
            : null,
      };
    })
    .filter((entry) => entry.text);
}

function buildPrompt(entries, offset) {
  return [
    "Analyze ecommerce customer feedback.",
    "",
    "Return JSON only.",
    "",
    "The JSON must have exactly this top-level shape:",
    `{
  "items": [
    {
      "index": 0,
      "sentiment": "Positive|Neutral|Negative",
      "topics": ["Sizing & Fit"]
    }
  ],
  "summary": "Short summary of the most important customer signal.",
  "issues": [
    {
      "title": "Clear issue title",
      "topic": "Sizing & Fit",
      "evidence": "What customers specifically complained about.",
      "likelyCause": "Most plausible cause supported by the feedback.",
      "businessImpact": "How this could affect conversion, returns, satisfaction, or revenue.",
      "priority": "High|Medium|Low"
    }
  ],
  "recommendations": [
    {
      "title": "Specific improvement",
      "action": "Concrete action the merchant should take.",
      "reason": "Why this action addresses the customer issue.",
      "expectedImpact": "Expected business/customer impact.",
      "priority": "High|Medium|Low"
    }
  ],
    "executions": [
      {
        "canExecute": true,
        "actionType": "update_product_description",
        "target": "The Draft Snowboard",
        "proposedChange": "A complete replacement product description using only verified facts from the current Shopify product context."
      }
    ]
}`,
    "",
    `Allowed topics: ${TOPIC_NAMES.join(", ")}.`,
    "",
    "Rules:",
    "- Classify every feedback item.",
    "- Use only the allowed topic names.",
    "- Use an empty topics array when no topic clearly applies.",
    "- index is the 0-based index within this batch.",
    "- Identify every clear customer problem, friction point, missing information, or improvement opportunity, even when the overall sentiment is Positive.",
    "- A positive review can still contain an actionable issue. Do not ignore an issue merely because the customer also praised the product.",
    "- Do not require an issue to be recurring or negative. A single specific issue should be included when it is concrete and materially useful.",
    "- Treat explicit statements such as 'description could be clearer', 'need more sizing information', or 'need more material details' as actionable product-content issues.",
    "- When a customer identifies missing or unclear product information, the issue should describe the information gap rather than misclassifying it as product quality or sizing unless the customer actually complains about those things.",
    "- Do not invent facts that are not supported by the feedback.",
    "- Recommendations must be concrete and useful to an ecommerce merchant.",
    "- Product names are provided separately when available.",
    "- If the feedback identifies a specific product content problem and a product name is available, propose an execution when the requested content change can be safely derived from the feedback.",
    '- For product-description problems, actionType must be "update_product_description". Generate one execution per distinct product. Do not create duplicate executions for the same product; combine its supported changes into one complete replacement description.',
    "- target must contain the exact product name provided with the feedback.",
    "- proposedChange must contain the complete proposed replacement description, not merely instructions.",
    "- Shopify product context is authoritative for product facts.",
    "- Use the current Shopify description, vendor, product type, options, and variants when deciding whether an execution is safe.",
    "- Never invent material, sizing, dimensions, performance characteristics, ingredients, compatibility, or other product specifications.",
    "- If the customer asks for information that is absent from Shopify product context, do not fabricate it.",
    "- If the current Shopify description is empty or lacks the facts needed to make the requested change safe, set canExecute=false rather than inserting placeholders.",
    "- Never use bracketed placeholders such as [add sizing here], [merchant to insert], or similar text in proposedChange.",
    "- If the current description already contains enough factual information to safely improve clarity, produce a complete replacement description using only those facts.",
    "- Preserve supported facts from the existing description unless the customer feedback specifically indicates that a fact should be changed.",
    "- For update_product_description, proposedChange must always be a complete replacement product description that is safe to apply, not merely a list of instructions.",
    "- If there is not enough evidence for a safe execution, set canExecute=false and leave actionType, target, and proposedChange empty.",
    "",
    "Shopify product context:",
    ...entries.map((entry) => {
      const context = entry.productContext;

      if (!context) {
        return [
          `Product: ${entry.productName || "Unknown"}`,
          "Shopify context: Not available.",
        ].join("\n");
      }

      return [
        `Product: ${context.title || entry.productName || "Unknown"}`,
        `Vendor: ${context.vendor || "Unknown"}`,
        `Product type: ${context.productType || "Unknown"}`,
        `Current description: ${
          context.descriptionHtml
            ? context.descriptionHtml.replace(/\s+/g, " ").slice(0, 5000)
            : "(empty)"
        }`,
        `Options: ${
          Array.isArray(context.options)
            ? context.options
                .map((option) => `${option.name}: ${option.values.join(", ")}`)
                .join("; ")
            : "Unknown"
        }`,
        `Variants: ${
          Array.isArray(context.variants)
            ? context.variants
                .map((variant) => variant.title)
                .join(", ")
            : "Unknown"
        }`,
      ].join("\n");
    }),
    "",
    "Feedback items:",
    ...entries.map(
      (entry, index) =>
        [
          `Index: ${offset + index}`,
          `Product: ${entry.productName || "Unknown"}`,
          `Feedback: ${entry.text.replace(/\s+/g, " ").slice(0, 1500)}`,
        ].join("\n"),
    ),
  ].join("\n");
}

async function requestClassification(config, entries, offset) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const endpoint = `${config.baseUrl}/chat/completions`;

    console.log("External AI request:", {
      vendor: config.vendor,
      model: config.model,
      endpoint,
      hasApiKey: Boolean(config.apiKey),
      timeoutMs: config.timeoutMs,
    });
    console.log(
      "DEBUG productContext before Gemini:",
      JSON.stringify(
        entries.map((entry) => ({
          productName: entry.productName,
          productContext: entry.productContext,
        })),
        null,
        2,
      ),
    );
    const response = await fetch(
      endpoint,
      {
        method: "POST",
        dispatcher,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are an ecommerce customer-experience analyst. Analyze customer feedback conservatively and produce structured JSON only. Recommendations must be actionable. Never invent evidence.",
            },
            {
              role: "user",
              content: buildPrompt(entries, offset),
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();

      throw new Error(
        `External AI provider request failed (${response.status}): ${errorBody.slice(0, 500)}`,
      );
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    const parsed = parseModelJson(content);

    console.log("External AI parsed analysis:", JSON.stringify(parsed, null, 2));

    return {
      classifications: toClassifiedFeedback(
        entries.map((entry) => entry.text),
        parsed,
      ),
      analysis: parsed,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("External AI provider timed out.");
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function classifyBatchLocally(entries) {
  return entries.map((entry, index) => {
    const topics = detectTopics(entry.text);

    return {
      id: index + 1,
      text: entry.text,
      sentiment: detectSentiment(entry.text),
      topics,
      primaryTopic: topics[0] || "General Feedback",
    };
  });
}

async function analyzeEntries(
  entries,
  config = resolveProviderConfig(),
) {
  const normalizedEntries = normalizeEntries(entries);

  if (!normalizedEntries.length) {
    throw new Error("No feedback entries to analyze.");
  }

  if (config.api !== "openai-chat") {
    throw new Error(
      `Unsupported AI API style: ${config.api}`,
    );
  }

  if (!config.dryRun && !config.apiKey) {
    throw new Error(
      "External AI provider is missing AI_API_KEY. Set AI_DRY_RUN=1 to test without a key.",
    );
  }

  const classifiedFeedback = [];
  let aiAnalysis = null;

  for (
    let offset = 0;
    offset < normalizedEntries.length;
    offset += config.batchSize
  ) {
    const batch = normalizedEntries.slice(
      offset,
      offset + config.batchSize,
    );

    if (config.dryRun) {
      classifiedFeedback.push(
        ...classifyBatchLocally(batch).map((item, index) => ({
          ...item,
          id: offset + index + 1,
        })),
      );
      continue;
    }

    const result = await requestClassification(
      config,
      batch,
      offset,
    );

    classifiedFeedback.push(
      ...result.classifications.map((item, index) => ({
        ...item,
        id: offset + index + 1,
      })),
    );

    if (!aiAnalysis) {
      aiAnalysis = result.analysis;
    }
  }

  const aggregated = aggregateClassifications(
    classifiedFeedback,
  );

  if (aiAnalysis) {
    return {
      ...aggregated,
      summary:
        typeof aiAnalysis.summary === "string"
          ? aiAnalysis.summary
          : "",
      issues: Array.isArray(aiAnalysis.issues)
        ? aiAnalysis.issues
        : [],
      recommendations: Array.isArray(aiAnalysis.recommendations)
        ? aiAnalysis.recommendations
        : [],
      executions:
        Array.isArray(aiAnalysis.executions)
          ? aiAnalysis.executions
          : aiAnalysis.execution &&
              typeof aiAnalysis.execution === "object"
            ? [aiAnalysis.execution]
            : [],
      execution:
        (
          Array.isArray(aiAnalysis.executions)
            ? aiAnalysis.executions[0]
            : aiAnalysis.execution
        ) || {
          canExecute: false,
          actionType: "",
          target: "",
          proposedChange: "",
        },
    };
  }

  return {
    ...aggregated,
    summary: "",
    issues: [],
    recommendations: [],
    execution: {
      canExecute: false,
      actionType: "",
      target: "",
      proposedChange: "",
    },
  };
}

export async function analyzeFeedback(
  feedback,
  config = resolveProviderConfig(),
) {
  const entries = splitFeedback(feedback);

  return analyzeEntries(entries, config);
}

export async function analyzeFeedbackEntries(
  entries,
  config = resolveProviderConfig(),
) {
  return analyzeEntries(entries, config);
}
