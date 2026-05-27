import axios from "axios";
import { storage } from "../storage.js";
import { completeWithFallback } from "./ai-providers.js";
import type { Framework, TrustedSource } from "../../shared/schema.js";

const MAX_DOCS_RETURNED = 60;
const PRE_GATE_CAP = 120;
const SEARCH_TIMEOUT = 15000;

// ─── SerpAPI Key ────────────────────────────────────────────────────────────

function getSerpApiKey(): string {
  // Support SERP_API_KEY (SerpAPI) or SERPER_API_KEY (Serper.dev) or fallback
  const key = process.env.SERP_API_KEY || process.env.SERPER_API_KEY;
  if (!key) throw new Error("No SERP_API_KEY or SERPER_API_KEY configured");
  return key;
}

// ─── Search Provider ────────────────────────────────────────────────────────

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  position?: number;
}

async function webSearch(
  query: string,
  opts: { num?: number; tbs?: string } = {}
): Promise<SearchResult[]> {
  try {
    const apiKey = getSerpApiKey();
    const params: any = {
      q: query,
      api_key: apiKey,
      engine: "google",
      num: opts.num || 10,
    };
    if (opts.tbs) params.tbs = opts.tbs;

    const response = await axios.get("https://serpapi.com/search.json", {
      params,
      timeout: SEARCH_TIMEOUT,
    });

    const organic = response.data.organic_results || [];
    return organic.map((r: any, idx: number) => ({
      title: r.title || "",
      link: r.link || "",
      snippet: r.snippet || "",
      position: r.position || idx + 1,
    }));
  } catch (error: any) {
    console.warn(`[Discovery] Search failed for "${query}": ${error.message}`);
    return [];
  }
}

// ─── Query Construction ──────────────────────────────────────────────────────

interface DiscoveryCandidate {
  url: string;
  title: string;
  snippet: string;
  lane: string;
  priority: number;
}

function buildGeneralQueries(companyName: string, framework: Framework): string[] {
  const topic = framework.topicDescription || framework.name;
  const templates = framework.searchTemplates || [
    `"${companyName}" sustainability report`,
    `"${companyName}" ESG report`,
    `"${companyName}" corporate responsibility report`,
    `"${companyName}" annual report governance`,
    `"${companyName}" ${topic}`,
    `"${companyName}" policy framework`,
  ];
  return templates.map((t) => t.replace(/\{company\}/g, companyName));
}

function buildDomainQueries(companyName: string, domain: string, framework: Framework): string[] {
  return [
    `site:${domain} sustainability report`,
    `site:${domain} governance`,
    `site:${domain} ESG`,
    `site:${domain} annual report`,
    `site:${domain} policy`,
    `site:${domain}/investors`,
  ];
}

function buildTrustedSourceQueries(companyName: string, sources: TrustedSource[]): string[] {
  return sources
    .filter((s) => s.isActive)
    .map((s) => `site:${s.domain} "${companyName}"`);
}

function buildCJKQueries(companyName: string, framework: Framework): string[] {
  // Detect if company name contains CJK characters
  const hasCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(companyName);
  if (!hasCJK) return [];

  const topic = framework.topicDescription || framework.name;
  // Generate localized queries
  return [
    `${companyName} サステナビリティ報告書`,
    `${companyName} ESG報告`,
    `${companyName} 可持续发展报告`,
    `${companyName} 지속가능경영보고서`,
    `${companyName} ${topic}`,
  ];
}

// ─── Ranking and Demotion ────────────────────────────────────────────────────

function calculatePriority(
  url: string,
  title: string,
  companyDomain: string | null,
  framework: Framework
): number {
  let priority = 0;
  const urlLower = url.toLowerCase();
  const titleLower = title.toLowerCase();

  // On-company-domain bonus
  if (companyDomain && urlLower.includes(companyDomain)) {
    priority -= 8;
  }

  // Regulator domain bonus
  const regulatorDomains = ["sec.gov", "fca.org.uk", "esma.europa.eu", "asic.gov.au"];
  if (regulatorDomains.some((d) => urlLower.includes(d))) {
    priority -= 4;
  }

  // URL slug bonuses
  const slugBonuses: Record<string, number> = {
    governance: -5,
    sustainability: -4,
    "responsible-ai": -5,
    ethics: -3,
    policy: -3,
    report: -2,
    esg: -4,
    "annual-report": -4,
    proxy: -3,
    "def-14a": -5,
  };
  for (const [slug, bonus] of Object.entries(slugBonuses)) {
    if (urlLower.includes(slug)) priority += bonus;
  }

  // AI keyword bonus
  const aiKeywords = ["ai", "artificial-intelligence", "model-risk", "machine-learning"];
  if (aiKeywords.some((k) => urlLower.includes(k))) {
    priority -= 3;
  }

  // Third-party blog/news penalty
  const newsDomains = ["reuters.com", "bloomberg.com", "cnbc.com", "bbc.com", "medium.com"];
  if (newsDomains.some((d) => urlLower.includes(d))) {
    priority += 5;
  }

  // Negative keywords penalty
  if (framework.negativeKeywords) {
    for (const kw of framework.negativeKeywords) {
      if (titleLower.includes(kw.toLowerCase())) {
        priority += 12;
      }
    }
  }

  // Negative domains penalty
  if (framework.negativeDomains) {
    for (const domain of framework.negativeDomains) {
      if (urlLower.includes(domain.toLowerCase())) {
        priority += 15;
      }
    }
  }

  // Customer content paths penalty
  const customerPaths = ["/wealth-management/articles/", "/insights/", "/blog/", "/news/"];
  if (companyDomain && urlLower.includes(companyDomain)) {
    if (customerPaths.some((p) => urlLower.includes(p))) {
      priority += 25;
    }
  }

  return priority;
}

