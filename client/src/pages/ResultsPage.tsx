import { useState, useEffect } from "react";
import { api } from "../lib/api";

interface AnalysisResultSummary {
  id: number;
  frameworkId: number;
  frameworkName: string;
  listId?: number;
  listName?: string;
  batchId?: number;
  companyCount: number;
  averageScore?: number;
  shareToken?: string;
  completedAt: string;
  createdAt: string;
}

export default function ResultsPage() {
  const [results, setResults] = useState<AnalysisResultSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  useEffect(() => {
    loadResults();
  }, []);

  async function loadResults() {
    try {
      const data = await api.getAnalysisResults();
      setResults(data);
    } catch (err) {
      console.error("Failed to load results:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Are you sure you want to delete this saved analysis result?")) return;
    try {
      await api.deleteAnalysisResult(id);
      setResults((prev) => prev.filter((r) => r.id !== id));
    } catch (err: any) {
      alert("Failed to delete: " + err.message);
    }
  }

  function handleDownload(id: number) {
    // Open download URL in new tab (will trigger file download)
    window.open(api.getAnalysisResultDownloadUrl(id), "_blank");
  }

  function handleShare(token: string) {
    const url = api.getShareUrl(token);
    navigator.clipboard.writeText(url).then(() => {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 3000);
    });
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading results...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Saved Results</h1>
          <p className="text-sm text-gray-500 mt-1">
            Completed analyses are automatically saved here. Download as a spreadsheet or share as a JSON link.
          </p>
        </div>
      </div>

      {results.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <div className="text-gray-400 text-lg mb-2">No saved results yet</div>
          <p className="text-gray-500 text-sm">
            Results are automatically saved when a batch analysis completes. Run an analysis from the Dashboard to get started.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Framework Template</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Company List</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Companies</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Avg Score</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Time</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {results.map((result) => (
                <tr key={result.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900">{result.frameworkName}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {result.listName || "All Companies"}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-600">
                    {result.companyCount}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-semibold ${
                      (result.averageScore || 0) >= 50 ? "text-green-600" :
                      (result.averageScore || 0) >= 20 ? "text-yellow-600" :
                      "text-red-600"
                    }`}>
                      {result.averageScore ?? 0}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-sm">
                    {formatDate(result.completedAt)}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-sm">
                    {formatTime(result.completedAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* Download spreadsheet */}
                      <button
                        onClick={() => handleDownload(result.id)}
                        className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200"
                        title="Download as spreadsheet (CSV)"
                      >
                        <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        CSV
                      </button>

                      {/* Share link */}
                      {result.shareToken && (
                        <button
                          onClick={() => handleShare(result.shareToken!)}
                          className={`inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded border ${
                            copiedToken === result.shareToken
                              ? "bg-green-50 text-green-700 border-green-200"
                              : "bg-gray-50 text-gray-700 hover:bg-gray-100 border-gray-200"
                          }`}
                          title="Copy share link (JSON)"
                        >
                          <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                          </svg>
                          {copiedToken === result.shareToken ? "Copied!" : "Share"}
                        </button>
                      )}

                      {/* Delete */}
                      <button
                        onClick={() => handleDelete(result.id)}
                        className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
                        title="Delete this result"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-blue-800 mb-1">About Saved Results</h3>
        <ul className="text-sm text-blue-700 space-y-1">
          <li><strong>Automatic saving:</strong> Results are saved automatically when a batch analysis completes.</li>
          <li><strong>Download (CSV):</strong> Downloads a spreadsheet with all company scores, verdicts, and evidence for each measure.</li>
          <li><strong>Share (JSON):</strong> Copies a public URL that returns the results as JSON — useful for integrating with other applications or dashboards.</li>
        </ul>
      </div>
    </div>
  );
}
