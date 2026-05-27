import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Sparkles, Loader2, Check, ArrowRight } from "lucide-react";

export default function FrameworkBuilderPage() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"input" | "review" | "done">("input");
  const [topic, setTopic] = useState("");
  const [measureCount, setMeasureCount] = useState(25);
  const [draft, setDraft] = useState<any>(null);

  const draftMutation = useMutation({
    mutationFn: () => api.draftFramework({ topicDescription: topic, measureCount }),
    onSuccess: (data) => {
      setDraft(data);
      setStep("review");
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Create framework
      const fw = await api.createFramework({
        name: draft.name,
        topicDescription: topic,
        scoringMode: "binary",
      });

      // Create measures
      const measures = draft.categories.flatMap((cat: any, catIdx: number) =>
        cat.measures.map((m: any, mIdx: number) => ({
          measureId: m.measureId,
          title: m.title,
          definition: m.definition,
          category: cat.name,
          categoryNumber: catIdx + 1,
          displayOrder: mIdx + 1,
          scoringGuidance: m.scoringGuidance,
        }))
      );

      await api.bulkCreateMeasures(fw.id, measures);

      // Activate it
      await api.activateFramework(fw.id);

      return fw;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["frameworks"] });
      setStep("done");
    },
  });

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">AI Framework Builder</h1>
      <p className="text-sm text-gray-500">
        Describe the topic you want to assess companies on, and AI will generate a structured assessment framework.
      </p>

      {step === "input" && (
        <div className="bg-white rounded-lg border p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              What topic do you want to assess?
            </label>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g., Corporate governance of AI and machine learning — covering board oversight, risk management, ethics policies, transparency, and accountability mechanisms..."
              className="w-full px-3 py-2 border rounded-lg text-sm min-h-[120px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Number of measures
            </label>
            <input
              type="number"
              value={measureCount}
              onChange={(e) => setMeasureCount(parseInt(e.target.value) || 25)}
              min={5}
              max={100}
              className="w-32 px-3 py-2 border rounded-lg text-sm"
            />
          </div>

          <button
            onClick={() => draftMutation.mutate()}
            disabled={!topic || draftMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {draftMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {draftMutation.isPending ? "Generating..." : "Generate Framework"}
          </button>

          {draftMutation.isError && (
            <p className="text-sm text-red-600">Error: {(draftMutation.error as Error).message}</p>
          )}
        </div>
      )}

      {step === "review" && draft && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border p-4">
            <h2 className="text-lg font-semibold text-gray-900">{draft.name}</h2>
            <p className="text-sm text-gray-500 mt-1">
              {draft.categories?.length} categories, {draft.categories?.reduce((sum: number, c: any) => sum + c.measures.length, 0)} measures
            </p>
          </div>

          {draft.categories?.map((cat: any, catIdx: number) => (
            <div key={catIdx} className="bg-white rounded-lg border">
              <div className="px-4 py-3 border-b bg-gray-50">
                <h3 className="font-medium text-sm">{cat.name}</h3>
              </div>
              <div className="divide-y">
                {cat.measures.map((m: any, mIdx: number) => (
                  <div key={mIdx} className="px-4 py-3">
                    <p className="text-sm text-gray-800">{m.title}</p>
                    {m.definition && <p className="text-xs text-gray-500 mt-1">{m.definition}</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="flex gap-3">
            <button
              onClick={() => { setStep("input"); setDraft(null); }}
              className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
            >
              Start Over
            </button>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Save & Activate Framework
            </button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <Check className="w-8 h-8 text-green-600 mx-auto mb-2" />
          <h3 className="text-lg font-semibold text-green-800">Framework Created!</h3>
          <p className="text-sm text-green-600 mt-1">
            Your framework has been saved and activated. You can now analyze companies against it.
          </p>
          <button
            onClick={() => { setStep("input"); setDraft(null); setTopic(""); }}
            className="mt-4 px-4 py-2 bg-white border border-green-300 rounded-lg text-sm text-green-700 hover:bg-green-50"
          >
            Create Another
          </button>
        </div>
      )}
    </div>
  );
}
