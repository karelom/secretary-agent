import { readFile } from 'node:fs/promises';
import path from 'node:path';

type LMStudioModel = {
  type?: string;
  key?: string;
  display_name?: string;
};

type PiSettings = {
  defaultProvider?: string;
  defaultModel?: string;
};

export type ModelStatus = {
  available: boolean;
  model: string | null;
  message?: string;
};

async function getPiSettings(): Promise<PiSettings> {
  const configDirectory =
    process.env.PI_CODING_AGENT_DIR ?? path.join(process.env.HOME ?? '', '.pi', 'agent');
  try {
    return JSON.parse(
      await readFile(path.join(configDirectory, 'settings.json'), 'utf8')
    ) as PiSettings;
  } catch {
    return {};
  }
}

function matchesModel(model: LMStudioModel, configuredModel: string) {
  const key = model.key?.toLowerCase();
  const configured = configuredModel.toLowerCase().replace(/:[^:]+$/, '');
  if (!key) return false;
  return (
    key === configured ||
    key.endsWith(`/${configured}`) ||
    configured.endsWith(`/${key}`) ||
    key.includes(configured)
  );
}

export async function getModelStatus(): Promise<ModelStatus> {
  const baseUrl = process.env.LM_STUDIO_BASE_URL ?? 'http://127.0.0.1:1234';
  const headers = new Headers();
  if (process.env.LM_STUDIO_API_TOKEN) {
    headers.set('Authorization', `Bearer ${process.env.LM_STUDIO_API_TOKEN}`);
  }

  let models: LMStudioModel[];
  try {
    const response = await fetch(new URL('/api/v1/models', baseUrl), {
      headers,
      signal: AbortSignal.timeout(2500),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`LM Studio returned ${response.status}.`);
    const payload = (await response.json()) as { models?: unknown };
    if (!Array.isArray(payload.models)) throw new Error('LM Studio returned an invalid model list.');
    models = payload.models.filter(
      (model): model is LMStudioModel =>
        !!model && typeof model === 'object' && (model as LMStudioModel).type === 'llm'
    );
  } catch {
    return {
      available: false,
      model: null,
      message: '目前無法取得 LM Studio 的模型清單，請確認 server 已啟動。',
    };
  }

  if (!models.length) {
    return { available: false, model: null, message: 'LM Studio 目前沒有可用的語言模型。' };
  }

  const settings = await getPiSettings();
  const configuredProvider = process.env.PI_PROVIDER || settings.defaultProvider;
  if (configuredProvider && configuredProvider !== 'lmstudio') {
    return {
      available: false,
      model: null,
      message: `Pi 目前設定使用「${configuredProvider}」，無法用 LM Studio 的模型清單確認可用狀態。`,
    };
  }

  const configuredModel = process.env.PI_MODEL || settings.defaultModel;
  const selected = configuredModel
    ? models.find((model) => matchesModel(model, configuredModel))
    : models[0];

  if (!selected) {
    return {
      available: false,
      model: null,
      message: `Pi 設定的模型「${configuredModel}」不在 LM Studio 的可用清單中。`,
    };
  }

  return {
    available: true,
    model: selected.display_name || selected.key || configuredModel || 'LM Studio model',
  };
}
