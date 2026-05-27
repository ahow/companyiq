import { useState, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  Plus, Upload, Play, Square, Search, Trash2, ExternalLink,
  CheckCircle2, XCircle, Clock, Loader2, AlertCircle, Download, Filter
} from "lucide-react";

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedListId, setSelectedListId] = useState<number | undefined>(undefined);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCompany, setNewCompany] = useState({ name: "", isin: "", sector: "", country: "", domain: "" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: companyLists = [] } = useQuery({
    queryKey: ["companyLists"],
    queryFn: api.getCompanyLists,
  });

  const { data: companiesData, isLoading } = useQuery({
    queryKey: ["companies", selectedListId],
    queryFn: () => api.getCompanies(selectedListId),
    refetchInterval: 10000,
  });

  const { data: batchStatus } = useQuery({
    queryKey: ["batchStatus"],
    queryFn: api.getBatchStatus,
    refetchInterval: 3000,
  });

  const analyzeAllMutation = useMutation({
    mutationFn: api.analyzeAll,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["batchStatus"] }),
  });

  const cancelBatchMutation = useMutation({
    mutationFn: api.cancelBatch,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["batchStatus"] }),
  });

  const createCompanyMutation = useMutation({
    mutationFn: (data: any) => api.createCompany(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      setShowAddModal(false);
      setNewCompany({ name: "", isin: "", sector: "", country: "", domain: "" });
    },
  });

  const deleteCompanyMutation = useMutation({
    mutationFn: (id: number) => api.deleteCompany(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["companies"] }),
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => api.importCompanies(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      queryClient.invalidateQueries({ queryKey: ["companyLists"] });
    },
  });

  const companies = companiesData?.companies || [];
  const stats = companiesData?.stats || { total: 0, completed: 0, avgScore: 0 };

  const filtered = companies.filter((c: any) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.sector || "").toLowerCase().includes(search.toLowerCase())
  );

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "failed": return <XCircle className="w-4 h-4 text-red-500" />;
      case "searching":
      case "analyzing": return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      default: return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const getScoreColor = (score: number | null) => {
    if (score === null) return "text-gray-400";
    if (score >= 70) return "text-green-600";
    if (score >= 40) return "text-yellow-600";
    return "text-red-600";
  };

  return (
    <div className="space-y-6">
      {/* Stats Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Total Companies</p>
          <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Analyzed</p>
          <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Average Score</p>
          <p className="text-2xl font-bold text-blue-600">{stats.avgScore}%</p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Batch Status</p>
          <p className="text-2xl font-bold text-gray-900">
            {batchStatus?.running ? `${batchStatus.completed}/${batchStatus.total}` : "Idle"}
          </p>
        </div>
      </div>

      {/* Batch Progress */}
      {batchStatus?.running && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
              <span className="text-sm font-medium text-blue-800">
                Batch Analysis Running: {batchStatus.completed}/{batchStatus.total} completed
                {batchStatus.failed > 0 && `, ${batchStatus.failed} failed`}
              </span>
            </div>
            <button
              onClick={() => cancelBatchMutation.mutate()}
              className="flex items-center gap-1 px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
            >
              <Square className="w-3 h-3" /> Cancel
            </button>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${(batchStatus.completed / batchStatus.total) * 100}%` }}
            />
          </div>
          {batchStatus.currentCompany && (
            <p className="text-xs text-blue-600 mt-1">Currently: {batchStatus.currentCompany}</p>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
        <div className="flex items-center gap-3 flex-1">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search companies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
            />
          </div>

          {/* List Selector Dropdown */}
          <div className="relative">
            <Filter className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <select
              value={selectedListId || ""}
              onChange={(e) => setSelectedListId(e.target.value ? parseInt(e.target.value) : undefined)}
              className="pl-9 pr-8 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm appearance-none bg-white min-w-[180px]"
            >
              <option value="">All Companies</option>
              {companyLists.map((list: any) => (
                <option key={list.id} value={list.id}>
                  {list.name} ({(list.companyIds as number[])?.length || 0})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1 px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <Upload className="w-4 h-4" /> Import
          </button>
          <a
            href="/api/export/companies.csv"
            className="flex items-center gap-1 px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <Download className="w-4 h-4" /> Export
          </a>
          <button
            onClick={() => analyzeAllMutation.mutate()}
            disabled={batchStatus?.running || companies.length === 0}
            className="flex items-center gap-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play className="w-4 h-4" /> Analyze All
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importMutation.mutate(file);
          }}
        />
      </div>

      {/* Import status */}
      {importMutation.isSuccess && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
          <CheckCircle2 className="w-4 h-4 text-green-600" />
          <span className="text-sm text-green-700">
            Import successful! {(importMutation.data as any)?.imported} companies added.
          </span>
        </div>
      )}

      {importMutation.isError && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-600" />
          <span className="text-sm text-red-700">
            Import failed: {(importMutation.error as any)?.message}
          </span>
        </div>
      )}

      {/* Company Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Company</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase hidden md:table-cell">Sector</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase hidden md:table-cell">Country</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Score</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                  Loading companies...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  {companies.length === 0
                    ? selectedListId
                      ? "No companies in this list."
                      : "No companies yet. Add or import companies to get started."
                    : "No companies match your search."}
                </td>
              </tr>
            ) : (
              filtered.map((company: any) => (
                <tr key={company.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link to={`/company/${company.id}`} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                      {company.name}
                    </Link>
                    {company.isin && <p className="text-xs text-gray-400">{company.isin}</p>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 hidden md:table-cell">{company.sector || "—"}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 hidden md:table-cell">{company.country || "—"}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-sm font-bold ${getScoreColor(company.totalScore)}`}>
                      {company.totalScore !== null ? `${company.totalScore}%` : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {getStatusIcon(company.analysisStatus)}
                      <span className="text-xs text-gray-500 capitalize">{company.analysisStatus}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        to={`/company/${company.id}`}
                        className="p-1 text-gray-400 hover:text-blue-600 rounded"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Link>
                      <button
                        onClick={() => {
                          if (confirm(`Delete ${company.name}?`)) deleteCompanyMutation.mutate(company.id);
                        }}
                        className="p-1 text-gray-400 hover:text-red-600 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Company Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-semibold mb-4">Add Company</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createCompanyMutation.mutate(newCompany);
              }}
              className="space-y-3"
            >
              <input
                type="text"
                placeholder="Company Name *"
                value={newCompany.name}
                onChange={(e) => setNewCompany({ ...newCompany, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                required
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="ISIN"
                  value={newCompany.isin}
                  onChange={(e) => setNewCompany({ ...newCompany, isin: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
                <input
                  type="text"
                  placeholder="Domain (e.g. apple.com)"
                  value={newCompany.domain}
                  onChange={(e) => setNewCompany({ ...newCompany, domain: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Sector"
                  value={newCompany.sector}
                  onChange={(e) => setNewCompany({ ...newCompany, sector: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
                <input
                  type="text"
                  placeholder="Country"
                  value={newCompany.country}
                  onChange={(e) => setNewCompany({ ...newCompany, country: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 px-4 py-2 border rounded-lg text-sm">
                  Cancel
                </button>
                <button type="submit" disabled={!newCompany.name} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                  Add Company
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
