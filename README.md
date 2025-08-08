## Stripe Subscription BI Chat Template (Mastra + Stripe MCP)

This template provides a starting point for building a conversational Subscription BI assistant using Mastra and the official Stripe MCP server. It lets stakeholders ask natural‑language questions like “What’s our MRR this month?” and receive accurate, explainable metrics computed from Stripe subscription data. You can extend or swap tools, workflows, and the agent to match your business needs.

### What you get

- **Conversational agent** that answers subscription BI questions
- **Stripe MCP integration** for secure, first‑party data access
- **Metric tools and workflows** with dependency orchestration (MRR → ARPU → LTV)
- **Explanations** of formulas and methodology on demand

### Goal of the template

- Provide a clear, extensible architecture for chat‑based subscription analytics
- Demonstrate how to connect Mastra agents to Stripe via MCP
- Offer ready‑made metric tools/workflows you can customize or replace

## 🏗️ Project Structure

```
src/
├── data/
│   └── functions.json                # Sample data for local docs tool
├── mastra/
│   ├── agents/
│   │   └── stripe-agent.ts           # Stripe subscription BI agent
│   ├── mcp/
│   │   ├── mcp-client.ts             # Connects to local MCP + Stripe MCP
│   │   └── mcp-server.ts             # Local MCP server (HTTP/SSE)
│   ├── tools/
│   │   ├── docs-tool.ts              # Example docs tool (local)
│   │   ├── stripe-mrr-tool.ts        # MRR calculation
│   │   ├── stripe-active-subscribers-tool.ts
│   │   ├── stripe-arpu-tool.ts
│   │   ├── stripe-churn-rate-tool.ts
│   │   ├── stripe-ltv-tool.ts
│   │   └── stripe-mrr-expansion-tool.ts
│   ├── workflows/
│   │   ├── mrr-calculation-workflow.ts
│   │   ├── active-subscribers-workflow.ts
│   │   ├── arpu-calculation-workflow.ts
│   │   ├── churn-rate-workflow.ts
│   │   ├── ltv-calculation-workflow.ts
│   │   └── mrr-expansion-workflow.ts
│   └── index.ts                      # Mastra app configuration & routes
└── scripts/
    ├── mcp-server-http.ts            # Standalone local MCP server
    └── test-stripe-mcp.ts            # Connectivity test for Stripe MCP
```

## 🚀 Quick Start

### 1) Install dependencies

```bash
pnpm install
```

### 2) Configure environment

Create a `.env` file in the project root:

```env
# Local MCP (HTTP/SSE)
MCP_SERVER_URL=http://localhost:4111/mcp
SERVER_BASE_URL=http://localhost:4111

# Stripe MCP (required for Stripe tools)
STRIPE_SECRET_KEY=sk_live_or_test_...

# Model provider used by the agent (required)
OPENAI_API_KEY=...

# Optional
NODE_ENV=development
PORT=4112
DATABASE_URL=file:./mastra.db
```

Notes

- Stripe tools are enabled only if `STRIPE_SECRET_KEY` is present.
- The agent uses OpenAI via `@ai-sdk/openai`; set `OPENAI_API_KEY`.

### 3) Run the app

```bash
# Start Mastra app (includes /health and /mcp/info)
pnpm dev

# Optionally run the standalone local MCP server (HTTP/SSE)
pnpm run mcp:server
```

Server defaults to `http://localhost:4112`.

### 4) Verify Stripe MCP connectivity

```bash
pnpm run test:mcp
```

## 📡 Endpoints

- `GET /health` – basic status
- `GET /mcp/info` – configured MCP servers and tools
- Local MCP SSE endpoint is exposed by the standalone MCP server at `http://localhost:4111/mcp` when `pnpm run mcp:server` is running

## 📊 Supported Metrics (current month)

- MRR (Monthly Recurring Revenue)
- Active Subscribers
- ARPU (Average Revenue Per User)
- Customer Churn Rate
- LTV (ARPU ÷ Churn Rate)
- MRR Expansion (upgrades)

Planned (scaffolded):

- Revenue Churn Rate, MRR Contraction, Avg Subscription Duration (churned), Revenue at Risk

## 🧠 How it works

- `src/mastra/mcp/mcp-client.ts` connects to:
  - Local MCP for demo tools via HTTP/SSE
  - Stripe MCP at `https://mcp.stripe.com` using `STRIPE_SECRET_KEY`
- `src/mastra/agents/stripe-agent.ts` defines the conversational agent with access to Stripe tools and BI workflows
- Each metric is implemented as a Mastra tool and/or workflow with clear input/output schemas and error handling
- Dependent metrics resolve in order (e.g., ARPU depends on MRR; LTV depends on ARPU and Churn)

## 💬 Example queries

- “What’s our MRR this month?”
- “How many active subscribers do we have?”
- “What’s our ARPU, and how did you calculate it?”
- “What’s our customer churn rate this month?”
- “What’s our LTV based on current churn?”

## 🧪 Testing

```bash
pnpm test
```

## 🔐 Configuration & Auth

- Stripe MCP requires `STRIPE_SECRET_KEY` (test or live) – the client is enabled only when present.
- The agent uses OpenAI via `@ai-sdk/openai`. Provide `OPENAI_API_KEY`.

## 🌐 Deployment

Recommended env for production:

```env
NODE_ENV=production
PORT=4112
MCP_SERVER_URL=https://your-app.example.com/mcp
SERVER_BASE_URL=https://your-app.example.com
STRIPE_SECRET_KEY=sk_live_...
OPENAI_API_KEY=...
```

## ⚠️ Notes & Limitations

- Default focus is the current calendar month; you can extend for historical trends/forecasting.
- Tool outputs include values and brief explanations; follow‑ups can request methodology.
- Rate‑limit and error handling are implemented in tools/workflows; failures return user‑friendly messages.

## 🙌 Context

This template originated from a docs/MCP starter and was adapted to demonstrate Stripe Subscription BI via chat. It is intended to be forked and customized for your use case.

## 📚 References

- Mastra docs: `https://docs.mastra.ai`
- MCP spec: `https://spec.modelcontextprotocol.io`
- Stripe MCP: `https://mcp.stripe.com`