// ─── Relevance Gate ──────────────────────────────────────────────────────────

async function runRelevanceGate(
  candidates: DiscoveryCandidate[],
  framework: Framework,
  companyName: string
): Promise<DiscoveryCandidate[]> {
  const gateModel = "claude-haiku";
  const batchSize = 20;
  const accepted: DiscoveryCandidate[] = [];

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const urlList = batch
      .map((c, idx) => `${idx + 1}. URL: ${c.url}\n   Title: ${c.title}\n   Snippet: ${c.snippet}`)
      .join("\n\n");

    try {
      const { text } = await completeWithFallback(gateModel, {
        system: `You are a document relevance classifier. Given a list of URLs found for a company, classify each as "accept" or "reject" based on whether it is likely to contain substantive disclosure relevant to the analysis topic. Accept corporate reports, filings, policy documents, governance pages. Reject news articles, marketing content, job postings, product pages.`,
        prompt: `Company: ${companyName}\nAnalysis topic: ${framework.topicDescription || framework.name}\n\nClassify each URL:\n\n${urlList}\n\nReturn a JSON array of objects: [{"index": 1, "verdict": "accept"|"reject", "reason": "brief reason"}]`,
        json: true,
        maxTokens: 2000,
      });

      const verdicts = JSON.parse(text);
      for (const v of verdicts) {
        const idx = v.index - 1;
        if (idx >= 0 && idx < batch.length) {
          if (v.verdict === "accept") {
            accepted.push(batch[idx]);
          }
        }
      }
    } catch (error: any) {
      // On gate failure, accept all in this batch (fail-open)
      console.warn(`[Discovery] Gate batch failed: ${error.message}, accepting all`);
      accepted.push(...batch);
    }
  }

  return accepted;
}

// ─── Main Discovery Function ─────────────────────────────────────────────────

export interface DiscoveryDiagnostics {
  totalCandidates: number;
  acceptedByGate: number;
  finalCount: number;
  lanes: Record<string, number>;
  topUrls: Array<{ url: string; title: string; priority: number }>;
}

export interface DiscoveryResult {
  documents: DiscoveryCandidate[];
  diagnostics: DiscoveryDiagnostics;
}

