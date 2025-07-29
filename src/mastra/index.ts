import { Mastra } from '@mastra/core/mastra'
import { registerApiRoute } from '@mastra/core/server'
import { PinoLogger } from '@mastra/loggers'
import { mcpServer } from './mcp/mcp-server'
import { docsAgent } from './agents/docs-agent'
import { stripeAgent } from './agents/stripe-agent'
import { mrrCalculationWorkflow } from './workflows/mrr-calculation-workflow'
import { arpuCalculationWorkflow } from './workflows/arpu-calculation-workflow'
import { activeSubscribersWorkflow } from './workflows/active-subscribers-workflow'
import { churnRateWorkflow } from './workflows/churn-rate-workflow'
import { ltvCalculationWorkflow } from './workflows/ltv-calculation-workflow'
import { mrrExpansionWorkflow } from './workflows/mrr-expansion-workflow'

export const mastra = new Mastra({
  agents: {
    docsAgent,
    stripeAgent
  },
  workflows: {
    mrrCalculationWorkflow,
    arpuCalculationWorkflow,
    activeSubscribersWorkflow,
    churnRateWorkflow,
    mrrExpansionWorkflow
  },
  mcpServers: {
    kepler: mcpServer
  },
  server: {
    port: parseInt(process.env.PORT || '4112', 10),
    timeout: 30000,
    // Add health check endpoint for deployment monitoring
    apiRoutes: [
      registerApiRoute('/health', {
        method: 'GET',
        handler: async (c) => {
          return c.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            services: {
              agents: ['docsAgent', 'stripeAgent'],
              workflows: [
                'mrrCalculationWorkflow',
                'arpuCalculationWorkflow',
                'activeSubscribersWorkflow',
                'churnRateWorkflow',
                'mrrExpansionWorkflow'
              ],
              mcp: {
                servers: ['localTools', 'stripe'],
                status: 'configured'
              }
            }
          })
        }
      }),
      registerApiRoute('/mcp/info', {
        method: 'GET',
        handler: async (c) => {
          return c.json({
            mcpServers: {
              localTools: {
                name: 'Local docs MCP Server',
                version: '1.0.0',
                availableTransports: ['http', 'sse'],
                endpoints: {
                  http:
                    process.env.MCP_SERVER_URL || 'http://localhost:4111/mcp'
                },
                availableTools: ['docsTool'],
                status: 'configured'
              },
              stripe: {
                name: 'Official Stripe MCP Server',
                version: '1.0.0',
                availableTransports: ['https'],
                endpoints: {
                  https: 'https://mcp.stripe.com'
                },
                availableTools: ['stripe_*'],
                status: 'configured',
                authRequired: true
              }
            },
            availableAgents: ['docsAgent', 'stripeAgent']
          })
        }
      })
    ]
  },
  logger: new PinoLogger({
    name: 'Mastra',
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
  })
})
