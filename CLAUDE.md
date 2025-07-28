# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Mastra-based template for building documentation chatbots using MCP (Model Control Protocol) servers. It demonstrates how to create an MCP server that exposes tools for interacting with documentation (currently planet/space data) and an agent that can use those tools.

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

### Core Components

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

### Data Structure

**Functions Data** (`src/data/functions.json`)
- Contains mock planetary/space function definitions
- Each function includes description, arguments (with types/requirements), and usage tips
- Replace this with your actual documentation data

## Environment Variables

Required environment variables (see `.env.example`):
- `OPENAI_API_KEY` - OpenAI API key for the agent
- `MCP_SERVER_URL` - MCP server endpoint (default: http://localhost:4111/mcp)
- `SERVER_BASE_URL` - Base URL for the application (default: http://localhost:4112)
- `NODE_ENV` - Environment (development/production)
- `PORT` - Application port (default: 4112)
- `MCP_PORT` - MCP server port (default: 4111)

## Customization

### Adding New Tools
1. Create tool in `src/mastra/tools/`
2. Register in MCP server (`src/mastra/mcp/mcp-server.ts`)
3. Tool automatically becomes available to agents via MCP client

### Modifying Data Source
- Replace `src/data/functions.json` with your documentation data
- Update tool logic in `src/mastra/tools/docs-tool.ts` to match your data structure

### Agent Configuration
- Agents automatically receive tools from MCP server
- Modify agent instructions in `src/mastra/agents/docs-agent.ts`
- Agent uses OpenAI GPT-4.1 model by default

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