const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openrouter/free';
const DEFAULT_TIMEOUT_MS = 20_000;

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterChatOptions {
  model?: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: Record<string, unknown>;
}

export class OpenRouterError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'OpenRouterError';
    this.status = status;
  }
}

export function openRouterConfigured() {
  return Boolean((process.env.OPENROUTER_API_KEY || '').trim());
}

export function openRouterModel() {
  return (process.env.OPENROUTER_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function openRouterHeaders() {
  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) throw new OpenRouterError(503, 'OPENROUTER_API_KEY is not configured');

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const siteUrl = (process.env.OPENROUTER_SITE_URL || '').trim();
  const appTitle = (process.env.OPENROUTER_APP_TITLE || '').trim();
  if (siteUrl) headers['HTTP-Referer'] = siteUrl;
  if (appTitle) headers['X-OpenRouter-Title'] = appTitle;
  return headers;
}

function sanitizeErrorText(text: string) {
  const singleLine = String(text || '').replace(/\s+/g, ' ').trim();
  return singleLine.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]').slice(0, 240);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new OpenRouterError(408, 'OpenRouter request timed out');
    throw new OpenRouterError(503, 'OpenRouter request failed');
  } finally {
    clearTimeout(timer);
  }
}

async function parseOpenRouterResponse(response: Response): Promise<any> {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new OpenRouterError(response.status, sanitizeErrorText(body) || `OpenRouter HTTP ${response.status}`);
  }
  return response.json();
}

export async function getOpenRouterModels() {
  const response = await fetchWithTimeout(`${OPENROUTER_BASE_URL}/models`, {
    method: 'GET',
    headers: openRouterHeaders(),
  });
  return parseOpenRouterResponse(response);
}

export async function sendOpenRouterChat(options: OpenRouterChatOptions) {
  const body: Record<string, unknown> = {
    model: options.model || openRouterModel(),
    messages: options.messages,
    temperature: options.temperature ?? 0,
    max_tokens: options.maxTokens ?? 32,
  };
  if (options.responseFormat) body.response_format = options.responseFormat;

  const response = await fetchWithTimeout(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: openRouterHeaders(),
    body: JSON.stringify(body),
  });
  return parseOpenRouterResponse(response);
}

export async function checkOpenRouterHealth() {
  const model = openRouterModel();
  const result = {
    openrouterConfigured: openRouterConfigured(),
    modelsEndpoint: false,
    chatEndpoint: false,
    model,
  };
  if (!result.openrouterConfigured) return result;

  await getOpenRouterModels();
  result.modelsEndpoint = true;

  const chat = await sendOpenRouterChat({
    model,
    messages: [{ role: 'user', content: 'Reply with exactly: OPENROUTER_OK' }],
    temperature: 0,
    maxTokens: 32,
  });
  result.chatEndpoint = Boolean(chat?.id && chat?.model && chat?.choices?.[0]?.message);
  return result;
}

export function openRouterErrorResponse(err: unknown) {
  if (err instanceof OpenRouterError) {
    return { status: err.status, body: { error: `OpenRouter error ${err.status}`, message: err.message } };
  }
  return { status: 500, body: { error: 'OpenRouter error', message: 'Unexpected OpenRouter failure' } };
}