export async function searchCompanyDocuments(opts: {
  companyName: string;
  companyId: number;
  companyDomain?: string | null;
  isin?: string | null;
  pinnedUrls?: string[];
  framework: Framework;
  trustedSources: TrustedSource[];
}): Promise<DiscoveryResult> {
  const { companyName, companyId, companyDomain, pinnedUrls, framework, trustedSources } = opts;
  const allCandidates: DiscoveryCandidate[] = [];
  const seenUrls = new Set<string>();
  const laneCounts: Record<string, number> = {};

  function addCandidate(result: SearchResult, lane: string) {
    if (seenUrls.has(result.link)) return;
    seenUrls.add(result.link);
    const priority = calculatePriority(result.link, result.title, companyDomain || null, framework);
    allCandidates.push({
      url: result.link,
      title: result.title,
      snippet: result.snippet,
      lane,
      priority,
    });
    laneCounts[lane] = (laneCounts[lane] || 0) + 1;
  }

  // Add pinned URLs with maximum priority
  if (pinnedUrls) {
    for (const url of pinnedUrls) {
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        allCandidates.push({
          url,
          title: "Pinned document",
          snippet: "",
          lane: "pinned",
          priority: -100,
        });
        laneCounts["pinned"] = (laneCounts["pinned"] || 0) + 1;
      }
    }
  }

  // Lane 1: General search (with recency filter)
  console.log(`[${companyName}] Running general search lane`);
  const generalQueries = buildGeneralQueries(companyName, framework);
  for (const query of generalQueries) {
    const results = await webSearch(query, { num: 10, tbs: "qdr:y2" });
    for (const r of results) addCandidate(r, "general");

    // If too few results with recency filter, retry without
    if (results.length < 3) {
      const unfiltered = await webSearch(query, { num: 10 });
      for (const r of unfiltered) addCandidate(r, "general-unfiltered");
    }
  }

  // Lane 2: Domain-anchored search
  if (companyDomain) {
    console.log(`[${companyName}] Running domain-anchored search lane`);
    const domainQueries = buildDomainQueries(companyName, companyDomain, framework);
    for (const query of domainQueries) {
      const results = await webSearch(query, { num: 10 });
      for (const r of results) addCandidate(r, "domain");
    }
  }

  // Lane 3: Trusted source search
  if (trustedSources.length > 0) {
    console.log(`[${companyName}] Running trusted source search lane`);
    const tsQueries = buildTrustedSourceQueries(companyName, trustedSources);
    for (const query of tsQueries.slice(0, 5)) {
      const results = await webSearch(query, { num: 5 });
      for (const r of results) addCandidate(r, "trusted");
    }
  }

  // Lane 4: CJK localized search
  const cjkQueries = buildCJKQueries(companyName, framework);
  if (cjkQueries.length > 0) {
    console.log(`[${companyName}] Running CJK search lane`);
    for (const query of cjkQueries) {
      const results = await webSearch(query, { num: 10 });
      for (const r of results) addCandidate(r, "cjk");
    }
  }

  // Lane 5: Known disclosure URLs from framework
  if (framework.knownDisclosureUrls) {
    for (const url of framework.knownDisclosureUrls) {
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        allCandidates.push({
          url,
          title: "Framework known disclosure",
          snippet: "",
          lane: "known",
          priority: -50,
        });
        laneCounts["known"] = (laneCounts["known"] || 0) + 1;
      }
    }
  }

  console.log(`[${companyName}] Discovery found ${allCandidates.length} total candidates`);

  // Cap before gate to bound LLM cost
  const preGateCandidates = allCandidates
    .sort((a, b) => a.priority - b.priority)
    .slice(0, PRE_GATE_CAP);

  // Run relevance gate
  console.log(`[${companyName}] Running relevance gate on ${preGateCandidates.length} candidates`);
  const accepted = await runRelevanceGate(preGateCandidates, framework, companyName);

  console.log(`[${companyName}] Gate accepted ${accepted.length} documents`);

  // Sort by priority and cap
  const finalDocs = accepted
    .sort((a, b) => a.priority - b.priority)
    .slice(0, MAX_DOCS_RETURNED);

  const diagnostics: DiscoveryDiagnostics = {
    totalCandidates: allCandidates.length,
    acceptedByGate: accepted.length,
    finalCount: finalDocs.length,
    lanes: laneCounts,
    topUrls: finalDocs.slice(0, 20).map((d) => ({
      url: d.url,
      title: d.title,
      priority: d.priority,
    })),
  };

  return { documents: finalDocs, diagnostics };
}

// ─── Ensemble Discovery (multiple passes with varied phrasing) ───────────────

export async function searchCompanyDocumentsWithEnsemble(opts: {
  companyName: string;
  companyId: number;
  companyDomain?: string | null;
  isin?: string | null;
  pinnedUrls?: string[];
  framework: Framework;
  trustedSources: TrustedSource[];
  iterations?: number;
}): Promise<DiscoveryResult> {
  const iterations = opts.iterations || 1;

  if (iterations <= 1) {
    return searchCompanyDocuments(opts);
  }

  // Multiple passes with slightly varied queries
  const allDocs: DiscoveryCandidate[] = [];
  const seenUrls = new Set<string>();

  for (let i = 0; i < iterations; i++) {
    const result = await searchCompanyDocuments(opts);
    for (const doc of result.documents) {
      if (!seenUrls.has(doc.url)) {
        seenUrls.add(doc.url);
        allDocs.push(doc);
      }
    }
  }

  const finalDocs = allDocs
    .sort((a, b) => a.priority - b.priority)
    .slice(0, MAX_DOCS_RETURNED);

  return {
    documents: finalDocs,
    diagnostics: {
      totalCandidates: allDocs.length,
      acceptedByGate: allDocs.length,
      finalCount: finalDocs.length,
      lanes: {},
      topUrls: finalDocs.slice(0, 20).map((d) => ({
        url: d.url,
        title: d.title,
        priority: d.priority,
      })),
    },
  };
}
