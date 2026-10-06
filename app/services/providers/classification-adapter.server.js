import { TOPIC_NAMES } from "../analysis-aggregate.server.js";

const SENTIMENTS = new Set(["Positive", "Neutral", "Negative"]);
const ALLOWED_TOPICS = new Set(TOPIC_NAMES);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function extractRows(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];

  for (const key of ["items", "classifications", "results", "feedback"]) {
    if (Array.isArray(raw[key])) return raw[key];
  }

  return [];
}

function normalizeTopics(value) {
  const topics = [];

  for (const topic of asArray(value)) {
    const match = TOPIC_NAMES.find(
      (name) => name.toLowerCase() === String(topic).trim().toLowerCase(),
    );

    if (match && !topics.includes(match)) topics.push(match);
  }

  return topics.filter((topic) => ALLOWED_TOPICS.has(topic));
}

export function toClassifiedFeedback(entries, raw) {
  const rows = extractRows(raw);

  return entries.map((text, index) => {
    const row =
      rows.find((item) => Number(item?.index) === index) ||
      rows.find((item) => Number(item?.id) === index + 1) ||
      rows[index] ||
      {};

    const sentiment = SENTIMENTS.has(row.sentiment) ? row.sentiment : "Neutral";
    const topics = normalizeTopics(row.topics || row.topic);

    return {
      id: index + 1,
      text,
      sentiment,
      topics,
      primaryTopic: topics[0] || "General Feedback",
    };
  });
}

export function parseModelJson(content) {
  const text = String(content || "").trim();

  if (!text) {
    throw new Error("External AI provider returned an empty response.");
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;

  try {
    return JSON.parse(candidate);
  } catch {
    throw new Error("External AI provider returned invalid JSON.");
  }
}
