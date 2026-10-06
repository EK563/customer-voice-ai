import {
  aggregateClassifications,
  splitFeedback,
} from "./analysis-aggregate.server.js";

const TOPICS = [
  {
    name: "Shipping & Delivery",
    keywords: ["shipping", "delivery", "late", "slow", "arrived"],
  },
  {
    name: "Sizing & Fit",
    keywords: ["size", "sizing", "fit", "small", "large", "uncomfortable"],
  },
  {
    name: "Returns & Refunds",
    keywords: ["return", "refund", "exchange"],
  },
  {
    name: "Product Quality",
    keywords: [
      "quality",
      "broken",
      "damaged",
      "defective",
      "durable",
      "excellent",
    ],
  },
  {
    name: "Price & Value",
    keywords: ["price", "expensive", "cheap", "value", "worth"],
  },
  {
    name: "Customer Service",
    keywords: ["service", "support", "help", "staff", "response"],
  },
];

const POSITIVE_WORDS = [
  "great",
  "good",
  "love",
  "excellent",
  "happy",
  "fast",
  "easy",
  "comfortable",
  "perfect",
  "amazing",
  "helpful",
];

const NEGATIVE_WORDS = [
  "bad",
  "poor",
  "hate",
  "slow",
  "late",
  "broken",
  "damaged",
  "expensive",
  "refund",
  "return",
  "wrong",
  "problem",
  "issue",
  "disappointed",
  "uncomfortable",
];

export function detectSentiment(text) {
  const normalized = text.toLowerCase();

  const positive = POSITIVE_WORDS.filter((word) =>
    normalized.includes(word),
  ).length;

  const negative = NEGATIVE_WORDS.filter((word) =>
    normalized.includes(word),
  ).length;

  if (positive > negative && positive > 0) {
    return "Positive";
  }

  if (negative > positive && negative > 0) {
    return "Negative";
  }

  return "Neutral";
}

export function detectTopics(text) {
  const normalized = text.toLowerCase();

  return TOPICS.filter((topic) =>
    topic.keywords.some((keyword) => normalized.includes(keyword)),
  ).map((topic) => topic.name);
}

export function analyzeFeedback(feedback) {
  const entries = splitFeedback(feedback);

  const classifiedFeedback = entries.map((text, index) => {
    const topics = detectTopics(text);

    return {
      id: index + 1,
      text,
      sentiment: detectSentiment(text),
      topics,
      primaryTopic: topics[0] || "General Feedback",
    };
  });

  return aggregateClassifications(classifiedFeedback);
}
