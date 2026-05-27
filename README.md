# CompanyIQ v2.0

**AI-powered corporate analysis platform** for ESG, governance, and thematic assessment of public companies at scale.

## Overview

CompanyIQ discovers, retrieves, and analyzes corporate disclosure documents using multi-LLM scoring to assess companies against customizable assessment frameworks. It supports batch processing of thousands of companies with configurable ensemble scoring for maximum accuracy.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Frontend (React)                │
│  Dashboard │ Company Detail │ Framework Builder   │
└─────────────────────┬───────────────────────────┘
                      │ REST API
┌─────────────────────┴───────────────────────────┐
│                Express Server (Web)               │
│  Auth │ CRUD │ Import/Export │ Batch Orchestration│
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────┐
│              PostgreSQL (Queue + Data)            │
│  Companies │ Frameworks │ Documents │ Scores      │
│  Jobs (FOR UPDATE SKIP LOCKED) │ Batch Runs      │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────┐
│                Worker Process(es)                 │
│  Discovery → Fetch → Terminology → Score → Save  │
└─────────────────────────────────────────────────┘
```

## Key Features

- **Document Discovery**: Automated web search for sustainability reports, annual reports, governance documents
- **Multi-LLM Scoring**: Ensemble approach using DeepSeek, Claude, GPT-4o, and Gemini
- **Terminology Discovery (T109)**: Per-company vocabulary mapping for accurate scoring
- **BM25 Passage Retrieval**: Targeted evidence extraction from long documents
- **0% Guard**: Prevents overwriting valid prior scores with all-zero low-confidence results
- **Batch Processing**: Queue-based with PostgreSQL FOR UPDATE SKIP LOCKED
- **AI Framework Builder**: Generate assessment frameworks from natural language descriptions
- **CSV/Excel Import/Export**: Bulk company management

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TailwindCSS, React Query, React Router |
| Backend | Express.js, TypeScript |
| Database | PostgreSQL (Drizzle ORM) |
| AI Providers | Anthropic Claude, OpenAI GPT-4o, Google Gemini, DeepSeek |
| Search | Serper.dev API |
| Deployment | Railway (web + worker services) |

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- At least one AI API key (DeepSeek recommended for cost-efficiency)
- Serper.dev API key (for document discovery)

### Local Development

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/companyiq.git
cd companyiq

# Install dependencies
pnpm install
cd client && pnpm install && cd ..

# Set up environment
cp .env.example .env
# Edit .env with your credentials

# Start development servers
pnpm run dev          # Web server on port 3000
pnpm run dev:worker   # Worker process
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `APP_PASSWORD` | Yes | Login password (default: "football") |
| `DEEPSEEK_API_KEY` | Recommended | DeepSeek API key (cheapest option) |
| `ANTHROPIC_API_KEY` | Optional | Claude API key |
| `OPENAI_API_KEY` | Optional | GPT-4o API key |
| `GEMINI_API_KEY` | Optional | Gemini API key |
| `SERPER_API_KEY` | Yes | Serper.dev search API key |
| `WORKER_CONCURRENCY` | Optional | Parallel jobs per worker (default: 2) |

## Deployment on Railway

### Option A: One-Click Deploy

1. Fork this repository
2. Create a new Railway project
3. Add a PostgreSQL service
4. Add a **Web** service connected to this repo (uses `Dockerfile`)
5. Add a **Worker** service connected to this repo (uses `Dockerfile.worker`)
6. Set environment variables on both services
7. Deploy

### Option B: Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and link
railway login
railway init

# Add PostgreSQL
railway add --plugin postgresql

# Deploy
railway up
```

### Service Configuration

**Web Service:**
- Dockerfile: `Dockerfile`
- Port: 3000
- Health check: `/api/health`

**Worker Service:**
- Dockerfile: `Dockerfile.worker`
- No port exposed
- Set `WORKER_CONCURRENCY=3` for faster processing

## Usage

1. **Login** with password "football"
2. **Create a Framework** using the AI Builder (describe what you want to assess)
3. **Import Companies** via CSV/Excel or add manually
4. **Run Analysis** — click "Analyze All" for batch processing
5. **Review Results** — drill into company detail pages for evidence and scores

## Pipeline Flow

```
1. Discovery: Search for company documents (sustainability reports, annual reports, etc.)
2. Gate: AI evaluates each URL for relevance (accept/reject)
3. Fetch: Download and extract text from accepted documents
4. Terminology: Discover company-specific vocabulary (committee names, programme names)
5. Retrieval: BM25 passage extraction for each measure
6. Scoring: LLM evaluates evidence against each measure
7. Ensemble: Optional multi-LLM voting for higher accuracy
8. Save: Store scores with evidence quotes and confidence levels
```

## Cost Estimates

| Mode | Cost per Company | 1000 Companies |
|------|-----------------|----------------|
| Single LLM (DeepSeek) | ~$0.15 | ~$150 |
| Ensemble (3 LLMs) | ~$0.70-1.90 | ~$700-1,900 |

## License

Private — All rights reserved.
