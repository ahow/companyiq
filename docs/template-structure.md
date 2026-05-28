# CompanyIQ Framework Template Structure

## Overview

A **framework template** defines a structured assessment that is applied to each company in a list. The system discovers public documents for each company, fetches them, and then uses an LLM to score the company against each measure in the template. The quality of the template directly determines the quality of the analysis.

## Template Components

### 1. Framework Metadata

| Field | Type | Purpose |
|-------|------|---------|
| `name` | string | Human-readable name for the framework (e.g., "Corporate AI Governance Assessment Framework") |
| `version` | string | Version identifier (e.g., "v1.0") |
| `topicDescription` | string | **Critical** — A detailed paragraph describing the topic being assessed. This is used in the LLM scoring prompt as context and in document summarization. Must be specific enough to guide the LLM. |
| `analystRole` | string | The persona the LLM adopts when scoring (e.g., "ESG governance analyst specializing in AI policy") |
| `scoringMode` | "binary" | Currently only binary (Yes/No/Partial) scoring is supported |
| `searchTemplates` | string[] | Custom search query templates used during document discovery. Placeholders: `{company}`, `{domain}` |
| `negativeKeywords` | string[] | Keywords that indicate a document is NOT relevant (used by the relevance gate) |
| `negativeDomains` | string[] | Domains to exclude from discovery (e.g., competitor sites) |
| `knownDisclosureUrls` | string[] | URLs that are always included for every company (e.g., a standard registry) |

### 2. Categories

Measures are grouped into **categories** (typically 4-8). Each category represents a thematic area of the assessment.

| Field | Type | Purpose |
|-------|------|---------|
| `name` | string | Category name (e.g., "Board Oversight & Governance") |
| `categoryNumber` | integer | Display order (1-based) |

### 3. Measures (Questions)

Each measure is a specific, assessable question. This is the core of the template.

| Field | Type | Purpose | Criticality |
|-------|------|---------|-------------|
| `measureId` | string | Unique slug (e.g., "1.1-board-ai-oversight") | Required |
| `title` | string | The question being asked (e.g., "Does the company have a board-level committee with explicit oversight of AI governance?") | **Critical** |
| `definition` | string | Detailed explanation of what constitutes a "Yes" answer. This is the most important field for scoring accuracy. | **Critical** |
| `category` | string | Which category this belongs to | Required |
| `categoryNumber` | integer | Category order number | Required |
| `displayOrder` | integer | Order within category | Required |
| `scoringGuidance` | object | Explicit criteria for Yes/No/Partial verdicts | **Critical** |
| `evidenceKeywords` | string[] | Keywords that indicate relevant evidence in documents | Important |
| `querySeeds` | string[] | Additional search terms specific to this measure | Optional |
| `referenceUrls` | string[] | Known URLs where this information is typically found | Optional |

### 4. Scoring Guidance (per measure)

The `scoringGuidance` object provides explicit instructions to the LLM for each verdict:

```json
{
  "yes": "What specific evidence constitutes a clear YES. Be precise about what must be present.",
  "no": "What absence or condition constitutes a NO verdict.",
  "partial": "What constitutes partial compliance — evidence exists but is incomplete."
}
```

## How the Template is Used During Analysis

1. **Document Discovery**: The `searchTemplates` field generates search queries. If empty, default queries are used based on `topicDescription`.

2. **Relevance Gate**: `negativeKeywords` and `negativeDomains` filter out irrelevant documents.

3. **Evidence Retrieval**: For each measure, the system uses BM25 keyword matching with `evidenceKeywords` and the measure `title`/`definition` to extract relevant passages from fetched documents.

4. **LLM Scoring Prompt**: The LLM receives:
   - The `topicDescription` as context
   - The measure `title` and `definition`
   - The `scoringGuidance` (yes/no/partial criteria)
   - Extracted evidence passages
   - Company terminology (auto-discovered)

5. **Verdict**: The LLM returns a binary score (0 or 1), verdict (Yes/No/Partial), confidence level, evidence summary, and verbatim quotes.

## What Makes a Good Template

### The `definition` field is paramount

The `definition` must be:
- **Specific**: Not "Does the company have AI governance?" but "Does the company have a named board-level committee or sub-committee with explicit, documented responsibility for overseeing AI strategy, risk, and ethics?"
- **Observable**: Describes what would be visible in public documents (reports, policies, filings)
- **Unambiguous**: A human analyst reading the same documents should reach the same conclusion
- **Bounded**: Clearly states what counts and what doesn't

### The `scoringGuidance` must be precise

Bad example:
```json
{"yes": "Evidence of AI governance", "no": "No evidence"}
```

Good example:
```json
{
  "yes": "The company names a specific board committee (e.g., Technology Committee, AI Ethics Board) with documented terms of reference that include AI oversight. Evidence must include the committee name and its AI-related mandate.",
  "no": "No board-level committee with AI oversight is mentioned in any corporate document, or AI governance is only handled at management level without board reporting.",
  "partial": "A board committee exists that covers technology/digital topics broadly, but AI is not explicitly mentioned in its mandate or terms of reference."
}
```

### The `topicDescription` must be comprehensive

This field guides both document discovery and LLM scoring. It should be a full paragraph (100-300 words) covering:
- What the assessment is about
- What types of evidence are relevant
- What industry standards or frameworks inform the assessment
- What is explicitly NOT in scope

### Search templates should be targeted

Default search queries may miss important documents. Custom `searchTemplates` should target:
- The company's sustainability/ESG reports
- Specific policy documents
- Regulatory filings
- Industry-specific disclosure locations

## Template Quality Checklist

Before an analysis template is considered ready:

- [ ] `topicDescription` is at least 100 words and covers scope, evidence types, and exclusions
- [ ] Each measure has a `definition` of at least 50 words
- [ ] Each measure has `scoringGuidance` with specific yes/no/partial criteria
- [ ] Measures are mutually exclusive (no two measures ask the same thing differently)
- [ ] Measures are collectively exhaustive (cover all important aspects of the topic)
- [ ] `evidenceKeywords` are provided for measures where the title alone may not surface relevant passages
- [ ] Categories are logically grouped and ordered
- [ ] The template has been reviewed for internal consistency (no contradictions between measures)
- [ ] Measures are answerable from public corporate disclosures (not requiring insider knowledge)
- [ ] The number of measures is appropriate (10-50 for most topics; more measures = more granular but slower)
