# CLAUDE.md

This file provides context and instructions for Claude Code when working with this repository.

## Project Overview

Stripe Subscription BI Template - A Mastra-based application for subscription business intelligence using MCP (Model Control Protocol) servers. The system enables SaaS business owners to obtain subscription metrics through natural language conversations by calculating key subscription metrics from Stripe data on-demand.

## Architecture

### Current Implementation
- **Mastra Application** (`src/mastra/index.ts`) - Main application with agents, MCP servers, and API routes
- **MCP Server** (`src/mastra/mcp/mcp-server.ts`) - Defines tools via MCP protocol, runs on port 4111
- **Documentation Agent** (`src/mastra/agents/docs-agent.ts`) - Uses OpenAI GPT-4.1 with MCP tools

### Target Implementation (Subscription BI)
- **Subscription BI Agent** - Conversational interface for subscription metrics (MRR, ARPU, Churn, LTV)
- **Stripe MCP Integration** - Connects to official Stripe MCP server for data access
- **Metric Calculation Tools** - Individual tools for each subscription metric with Zod validation

## Development Commands

- `pnpm dev` - Start development server with hot reload (port 4112)
- `pnpm start` - Start production server  
- `pnpm build` - Build application using Mastra
- `pnpm test` - Run tests using Vitest
- `pnpm run mcp:server` - Run standalone MCP server only (port 4111)

## Environment Variables

Required in `.env` (see `.env.example`):
- `OPENAI_API_KEY` - OpenAI API key for the agent
- `STRIPE_SECRET_KEY` - Stripe secret key for accessing subscription data
- `MCP_SERVER_URL` - MCP server endpoint (default: http://localhost:4111/mcp)
- `SERVER_BASE_URL` - Base URL for the application (default: http://localhost:4112)
- `NODE_ENV` - Environment (development/production)
- `PORT` - Application port (default: 4112)
- `MCP_PORT` - MCP server port (default: 4111)

## Task Management

Development follows the `/tasks` folder structure:
- `tasks/prd-subscription-bi-chat.md` - Complete PRD for subscription BI feature
- `tasks/tasks-prd-subscription-bi-chat.md` - Detailed task breakdown

Tasks are prioritized: Stripe MCP Integration → Metric Calculation Tools → Conversational Agent → Tool Orchestration → Testing Suite

## Development Workflow

1. Review PRD requirements in `tasks/prd-*.md`
2. Follow task list in `tasks/tasks-*.md` in dependency order
3. Each implementation file should have corresponding `.test.ts` file
4. Run `pnpm test` to ensure all tests pass before moving to next task