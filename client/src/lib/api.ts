const BASE = "/api";

async function request(path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...opts.headers,
    },
    credentials: "include",
  });

  if (res.status === 401) {
    // Redirect to login
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }

  return res.json();
}

export const api = {
  // Auth
  login: (password: string) => request("/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request("/logout", { method: "POST" }),

  // Companies
  getCompanies: (listId?: number) => request(`/companies${listId ? `?listId=${listId}` : ""}`),
  getCompany: (id: number) => request(`/companies/${id}`),
  createCompany: (data: any) => request("/companies", { method: "POST", body: JSON.stringify(data) }),
  updateCompany: (id: number, data: any) => request(`/companies/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteCompany: (id: number) => request(`/companies/${id}`, { method: "DELETE" }),
  analyzeCompany: (id: number, opts?: { skipFetch?: boolean }) => 
    request(`/companies/${id}/analyze`, { method: "POST", body: JSON.stringify(opts || {}) }),
  reAnalyzeCompany: (id: number) => request(`/companies/${id}/re-analyze`, { method: "POST" }),
  getCompanyTerminology: (id: number) => request(`/companies/${id}/terminology`),

  // Batch
  analyzeAll: (opts?: { listId?: number; frameworkId?: number }) =>
    request("/companies/analyze-all", { method: "POST", body: JSON.stringify(opts || {}) }),
  getBatchStatus: () => request("/batch/status"),
  cancelBatch: () => request("/batch/cancel", { method: "POST" }),
  getBatchRuns: () => request("/batch/runs"),

  // Reset
  resetCompany: (id: number) => request(`/companies/${id}/reset`, { method: "POST" }),
  resetCompanyList: (listId: number) => request(`/company-lists/${listId}/reset`, { method: "POST" }),
  resetAll: () => request("/companies/reset-all", { method: "POST" }),

  // Frameworks
  getFrameworks: () => request("/frameworks"),
  getFramework: (id: number) => request(`/frameworks/${id}`),
  createFramework: (data: any) => request("/frameworks", { method: "POST", body: JSON.stringify(data) }),
  updateFramework: (id: number, data: any) => request(`/frameworks/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  activateFramework: (id: number) => request(`/frameworks/${id}/activate`, { method: "POST" }),
  deleteFramework: (id: number) => request(`/frameworks/${id}`, { method: "DELETE" }),
  bulkCreateMeasures: (frameworkId: number, measures: any[]) =>
    request(`/frameworks/${frameworkId}/measures/bulk`, { method: "POST", body: JSON.stringify({ measures }) }),
  deleteMeasure: (frameworkId: number, measureId: string) =>
    request(`/frameworks/${frameworkId}/measures/${measureId}`, { method: "DELETE" }),
  updateMeasure: (frameworkId: number, measureId: string, data: any) =>
    request(`/frameworks/${frameworkId}/measures/${measureId}`, { method: "PATCH", body: JSON.stringify(data) }),
  createMeasure: (frameworkId: number, data: any) =>
    request(`/frameworks/${frameworkId}/measures`, { method: "POST", body: JSON.stringify(data) }),
  chatFrameworkEditor: (messages: Array<{role: string; content: string}>, frameworkId: number) =>
    request("/framework-builder/edit", { method: "POST", body: JSON.stringify({ messages, frameworkId }) }),
  draftFramework: (data: any) => request("/framework-builder/draft", { method: "POST", body: JSON.stringify(data) }),
  chatFrameworkBuilder: (messages: Array<{role: string; content: string}>, currentDraft?: any, fileContext?: Array<{filename: string; content: string}>) =>
    request("/framework-builder/chat", { method: "POST", body: JSON.stringify({ messages, currentDraft, fileContext }) }),
  uploadFrameworkFile: async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${BASE}/framework-builder/upload`, {
      method: "POST",
      body: formData,
      credentials: "include",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || res.statusText);
    }
    return res.json();
  },

  // Settings
  getSettings: () => request("/settings"),
  updateSettings: (data: any) => request("/settings", { method: "POST", body: JSON.stringify(data) }),

  // Providers
  getProviderStatus: () => request("/providers/status"),

  // Diagnostics
  getRecentErrors: () => request("/diagnostics/recent-errors"),
  getDiscoveryDiagnostics: (id: number) => request(`/diagnostics/companies/${id}/discovery`),

  // Snapshots
  createSnapshot: (companyId: number, label?: string) =>
    request(`/companies/${companyId}/snapshot`, { method: "POST", body: JSON.stringify({ label }) }),
  getSnapshots: (companyId?: number) => request(`/snapshots${companyId ? `?companyId=${companyId}` : ""}`),
  deleteSnapshot: (id: number) => request(`/snapshots/${id}`, { method: "DELETE" }),

  // Trusted Sources
  getTrustedSources: () => request("/trusted-sources"),
  createTrustedSource: (data: any) => request("/trusted-sources", { method: "POST", body: JSON.stringify(data) }),
  deleteTrustedSource: (id: number) => request(`/trusted-sources/${id}`, { method: "DELETE" }),

  // Company Lists
  getCompanyLists: () => request("/company-lists"),
  deleteCompanyList: (id: number, deleteCompanies: boolean = false) =>
    request(`/company-lists/${id}?deleteCompanies=${deleteCompanies}`, { method: "DELETE" }),

  // Import
  importCompanies: async (file: File, listName?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    if (listName) formData.append("listName", listName);
    const res = await fetch(`${BASE}/companies/import`, {
      method: "POST",
      body: formData,
      credentials: "include",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || res.statusText);
    }
    return res.json();
  },

  // Analysis Results
  getAnalysisResults: () => request("/analysis-results"),
  getAnalysisResult: (id: number) => request(`/analysis-results/${id}`),
  deleteAnalysisResult: (id: number) => request(`/analysis-results/${id}`, { method: "DELETE" }),
  getAnalysisResultDownloadUrl: (id: number) => `${BASE}/analysis-results/${id}/download`,
  getShareUrl: (token: string) => `${window.location.origin}${BASE}/share/${token}`,

  // Document upload
  uploadDocument: async (companyId: number, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${BASE}/companies/${companyId}/documents`, {
      method: "POST",
      body: formData,
      credentials: "include",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || res.statusText);
    }
    return res.json();
  },
};
