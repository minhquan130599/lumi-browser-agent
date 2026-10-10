import type { Dispatch, SetStateAction } from 'react';
import { describeHelperKey } from '../shared/text-helper';
import { TEXT_HELPER_PRESETS } from '../shared/types';
import type { AppSettings, TextHelperProvider } from '../shared/types';
import { PRESETS } from '../shared/ai-config';
import type { AIConfig } from '../shared/ai-config';

const colors = {
  panel: '#152037',
  border: '#30415e',
  text: '#e5edff',
  muted: '#96adc9',
  selected: '#3c318a',
};

const fieldStyle = {
  display: 'block', width: '100%', background: '#0c1428', color: colors.text,
  border: '1px solid ' + colors.border, padding: '10px 12px', borderRadius: 7,
  fontSize: 13,
} as const;

const buttonStyle = {
  border: '1px solid #5e5acc', borderRadius: 8, cursor: 'pointer',
  color: colors.text, padding: '9px 12px', background: '#152037',
  flex: '1 1 210px', fontSize: 13,
} as const;

const labelStyle = {
  display: 'block', color: '#9fc1ec', fontSize: 12, marginBottom: 7,
} as const;

const inputWrap = { flex: '1 1 230px', minWidth: 190 } as const;

export function TextHelperSettings({
  settings, setSettings, chatAI,
}: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  chatAI: AIConfig;
}) {
  const shared = settings.textHelperMode !== 'custom';
  const current = describeHelperKey(settings, chatAI);

  const changeProvider = (provider: TextHelperProvider) => {
    const preset = TEXT_HELPER_PRESETS[provider];
    setSettings(s => ({
      ...s,
      textHelper: { ...s.textHelper, provider, baseUrl: preset.baseUrl, model: preset.model },
    }));
  };

  return (
    <div style={{
      background: colors.panel, border: '1px solid ' + colors.border,
      borderRadius: 12, padding: 20, marginTop: 22,
    }}>
      <h2 style={{ color: colors.text, fontSize: 16, margin: '0 0 8px' }}>
        Text Helper — TYPE_TEXT
      </h2>
      <p style={{ color: colors.muted, fontSize: 12, lineHeight: 1.6, marginBottom: 16 }}>
        Mặc định dùng chung model Chat AI để tạo nội dung nhập liệu.
        Jev Decision Engine vẫn dùng provider riêng.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" style={{ ...buttonStyle, background: shared ? colors.selected : buttonStyle.background }}
          onClick={() => setSettings(s => ({ ...s, textHelperMode: 'shared' }))}>
          Dùng chung Chat AI (mặc định)
        </button>
        <button type="button" style={{ ...buttonStyle, background: !shared ? colors.selected : buttonStyle.background }}
          onClick={() => setSettings(s => ({ ...s, textHelperMode: 'custom' }))}>
          Model riêng (nâng cao)
        </button>
      </div>

      {shared ? (
        <div style={{ marginTop: 14, background: '#0c1428', padding: 14, borderRadius: 9 }}>
          <strong style={{ color: colors.text, fontSize: 13 }}>
            {chatAI.kind === 'chrome'
              ? 'Chrome Built-in AI'
              : `${chatAI.kind.toUpperCase()} — ${chatAI.model || PRESETS[chatAI.kind].model}`}
          </strong>
          <p style={{ color: current.source ? '#86efac' : '#fca5a5', fontSize: 12, lineHeight: 1.7 }}>
            {current.message}
          </p>
          <p style={{ color: colors.muted, fontSize: 12, margin: 0 }}>
            Để thay đổi Chat AI: mở Lumi Side Panel → ⚙ Cấu hình AI.
            Khi dùng Chrome Built-in AI cần giữ Side Panel đang mở.
          </p>
        </div>
      ) : (
        <div style={{ marginTop: 15 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={inputWrap}>
              <label style={labelStyle} htmlFor="helper-provider">Provider</label>
              <select id="helper-provider" style={fieldStyle} value={settings.textHelper.provider}
                onChange={e => changeProvider(e.target.value as TextHelperProvider)}>
                <option value="openrouter">OpenRouter</option>
                <option value="deepseek">DeepSeek</option>
                <option value="openai">OpenAI / Compatible</option>
                <option value="ollama">Ollama local</option>
                <option value="vllm">vLLM local</option>
              </select>
            </div>
            <div style={inputWrap}>
              <label style={labelStyle} htmlFor="helper-model">Model</label>
              <input id="helper-model" style={fieldStyle} value={settings.textHelper.model}
                onChange={e => setSettings(s => ({
                  ...s, textHelper: { ...s.textHelper, model: e.target.value },
                }))} />
            </div>
          </div>
          <label style={{ ...labelStyle, marginTop: 14 }} htmlFor="helper-url">Base URL</label>
          <input id="helper-url" style={fieldStyle} value={settings.textHelper.baseUrl}
            onChange={e => setSettings(s => ({
              ...s, textHelper: { ...s.textHelper, baseUrl: e.target.value },
            }))} />
          <label style={{ ...labelStyle, marginTop: 14 }} htmlFor="helper-key">API Key</label>
          <input id="helper-key" type="password" autoComplete="off" style={fieldStyle}
            value={settings.textHelper.apiKey} placeholder="Có thể để trống với local model"
            onChange={e => setSettings(s => ({
              ...s, textHelper: { ...s.textHelper, apiKey: e.target.value },
            }))} />
          <p style={{ color: current.source ? '#86efac' : '#fca5a5', fontSize: 12, lineHeight: 1.6 }}>
            {current.message}
          </p>
        </div>
      )}

      <p style={{ color: colors.muted, fontSize: 11, marginBottom: 0 }}>
        Chọn “Save All Settings” phía dưới để lưu thay đổi.
      </p>
    </div>
  );
}
