import { Agent } from '@mastra/core/agent'
import { openai } from '@ai-sdk/openai'
import { mcpClient } from '../mcp/mcp-client.js'
import { activeSubscribersWorkflow } from '../workflows/active-subscribers-workflow.js'

export const stripeAgent = new Agent({
  name: 'stripe-subscription-agent',
  description:
    'Fetches and analyzes Stripe subscription data for business intelligence calculations',
  instructions: `You are a Stripe subscription data analyst. Use stripe_list_subscriptions tool to fetch subscription data with appropriate parameters (limit, status, currency). Return raw data exactly as received from Stripe API. For detailed analysis, use the activeSubscribersWorkflow.`,

  model: openai('gpt-4o-mini'), // Faster and cheaper than gpt-4.1
  tools: await mcpClient.getTools(),
  workflows: {
    activeSubscribersWorkflow
  }
})
