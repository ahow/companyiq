import { useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  ArrowLeft, Play, Upload, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, AlertCircle, Loader2, FileText, Camera
} from "lucide-react";

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const companyId = parseInt(id!);
  const queryClient = useQueryClient();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"scores" | "documents" | "diagnostics">("scores");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["company", companyId],
    queryFn: () => api.getCompany(companyId),
    refetchInterval: 5000,
  });

  const analyzeMutation = useMutation({
    mutationFn: () => api.analyzeCompany(companyId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["company", companyId] }),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => api.uploadDocument(companyId, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["company", companyId] }),
  });

  const snapshotMutation = useMutation({
    mutationFn: () => api.createSnapshot(companyId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  const company = data?.company;
  const scores = data?.scores || [];
  const documents = data?.documents || [];

  if (!company) {
    return <div className="text-center py-12 text-gray-500">Company not found</div>;
  }

  // Group scores by category
  const categories = scores.reduce((acc: any, score: any) => {
    const key = score.category || "Uncategorized";
    if (!acc[key]) acc[key] = { measures: [], categoryNumber: score.categoryNumber };
    acc[key].measures.push(score);
    return acc;
  }, {});

  const toggleCategory = (cat: string) => {
    const next = new Set(expandedCategories);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    setExpandedCategories(next);
  };

  const isRunning = ["searching", "fetching", "fetched", "analyzing"].includes(company.analysisStatus);
  const hasFetchedDocs = documents.some((d: any) => d.fetchStatus === "ok");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link to="/" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-2">
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">{company.name}</h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
            {company.isin && <span>ISIN: {company.isin}</span>}
            {company.sector && <span>{company.sector}</span>}
            {company.country && <span>{company.country}</span>}
            {company.domain && <span>{company.domain}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => snapshotMutation.mutate()}
            className="flex items-center gap-1 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
            title="Save snapshot"
          >
            <Camera className="w-4 h-4" /> Snapshot
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
          >
            <Upload className="w-4 h-4" /> Upload PDF
          </button>
          <button
            onClick={() => analyzeMutation.mutate()}
            disabled={isRunning}
            className="flex items-center gap-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {isRunning ? (company.analysisStatus === "fetching" ? "Fetching..." : "Analyzing...") : "Analyze"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadMutation.mutate(file);
            }}
          />
        </div>
      </div>

      {/* Score Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Total Score</p>
          <p className={`text-3xl font-bold ${company.totalScore !== null ? (company.totalScore >= 70 ? "text-green-600" : company.totalScore >= 40 ? "text-yellow-600" : "text-red-600") : "text-gray-400"}`}>
            {company.totalScore !== null ? `${company.totalScore}%` : "—"}
          </p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Measures Met</p>
          <p className="text-3xl font-bold text-gray-900">
            {scores.filter((s: any) => s.score > 0).length} / {scores.length}
          </p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Documents</p>
          <p className="text-3xl font-bold text-gray-900">{documents.length}</p>
        </div>
      </div>

      {/* Summary */}
      {company.summary && (
        <div className="bg-white rounded-lg border p-4">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Executive Summary</h3>
          <p className="text-sm text-gray-700">{company.summary}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b">
        <div className="flex gap-4">
          {(["scores", "documents", "diagnostics"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab === "scores" ? "Detailed Analysis" : tab === "documents" ? "Documents" : "Diagnostics"}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "scores" && (
        <div className="space-y-3">
          {Object.entries(categories)
            .sort(([, a]: any, [, b]: any) => a.categoryNumber - b.categoryNumber)
            .map(([category, data]: [string, any]) => {
              const catScores = data.measures;
              const catTotal = catScores.filter((s: any) => s.score > 0).length;
              const isExpanded = expandedCategories.has(category);

              return (
                <div key={category} className="bg-white rounded-lg border overflow-hidden">
                  <button
                    onClick={() => toggleCategory(category)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      <span className="font-medium text-sm">{category}</span>
                    </div>
                    <span className="text-sm text-gray-500">
                      {catTotal}/{catScores.length} measures met
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="border-t divide-y">
                      {catScores.map((score: any) => (
                        <div key={score.measureId} className="px-4 py-3">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                {score.score > 0 ? (
                                  <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                                ) : score.verdict === "Partial" ? (
                                  <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                                ) : (
                                  <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                                )}
                                <span className="text-sm font-medium text-gray-900">{score.title}</span>
                              </div>
                              {score.definition && (
                                <p className="text-xs text-gray-500 mt-1 ml-6">{score.definition}</p>
                              )}
                              {score.evidenceSummary && (
                                <p className="text-xs text-gray-600 mt-2 ml-6 bg-gray-50 p-2 rounded">
                                  {score.evidenceSummary}
                                </p>
                              )}
                              {score.quotes && score.quotes.length > 0 && (
                                <div className="ml-6 mt-2 space-y-1">
                                  {score.quotes.map((q: any, idx: number) => (
                                    <blockquote key={idx} className="text-xs text-gray-500 border-l-2 border-blue-200 pl-2 italic">
                                      "{q.text}"
                                    </blockquote>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2 ml-4">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                score.confidence === "High" ? "bg-green-100 text-green-700" :
                                score.confidence === "Medium" ? "bg-yellow-100 text-yellow-700" :
                                "bg-gray-100 text-gray-600"
                              }`}>
                                {score.confidence}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          {scores.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No analysis results yet. Click "Analyze" to start.
            </div>
          )}
        </div>
      )}

      {activeTab === "documents" && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Document</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Type</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Gate</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Fetch</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {documents.map((doc: any) => (
                <tr key={doc.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <a
                      href={doc.url.startsWith("upload://") ? "#" : doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline truncate block max-w-md"
                    >
                      {doc.title || doc.url}
                    </a>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">{doc.type}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      doc.gateVerdict === "accept" ? "bg-green-100 text-green-700" :
                      doc.gateVerdict === "reject" ? "bg-red-100 text-red-700" :
                      "bg-gray-100 text-gray-600"
                    }`}>
                      {doc.gateVerdict || "pending"}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      doc.fetchStatus === "ok" ? "bg-green-100 text-green-700" :
                      doc.fetchStatus === "dead" ? "bg-red-100 text-red-700" :
                      "bg-gray-100 text-gray-600"
                    }`}>
                      {doc.fetchStatus}
                    </span>
                  </td>
                </tr>
              ))}
              {documents.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500 text-sm">
                    No documents discovered yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "diagnostics" && (
        <div className="bg-white rounded-lg border p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Discovery Diagnostics</h3>
          {company.discoveryDiagnostics ? (
            <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto max-h-96">
              {JSON.stringify(company.discoveryDiagnostics, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-gray-500">No diagnostics available. Run analysis first.</p>
          )}
        </div>
      )}
    </div>
  );
}
