export const TOPIC_NAMES = [
  "Shipping & Delivery",
  "Sizing & Fit",
  "Returns & Refunds",
  "Product Quality",
  "Price & Value",
  "Customer Service",
];

const HIGH_PRIORITY_TOPICS = new Set([
  "Shipping & Delivery",
  "Product Quality",
  "Returns & Refunds",
]);

export function splitFeedback(feedback) {
  return String(feedback || "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getPriority(topic, sentiment) {
  if (sentiment === "Negative" && HIGH_PRIORITY_TOPICS.has(topic)) {
    return "High";
  }

  if (sentiment === "Negative") {
    return "Medium";
  }

  if (sentiment === "Positive") {
    return "Positive Signal";
  }

  return "Monitor";
}

function buildInsight(topicCounts, sentimentCounts, total) {
  const insights = [];

  if (total === 0) {
    return [
      "More customer feedback is needed to identify recurring customer patterns.",
    ];
  }

  if (sentimentCounts.Positive > sentimentCounts.Negative) {
    insights.push(
      "Customers are showing more positive than negative sentiment in this dataset.",
    );
  } else if (sentimentCounts.Negative > sentimentCounts.Positive) {
    insights.push(
      "Negative sentiment currently outweighs positive sentiment and may require attention.",
    );
  } else {
    insights.push(
      "Positive and negative sentiment are currently balanced in this dataset.",
    );
  }

  if (topicCounts[0]) {
    insights.push(
      `${topicCounts[0].name} is the most frequently mentioned topic, appearing in ${topicCounts[0].count} of ${total} responses.`,
    );
  }

  const positiveTopic = topicCounts.find((topic) => topic.positiveCount > 0);

  if (positiveTopic) {
    insights.push(
      `${positiveTopic.name} shows positive customer signals and may represent an area to maintain or promote.`,
    );
  }

  const negativeTopic = topicCounts.find((topic) => topic.negativeCount > 0);

  if (negativeTopic) {
    insights.push(
      `${negativeTopic.name} includes negative customer feedback and should be reviewed for possible improvement.`,
    );
  }

  return insights.slice(0, 4);
}

function buildActions(topicCounts) {
  const actions = [];

  for (const topic of topicCounts) {
    if (topic.name === "Shipping & Delivery" && topic.negativeCount > 0) {
      actions.push({
        priority: "High",
        issue: "Shipping & Delivery",
        impact: "Negative customer sentiment",
        action:
          "Review delivery estimates and improve order-status communication.",
      });
    }

    if (topic.name === "Sizing & Fit" && topic.negativeCount > 0) {
      actions.push({
        priority: "Medium",
        issue: "Sizing & Fit",
        impact: "Customers may hesitate to purchase or keep the product",
        action:
          "Improve size charts, fit descriptions, and pre-purchase guidance.",
      });
    }

    if (topic.name === "Returns & Refunds" && topic.negativeCount > 0) {
      actions.push({
        priority: "High",
        issue: "Returns & Refunds",
        impact: "Potential friction after purchase",
        action:
          "Make the return and refund process easier to understand and access.",
      });
    }

    if (topic.name === "Product Quality" && topic.negativeCount > 0) {
      actions.push({
        priority: "High",
        issue: "Product Quality",
        impact: "Potential product dissatisfaction",
        action:
          "Investigate recurring quality complaints and identify affected products.",
      });
    }

    if (topic.name === "Price & Value" && topic.negativeCount > 0) {
      actions.push({
        priority: "Medium",
        issue: "Price & Value",
        impact: "Potential purchase hesitation",
        action:
          "Improve pricing transparency and communicate product value more clearly.",
      });
    }

    if (topic.name === "Customer Service" && topic.negativeCount > 0) {
      actions.push({
        priority: "Medium",
        issue: "Customer Service",
        impact: "Potential support dissatisfaction",
        action:
          "Review customer-support response times and recurring support questions.",
      });
    }
  }

  if (actions.length === 0) {
    actions.push({
      priority: "Monitor",
      issue: "No major negative issue detected",
      impact: "Limited evidence of recurring customer problems",
      action: "Continue collecting feedback to identify emerging patterns.",
    });
  }

  return actions.slice(0, 5);
}

export function aggregateClassifications(classifiedFeedback) {
  const sentimentCounts = {
    Positive: classifiedFeedback.filter((item) => item.sentiment === "Positive")
      .length,
    Neutral: classifiedFeedback.filter((item) => item.sentiment === "Neutral")
      .length,
    Negative: classifiedFeedback.filter((item) => item.sentiment === "Negative")
      .length,
  };

  const total = classifiedFeedback.length;

  const topicCounts = TOPIC_NAMES.map((name) => {
    const matching = classifiedFeedback.filter((item) =>
      item.topics.includes(name),
    );

    return {
      name,
      count: matching.length,
      positiveCount: matching.filter((item) => item.sentiment === "Positive")
        .length,
      negativeCount: matching.filter((item) => item.sentiment === "Negative")
        .length,
      neutralCount: matching.filter((item) => item.sentiment === "Neutral")
        .length,
      percentage: total > 0 ? Math.round((matching.length / total) * 100) : 0,
    };
  })
    .filter((topic) => topic.count > 0)
    .sort((a, b) => b.count - a.count);

  const priorityIssues = topicCounts
    .filter((topic) => topic.negativeCount > 0)
    .map((topic) => ({
      topic: topic.name,
      priority: getPriority(topic.name, "Negative"),
      negativeCount: topic.negativeCount,
      percentage: total > 0 ? Math.round((topic.negativeCount / total) * 100) : 0,
    }))
    .sort((a, b) => b.negativeCount - a.negativeCount);

  return {
    feedbackCount: total,
    sentimentCounts,
    topicCounts,
    insights: buildInsight(topicCounts, sentimentCounts, total),
    actions: buildActions(topicCounts),
    priorityIssues,
    classifiedFeedback,
  };
}
