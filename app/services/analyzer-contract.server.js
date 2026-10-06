const SENTIMENTS = new Set(["Positive", "Neutral", "Negative"]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Invalid analysis result: ${message}`);
  }
}

function validateString(value, field) {
  assert(typeof value === "string", `${field} must be a string`);
}

function validateArray(value, field) {
  assert(Array.isArray(value), `${field} must be an array`);
}

export function validateAnalysisResult(result) {
  assert(result && typeof result === "object", "result must be an object");

  assert(
    Array.isArray(result.classifiedFeedback),
    "classifiedFeedback must be an array",
  );

  for (const item of result.classifiedFeedback) {
    assert(item && typeof item === "object", "feedback item must be an object");
    assert(typeof item.id === "number", "feedback item id must be a number");
    assert(typeof item.text === "string", "feedback item text must be a string");
    assert(
      SENTIMENTS.has(item.sentiment),
      `invalid sentiment: ${item.sentiment}`,
    );
    assert(Array.isArray(item.topics), "topics must be an array");
    assert(
      typeof item.primaryTopic === "string",
      "primaryTopic must be a string",
    );
  }

  if (result.summary !== undefined) {
    validateString(result.summary, "summary");
  }

  if (result.issues !== undefined) {
    validateArray(result.issues, "issues");

    for (const issue of result.issues) {
      assert(issue && typeof issue === "object", "issue must be an object");
      validateString(issue.title, "issue.title");
      validateString(issue.topic, "issue.topic");
      validateString(issue.evidence, "issue.evidence");
      validateString(issue.likelyCause, "issue.likelyCause");
      validateString(issue.businessImpact, "issue.businessImpact");
      assert(
        ["High", "Medium", "Low"].includes(issue.priority),
        `invalid issue priority: ${issue.priority}`,
      );
    }
  }

  if (result.recommendations !== undefined) {
    validateArray(result.recommendations, "recommendations");

    for (const recommendation of result.recommendations) {
      assert(
        recommendation && typeof recommendation === "object",
        "recommendation must be an object",
      );
      validateString(recommendation.title, "recommendation.title");
      validateString(
        recommendation.action,
        "recommendation.action",
      );
      validateString(
        recommendation.reason,
        "recommendation.reason",
      );
      validateString(
        recommendation.expectedImpact,
        "recommendation.expectedImpact",
      );
      assert(
        ["High", "Medium", "Low"].includes(recommendation.priority),
        `invalid recommendation priority: ${recommendation.priority}`,
      );
    }
  }

  const executionItems =
    Array.isArray(result.executions)
      ? result.executions
      : result.execution !== undefined
        ? [result.execution]
        : [];

  for (const execution of executionItems) {
    assert(
      execution && typeof execution === "object",
      "execution item must be an object",
    );
    assert(
      typeof execution.canExecute === "boolean",
      "execution.canExecute must be a boolean",
    );

    if (execution.canExecute) {
      validateString(
        execution.actionType,
        "execution.actionType",
      );
      validateString(
        execution.target,
        "execution.target",
      );
      validateString(
        execution.proposedChange,
        "execution.proposedChange",
      );
    }
  }

  return true;
}

export function normalizeAnalysisResult(result) {
  return {
    ...result,

    summary:
      typeof result.summary === "string" && result.summary.trim()
        ? result.summary.trim()
        : "",

    issues: Array.isArray(result.issues)
      ? result.issues.slice(0, 10).map((issue) => ({
          title: String(issue.title || "").trim(),
          topic: String(issue.topic || "").trim(),
          evidence: String(issue.evidence || "").trim(),
          likelyCause: String(issue.likelyCause || "").trim(),
          businessImpact: String(issue.businessImpact || "").trim(),
          priority: ["High", "Medium", "Low"].includes(issue.priority)
            ? issue.priority
            : "Medium",
        }))
      : [],

    recommendations: Array.isArray(result.recommendations)
      ? result.recommendations.slice(0, 10).map((item) => ({
          title: String(item.title || "").trim(),
          action: String(item.action || "").trim(),
          reason: String(item.reason || "").trim(),
          expectedImpact: String(item.expectedImpact || "").trim(),
          priority: ["High", "Medium", "Low"].includes(item.priority)
            ? item.priority
            : "Medium",
        }))
      : [],

    executions: (
      Array.isArray(result.executions)
        ? result.executions
        : result.execution
          ? [result.execution]
          : []
    )
      .slice(0, 20)
      .map((item) => ({
        canExecute: Boolean(item?.canExecute),
        actionType: String(item?.actionType || ""),
        target: String(item?.target || ""),
        proposedChange: String(
          item?.proposedChange || "",
        ),
      })),
    execution: {
      canExecute: Boolean(
        (
          Array.isArray(result.executions)
            ? result.executions[0]
            : result.execution
        )?.canExecute,
      ),
      actionType: String(
        (
          Array.isArray(result.executions)
            ? result.executions[0]
            : result.execution
        )?.actionType || "",
      ),
      target: String(
        (
          Array.isArray(result.executions)
            ? result.executions[0]
            : result.execution
        )?.target || "",
      ),
      proposedChange: String(
        (
          Array.isArray(result.executions)
            ? result.executions[0]
            : result.execution
        )?.proposedChange || "",
      ),
    },

    classifiedFeedback: result.classifiedFeedback.map((item, index) => ({
      ...item,
      id: index + 1,
      text: String(item.text || ""),
      sentiment: SENTIMENTS.has(item.sentiment)
        ? item.sentiment
        : "Neutral",
      topics: Array.isArray(item.topics) ? item.topics : [],
      primaryTopic:
        typeof item.primaryTopic === "string" && item.primaryTopic.trim()
          ? item.primaryTopic
          : "General Feedback",
    })),
  };
}
