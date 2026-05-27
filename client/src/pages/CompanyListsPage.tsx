import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  Upload, Trash2, FileSpreadsheet, Loader2, CheckCircle2,
  AlertCircle, List, Users, Calendar, X
} from "lucide-react";

export default function CompanyListsPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [listName, setListName] = useState("");
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string; withCompanies: boolean } | null>(null);

  const { data: lists = [], isLoading } = useQuery({
    queryKey: ["companyLists"],
    queryFn: api.getCompanyLists,
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, deleteCompanies }: { id: number; deleteCompanies: boolean }) =>
      api.deleteCompanyList(id, deleteCompanies),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companyLists"] });
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      setConfirmDelete(null);
    },
  });

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    setUploadResult(null);
    setUploadError(null);

    try {
      const result = await api.importCompanies(file, listName || undefined);
      setUploadResult(result);
      setListName("");
      queryClient.invalidateQueries({ queryKey: ["companyLists"] });
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    } catch (err: any) {
      setUploadError(err.message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Company Lists</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload CSV or Excel files to create company lists. Use the dropdown on the Dashboard to filter by list.
        </p>
      </div>

      {/* Upload Section */}
      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Upload className="w-5 h-5 text-blue-600" />
          Upload New List
        </h2>

        <div className="space-y-4">
          {/* List Name Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              List Name (optional)
            </label>
            <input
              type="text"
              placeholder="e.g., MSCI ACWI Top 100, S&P 500, Custom Portfolio"
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">If left blank, the filename will be used.</p>
          </div>

          {/* File Upload Area */}
          <div
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 hover:bg-blue-50/50 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileSpreadsheet className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-700">
              Click to upload or drag and drop
            </p>
            <p className="text-xs text-gray-500 mt-1">
              CSV, XLS, or XLSX files supported
            </p>
            <p className="text-xs text-gray-400 mt-2">
              Expected columns: NAME (required), ISIN/Type, Sector, Country/Geography
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
            }}
          />

          {/* Upload Progress */}
          {uploading && (
            <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
              <span className="text-sm text-blue-700">Uploading and processing file...</span>
            </div>
          )}

          {/* Upload Result */}
          {uploadResult && (
            <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
              <div className="text-sm text-green-700">
                <p className="font-medium">Upload successful!</p>
                <p>
                  Created list "{uploadResult.listName}" with {uploadResult.imported} new companies
                  {uploadResult.existing > 0 && ` (${uploadResult.existing} already existed)`}
                  {" "}from {uploadResult.total} rows.
                </p>
              </div>
              <button onClick={() => setUploadResult(null)} className="ml-auto text-green-600 hover:text-green-800">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Upload Error */}
          {uploadError && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-600 mt-0.5" />
              <div className="text-sm text-red-700">
                <p className="font-medium">Upload failed</p>
                <p>{uploadError}</p>
              </div>
              <button onClick={() => setUploadError(null)} className="ml-auto text-red-600 hover:text-red-800">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Existing Lists */}
      <div className="bg-white rounded-lg border">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <List className="w-5 h-5 text-gray-600" />
            Existing Lists
          </h2>
        </div>

        {isLoading ? (
          <div className="p-8 text-center">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-gray-400" />
            <p className="text-sm text-gray-500">Loading lists...</p>
          </div>
        ) : lists.length === 0 ? (
          <div className="p-8 text-center">
            <FileSpreadsheet className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No lists yet. Upload a CSV or Excel file to create one.</p>
          </div>
        ) : (
          <div className="divide-y">
            {lists.map((list: any) => (
              <div key={list.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-medium text-gray-900">{list.name}</h3>
                    {list.sourceFilename && (
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                        {list.sourceFilename}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-1">
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {(list.companyIds as number[])?.length || 0} companies
                    </span>
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(list.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setConfirmDelete({ id: list.id, name: list.name, withCompanies: false })}
                  className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                  title="Delete list"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete List</h3>
            <p className="text-sm text-gray-600 mb-4">
              How would you like to delete "{confirmDelete.name}"?
            </p>

            <div className="space-y-3">
              <button
                onClick={() => deleteMutation.mutate({ id: confirmDelete.id, deleteCompanies: false })}
                disabled={deleteMutation.isPending}
                className="w-full flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 text-left"
              >
                <div className="w-8 h-8 bg-yellow-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <List className="w-4 h-4 text-yellow-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Delete list only</p>
                  <p className="text-xs text-gray-500">Keep the companies in the database, just remove the list grouping.</p>
                </div>
              </button>

              <button
                onClick={() => deleteMutation.mutate({ id: confirmDelete.id, deleteCompanies: true })}
                disabled={deleteMutation.isPending}
                className="w-full flex items-center gap-3 p-3 border border-red-200 rounded-lg hover:bg-red-50 text-left"
              >
                <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Trash2 className="w-4 h-4 text-red-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-red-700">Delete list and all companies</p>
                  <p className="text-xs text-gray-500">Permanently remove the list and all associated companies and their data.</p>
                </div>
              </button>

              <button
                onClick={() => setConfirmDelete(null)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
