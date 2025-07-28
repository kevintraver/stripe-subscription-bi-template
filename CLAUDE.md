# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Mastra-based template for building subscription business intelligence chat systems using MCP (Model Control Protocol) servers. The system enables SaaS business owners to obtain subscription metrics through natural language conversations by calculating key subscription metrics from Stripe data on-demand.

## Task Management

Development is managed through the `/tasks` folder structure:

- **PRD Documents**: Each feature has a Product Requirements Document (PRD) that defines the goals, user stories, functional requirements, and technical considerations
- **Task Lists**: Matching task files break down the PRD into specific, actionable development tasks with clear dependencies and testing requirements
- **Current Focus**: The primary development focus is implementing a subscription BI chat system as defined in:
  - `tasks/prd-subscription-bi-chat.md` - Complete PRD for the subscription BI feature
  - `tasks/tasks-prd-subscription-bi-chat.md` - Detailed task breakdown with file structure and testing approach

### Task Structure
Tasks are organized in priority order with clear dependencies:
1. **Stripe MCP Integration Infrastructure** - Core connectivity and data handling
2. **Core Subscription Metric Calculation Tools** - Individual tools for each business metric (MRR, ARPU, Churn, LTV, etc.)
3. **Conversational Agent** - Natural language interface with business intelligence context
4. **Tool Orchestration** - Dependency management and intelligent tool selection
5. **Testing Suite** - Comprehensive validation framework

## Development Commands

### Running the Application
- `pnpm dev` - Start Mastra server in development mode with hot reload (runs on port 4112)
- `pnpm start` - Start Mastra server in production mode
- `pnpm build` - Build the application using Mastra
- `pnpm run mcp:server` - Run standalone MCP server only (runs on port 4111)
- `pnpm run planets:demo` - Run planets demo script

### Testing
- `pnpm test` - Run tests using Vitest

## Architecture

### Current Implementation (Template)

**Mastra Application** (`src/mastra/index.ts`)
- Main application configuration with agents, MCP servers, and API routes
- Exposes health check at `/health` and MCP info at `/mcp/info`
- Runs on port 4112 by default

**MCP Server** (`src/mastra/mcp/mcp-server.ts`)
- Defines tools available via MCP protocol
- Can run standalone or embedded in Mastra app
- Exposes tools via HTTP/SSE transport on port 4111

**MCP Client** (`src/mastra/mcp/mcp-client.ts`)
- Connects to MCP server to retrieve and use tools
- Used by agents to access MCP-exposed functionality

**Documentation Agent** (`src/mastra/agents/docs-agent.ts`)
- Uses OpenAI GPT-4.1 model
- Leverages tools from MCP server via the client
- Provides expert guidance on available functions

**Documentation Tool** (`src/mastra/tools/docs-tool.ts`)
- Queries function data from `src/data/functions.json`
- Returns function details including arguments, types, and tips
- Supports random function selection when no specific function requested

### Target Implementation (Subscription BI)

Based on the PRD and task structure, the system will be refactored to include:

**Subscription BI Agent** (`src/agents/subscription-bi-agent.ts`)
- Conversational agent specialized for subscription business intelligence queries
- Interprets natural language requests for metrics like MRR, churn, ARPU, LTV
- Provides explanations of calculations and business context

**Stripe MCP Integration** (`src/services/stripe-mcp-client.ts`)
- Connects to official Stripe MCP server for reliable data access
- Handles authentication, rate limiting, and error recovery
- Implements session-level caching for conversation efficiency

**Metric Calculation Tools** (`src/tools/stripe-*-tool.ts`)
- Individual tools for each subscription metric (MRR, ARPU, Churn, LTV, etc.)
- Proper Zod schema validation and dependency management
- Human-readable explanations included in tool outputs

**Supporting Infrastructure**
- `src/utils/subscription-calculations.ts` - Shared calculation utilities
- `src/schemas/subscription-metrics.ts` - Input/output validation schemas  
- `src/types/subscription-types.ts` - TypeScript definitions for subscription data

## Environment Variables

Required environment variables (see `.env.example`):
- `OPENAI_API_KEY` - OpenAI API key for the agent
- `MCP_SERVER_URL` - MCP server endpoint (default: http://localhost:4111/mcp)
- `SERVER_BASE_URL` - Base URL for the application (default: http://localhost:4112)
- `NODE_ENV` - Environment (development/production)
- `PORT` - Application port (default: 4112)
- `MCP_PORT` - MCP server port (default: 4111)

## Development Workflow

### Task-Driven Development
1. **Review PRD**: Understand feature requirements in `tasks/prd-*.md`
2. **Follow Task List**: Work through tasks in `tasks/tasks-*.md` in dependency order
3. **Test-Driven**: Each implementation file should have corresponding `.test.ts` file
4. **Validation**: Run `pnpm test` to ensure all tests pass before moving to next task

### Adding New Tools
1. Create tool in `src/tools/` following the naming pattern `stripe-*-tool.ts`
2. Include Zod schemas for input/output validation
3. Write comprehensive unit tests in corresponding `.test.ts` file
4. Register tool with the Mastra application for agent access

### Modifying Agent Behavior
- Update agent instructions in `src/agents/subscription-bi-agent.ts`
- Focus on business intelligence context and metric interpretation
- Ensure agent can explain calculation methodologies to business users

## Key Patterns

### MCP Workflow
1. Tools are defined and registered in MCP server
2. MCP client connects to server and retrieves available tools
3. Agents use MCP client to access tools dynamically
4. This creates loose coupling between tools and agents

### TypeScript Configuration
- Uses ES2022 modules with bundler resolution
- Includes all files under `src/`
- No emit, used for type checking only