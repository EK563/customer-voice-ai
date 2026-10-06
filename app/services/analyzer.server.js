import {
  normalizeAnalysisResult,
  validateAnalysisResult,
} from "./analyzer-contract.server.js";
import { resolveProviderConfig } from "./providers/provider-config.server.js";

export const ANALYZER_PROVIDERS = {
  DEMO: "demo",
  EXTERNAL_AI: "external_ai",
};

export function getAnalyzerProvider() {
  return process.env.AI_PROVIDER || ANALYZER_PROVIDERS.DEMO;
}

export function getAnalyzerConfig() {
  const provider = getAnalyzerProvider();
  const external = resolveProviderConfig();

  return {
    provider,
    vendor: provider === ANALYZER_PROVIDERS.EXTERNAL_AI ? external.vendor : null,
    api: provider === ANALYZER_PROVIDERS.EXTERNAL_AI ? external.api : null,
    baseUrl: provider === ANALYZER_PROVIDERS.EXTERNAL_AI ? external.baseUrl : null,
    model:
      process.env.AI_MODEL ||
      (provider === ANALYZER_PROVIDERS.EXTERNAL_AI ? external.model : null),
    apiKey: provider === ANALYZER_PROVIDERS.EXTERNAL_AI ? external.apiKey : "",
    dryRun: provider === ANALYZER_PROVIDERS.EXTERNAL_AI ? external.dryRun : false,
    batchSize: provider === ANALYZER_PROVIDERS.EXTERNAL_AI ? external.batchSize : 30,
    timeoutMs: provider === ANALYZER_PROVIDERS.EXTERNAL_AI ? external.timeoutMs : 60000,
  };
}

export async function analyzeWithAnalyzerEntries(
  entries,
  config = getAnalyzerConfig(),
) {
  if (config.provider === ANALYZER_PROVIDERS.DEMO) {
    const { analyzeFeedback } = await import("./demo-analyzer.server.js");

    const feedback = entries
      .map((entry) => String(entry?.text || "").trim())
      .filter(Boolean)
      .join("\n");

    return normalizeAnalysisResult(
      await analyzeFeedback(feedback),
    );
  }

  if (config.provider === ANALYZER_PROVIDERS.EXTERNAL_AI) {
    const { analyzeFeedbackEntries } = await import(
      "./providers/external-ai.server.js"
    );

    const result = await analyzeFeedbackEntries(
      entries,
      config,
    );

    validateAnalysisResult(result);
    return normalizeAnalysisResult(result);
  }

  throw new Error(`Unknown analyzer provider: ${config.provider}`);
}

export async function analyzeWithAnalyzer({
  feedback,
  provider = getAnalyzerProvider(),
}) {
  let result;

  switch (provider) {
    case ANALYZER_PROVIDERS.DEMO:
      result = await analyzeWithDemo(feedback);
      break;

    case ANALYZER_PROVIDERS.EXTERNAL_AI:
      result = await analyzeWithExternal(feedback);
      break;

    default:
      throw new Error(`Unknown analyzer provider: ${provider}`);
  }

  validateAnalysisResult(result);

  return normalizeAnalysisResult(result);
}

async function analyzeWithDemo(feedback) {
  const { analyzeFeedback } = await import("./demo-analyzer.server.js");

  return analyzeFeedback(feedback);
}

async function analyzeWithExternal(feedback) {
  const { analyzeFeedback } = await import("./providers/external-ai.server.js");

  return analyzeFeedback(feedback, resolveProviderConfig());
}
