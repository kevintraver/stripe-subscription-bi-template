import { MCPClient } from '@mastra/mcp';

let _mcpClient: MCPClient | null = null;

// Function to create MCP client with proper environment variable access
function createMCPClient() {
  // Build servers configuration conditionally
  const servers: Record<string, any> = {
    // Connect to local MCP server via HTTP/SSE
    localTools: {
      url: new URL(process.env.MCP_SERVER_URL || 'http://localhost:4111/mcp'),
    },
  };

  // Only add Stripe MCP server if STRIPE_SECRET_KEY is provided
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  console.log('DEBUG: STRIPE_SECRET_KEY check:', {
    exists: !!stripeKey,
    length: stripeKey?.length || 0,
    prefix: stripeKey?.substring(0, 10) + '...'
  });

  if (stripeKey && stripeKey.trim() !== '') {
    servers.stripe = {
      url: new URL('https://mcp.stripe.com'),
      requestInit: {
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          'Content-Type': 'application/json',
        },
      },
    };
    console.log('✅ Stripe MCP server configured');
  } else {
    console.warn('⚠️  STRIPE_SECRET_KEY not found - Stripe MCP server disabled. Add STRIPE_SECRET_KEY to .env to enable Stripe tools.');
  }

  return new MCPClient({
    servers,
  });
}

// Lazy initialization of MCP client
export const mcpClient = {
  async getToolsets() {
    if (!_mcpClient) {
      _mcpClient = createMCPClient();
    }
    return await _mcpClient.getToolsets();
  },
  
  async getTools() {
    if (!_mcpClient) {
      _mcpClient = createMCPClient();
    }
    return await _mcpClient.getTools();
  },
  
  async disconnect() {
    if (_mcpClient) {
      await _mcpClient.disconnect();
      _mcpClient = null;
    }
  }
};
