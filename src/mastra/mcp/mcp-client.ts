import { MCPClient } from '@mastra/mcp';

// Build servers configuration conditionally
const servers: Record<string, any> = {
  // Connect to local MCP server via HTTP/SSE
  localTools: {
    url: new URL(process.env.MCP_SERVER_URL || 'http://localhost:4111/mcp'),
  },
};

// Only add Stripe MCP server if STRIPE_SECRET_KEY is provided
if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.trim() !== '') {
  servers.stripe = {
    url: new URL('https://mcp.stripe.com'),
    requestInit: {
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    },
  };
  console.log('✅ Stripe MCP server configured');
} else {
  console.warn('⚠️  STRIPE_SECRET_KEY not found - Stripe MCP server disabled. Add STRIPE_SECRET_KEY to .env to enable Stripe tools.');
}

// Create MCP client with conditional server configuration
export const mcpClient = new MCPClient({
  servers,
});
