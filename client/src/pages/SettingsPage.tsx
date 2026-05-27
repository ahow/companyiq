import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Save, Loader2, CheckCircle2, XCircle } from "lucide-react";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const { data: currentSettings } = useQuery({
    queryKey: ["settings"],
    queryFn: api.getSettings,
  });

  const { data: providerStatus } = useQuery({
    queryKey: ["providerStatus"],
    queryFn: api.getProviderStatus,
  });

  useEffect(() => {
    if (currentSettings) setSettings(currentSettings);
  }, [currentSettings]);

  const saveMutation = useMutation({
    mutationFn: () => api.updateSettings(settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const updateSetting = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Settings
        </button>
      </div>

      {saved && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
          Settings saved successfully.
        </div>
      )}

      {/* AI Provider Status */}
      <div className="bg-white rounded-lg border p-4">
        <h2 className="font-semibold text-gray-900 mb-3">AI Provider Status</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {providerStatus && Object.entries(providerStatus).map(([name, status]: [string, any]) => (
            <div key={name} className="flex items-center gap-2 p-2 rounded border">
              {status.available ? (
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              ) : (
                <XCircle className="w-4 h-4 text-gray-300" />
              )}
              <div>
                <p className="text-xs font-medium capitalize">{name}</p>
                <p className="text-xs text-gray-400">{status.model}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pipeline Settings */}
      <div className="bg-white rounded-lg border p-4 space-y-4">
        <h2 className="font-semibold text-gray-900">Pipeline Configuration</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Primary Scoring Provider</label>
            <select
              value={settings.scoring_provider || "deepseek"}
              onChange={(e) => updateSetting("scoring_provider", e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              <option value="deepseek">DeepSeek</option>
              <option value="claude">Claude</option>
              <option value="openai">OpenAI (GPT-4o)</option>
              <option value="gemini">Gemini</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Scoring Mode</label>
            <select
              value={settings.scoring_mode || "binary"}
              onChange={(e) => updateSetting("scoring_mode", e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              <option value="binary">Binary (0/1)</option>
              <option value="coverage">Coverage (0-3)</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.ensemble_scoring === "true"}
              onChange={(e) => updateSetting("ensemble_scoring", e.target.checked ? "true" : "false")}
              className="rounded"
            />
            <span className="text-sm">Enable Ensemble Scoring (multi-LLM)</span>
          </label>
        </div>

        {settings.ensemble_scoring === "true" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pl-6 border-l-2 border-blue-200">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">LLM Pass 1</label>
              <select
                value={settings.pipeline_llm_1 || "deepseek"}
                onChange={(e) => updateSetting("pipeline_llm_1", e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                <option value="deepseek">DeepSeek</option>
                <option value="claude">Claude</option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">LLM Pass 2</label>
              <select
                value={settings.pipeline_llm_2 || "claude"}
                onChange={(e) => updateSetting("pipeline_llm_2", e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                <option value="deepseek">DeepSeek</option>
                <option value="claude">Claude</option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">LLM Pass 3</label>
              <select
                value={settings.pipeline_llm_3 || "gemini"}
                onChange={(e) => updateSetting("pipeline_llm_3", e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                <option value="deepseek">DeepSeek</option>
                <option value="claude">Claude</option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
              </select>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.terminology_discovery_enabled !== "false"}
              onChange={(e) => updateSetting("terminology_discovery_enabled", e.target.checked ? "true" : "false")}
              className="rounded"
            />
            <span className="text-sm">Enable Terminology Discovery (T109)</span>
          </label>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.use_bm25_retrieval !== "false"}
              onChange={(e) => updateSetting("use_bm25_retrieval", e.target.checked ? "true" : "false")}
              className="rounded"
            />
            <span className="text-sm">Enable BM25 Passage Retrieval</span>
          </label>
        </div>
      </div>

      {/* Trusted Sources */}
      <TrustedSourcesSection />
    </div>
  );
}

function TrustedSourcesSection() {
  const queryClient = useQueryClient();
  const [newDomain, setNewDomain] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const { data: sources = [] } = useQuery({
    queryKey: ["trustedSources"],
    queryFn: api.getTrustedSources,
  });

  const createMutation = useMutation({
    mutationFn: () => api.createTrustedSource({ domain: newDomain, description: newDesc }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trustedSources"] });
      setNewDomain("");
      setNewDesc("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteTrustedSource(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["trustedSources"] }),
  });

  return (
    <div className="bg-white rounded-lg border p-4 space-y-3">
      <h2 className="font-semibold text-gray-900">Trusted Sources</h2>
      <p className="text-xs text-gray-500">Domains that will be searched for every company during discovery.</p>

      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Domain (e.g. sec.gov)"
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          className="flex-1 px-3 py-2 border rounded-lg text-sm"
        />
        <input
          type="text"
          placeholder="Description"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          className="flex-1 px-3 py-2 border rounded-lg text-sm"
        />
        <button
          onClick={() => createMutation.mutate()}
          disabled={!newDomain}
          className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          Add
        </button>
      </div>

      <div className="space-y-1">
        {sources.map((s: any) => (
          <div key={s.id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-gray-50">
            <div>
              <span className="text-sm font-medium">{s.domain}</span>
              {s.description && <span className="text-xs text-gray-400 ml-2">{s.description}</span>}
            </div>
            <button onClick={() => deleteMutation.mutate(s.id)} className="text-gray-400 hover:text-red-500">
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
