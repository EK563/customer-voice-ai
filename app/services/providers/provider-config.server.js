export const PROVIDER_PRESETS = {
  gemini: {
    label: "Google Gemini",
    api: "openai-chat",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash-lite",
    models: ["gemini-2.5-flash-lite", "gemini-2.5-flash"],
  },
  groq: {
    label: "Groq",
    api: "openai-chat",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.1-8b-instant",
    models: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"],
  },
  deepseek: {
    label: "DeepSeek",
    api: "openai-chat",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-flash",
    models: ["deepseek-flash", "deepseek-v4-pro"],
  },
};

export function listProviderPresets() {
  return Object.entries(PROVIDER_PRESETS).map(([id, preset]) => ({
    id,
    label: preset.label,
    api: preset.api,
    baseUrl: preset.baseUrl,
    defaultModel: preset.defaultModel,
    models: preset.models,
  }));
}

export function resolveProviderConfig(env = process.env) {
  const requestedVendor = String(env.AI_VENDOR || "gemini").toLowerCase();
  const preset = PROVIDER_PRESETS[requestedVendor] || PROVIDER_PRESETS.gemini;

  return {
    vendor: PROVIDER_PRESETS[requestedVendor] ? requestedVendor : "gemini",
    api: env.AI_API_STYLE || preset.api,
    baseUrl: String(env.AI_BASE_URL || preset.baseUrl).replace(/\/$/, ""),
    model: env.AI_MODEL || preset.defaultModel,
    apiKey: env.AI_API_KEY || env.GEMINI_API_KEY || "",
    timeoutMs: Number(env.AI_TIMEOUT_MS || 20000),
    dryRun: env.AI_DRY_RUN === "1",
    batchSize: Math.min(Math.max(Number(env.AI_BATCH_SIZE || 30), 1), 40),
  };
}
