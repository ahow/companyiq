import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Plus, Trash2, CheckCircle2, Edit2, Save, X, ChevronDown, ChevronRight } from "lucide-react";

export default function FrameworkPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const { data: frameworks = [] } = useQuery({
    queryKey: ["frameworks"],
    queryFn: api.getFrameworks,
  });

  const { data: frameworkDetail } = useQuery({
    queryKey: ["framework", selectedId],
    queryFn: () => api.getFramework(selectedId!),
    enabled: !!selectedId,
  });

  const activateMutation = useMutation({
    mutationFn: (id: number) => api.activateFramework(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["frameworks"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteFramework(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["frameworks"] });
      setSelectedId(null);
    },
  });

  const measures = frameworkDetail?.measures || [];
  const categories = measures.reduce((acc: Record<string, any[]>, m: any) => {
    const key = m.category || "Uncategorized";
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {});

  const toggleCategory = (cat: string) => {
    const next = new Set(expandedCategories);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    setExpandedCategories(next);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Assessment Frameworks</h1>
      </div>

      {/* Framework List */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {frameworks.map((fw: any) => (
          <div
            key={fw.id}
            onClick={() => setSelectedId(fw.id)}
            className={`bg-white rounded-lg border p-4 cursor-pointer transition-all ${
              selectedId === fw.id ? "ring-2 ring-blue-500 border-blue-500" : "hover:border-gray-400"
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-medium text-sm text-gray-900">{fw.name}</h3>
                <p className="text-xs text-gray-500 mt-1">{fw.version || "v1.0"}</p>
              </div>
              {fw.isActive && (
                <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                  <CheckCircle2 className="w-3 h-3" /> Active
                </span>
              )}
            </div>
            {fw.topicDescription && (
              <p className="text-xs text-gray-500 mt-2 line-clamp-2">{fw.topicDescription}</p>
            )}
            <div className="flex gap-2 mt-3">
              {!fw.isActive && (
                <button
                  onClick={(e) => { e.stopPropagation(); activateMutation.mutate(fw.id); }}
                  className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                >
                  Activate
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm("Delete this framework?")) deleteMutation.mutate(fw.id);
                }}
                className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {frameworks.length === 0 && (
          <div className="col-span-3 text-center py-8 text-gray-500">
            No frameworks yet. Use the AI Builder to create one.
          </div>
        )}
      </div>

      {/* Framework Detail */}
      {frameworkDetail && (
        <div className="bg-white rounded-lg border">
          <div className="px-4 py-3 border-b">
            <h2 className="font-semibold text-gray-900">{frameworkDetail.name}</h2>
            <p className="text-sm text-gray-500 mt-1">{measures.length} measures in {Object.keys(categories).length} categories</p>
          </div>

          <div className="divide-y">
            {Object.entries(categories)
              .sort(([, a]: any, [, b]: any) => (a[0]?.categoryNumber || 0) - (b[0]?.categoryNumber || 0))
              .map(([category, catMeasures]) => {
                const measures = catMeasures as any[];
                const isExpanded = expandedCategories.has(category);
                return (
                  <div key={category}>
                    <button
                      onClick={() => toggleCategory(category)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-2">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        <span className="text-sm font-medium">{category}</span>
                      </div>
                      <span className="text-xs text-gray-400">{measures.length} measures</span>
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-3 space-y-2">
                        {measures.map((m: any) => (
                          <div key={m.measureId} className="pl-6 py-2 border-l-2 border-gray-200">
                            <p className="text-sm text-gray-800">{m.title}</p>
                            {m.definition && <p className="text-xs text-gray-500 mt-0.5">{m.definition}</p>}
                            <p className="text-xs text-gray-400 mt-0.5">ID: {m.measureId}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
