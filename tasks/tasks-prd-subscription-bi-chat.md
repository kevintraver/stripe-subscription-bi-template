## Relevant Files

- `src/agents/subscription-bi-agent.ts` - Main conversational agent for subscription business intelligence queries
- `src/agents/subscription-bi-agent.test.ts` - Unit tests for the subscription BI agent
- `src/tools/stripe-mrr-tool.ts` - Tool for calculating Monthly Recurring Revenue from Stripe data
- `src/tools/stripe-mrr-tool.test.ts` - Unit tests for MRR calculation tool
- `src/tools/stripe-arpu-tool.ts` - Tool for calculating Average Revenue Per User
- `src/tools/stripe-arpu-tool.test.ts` - Unit tests for ARPU calculation tool
- `src/tools/stripe-churn-tool.ts` - Tool for calculating customer and revenue churn rates
- `src/tools/stripe-churn-tool.test.ts` - Unit tests for churn calculation tool
- `src/tools/stripe-ltv-tool.ts` - Tool for calculating Customer Lifetime Value
- `src/tools/stripe-ltv-tool.test.ts` - Unit tests for LTV calculation tool
- `src/tools/stripe-subscriber-count-tool.ts` - Tool for counting active subscribers
- `src/tools/stripe-subscriber-count-tool.test.ts` - Unit tests for subscriber count tool
- `src/mastra/mcp/mcp-client.ts` - Updated MCP client configuration to include both local and Stripe MCP server connections
- `src/scripts/test-stripe-mcp.ts` - Test script for verifying MCP client connection to both local and Stripe servers
- `src/utils/subscription-calculations.ts` - Utility functions for subscription metric calculations
- `src/utils/subscription-calculations.test.ts` - Unit tests for calculation utilities
- `src/schemas/subscription-metrics.ts` - Zod schemas for input/output validation of subscription tools
- `src/types/subscription-types.ts` - TypeScript type definitions for subscription data structures

### Notes

- Unit tests should typically be placed alongside the code files they are testing (e.g., `MyComponent.tsx` and `MyComponent.test.tsx` in the same directory).
- Use `npx jest [optional/path/to/test/file]` to run tests. Running without a path executes all tests found by the Jest configuration.

## Tasks

- [ ] 1.0 Set up Stripe MCP Integration Infrastructure
  - [x] 1.1 Install and configure Mastra MCPClient for Stripe MCP server connection
  - [ ] 1.2 Create Stripe MCP client service with proper authentication handling and API key management
  - [ ] 1.3 Implement rate limiting and retry logic for Stripe API calls to handle API limits gracefully
  - [ ] 1.4 Set up error handling for connection failures and API timeouts with user-friendly error messages
  - [ ] 1.5 Implement session-level caching strategy for Stripe data to avoid redundant API calls within conversations
  - [ ] 1.6 Create utility functions for Stripe data transformation (status filtering, currency conversion, billing period normalization)

- [ ] 2.0 Implement Core Subscription Metric Calculation Tools
  - [ ] 2.1 Create MRR calculation tool with Zod schema validation for summing active subscription amounts and normalizing billing periods
  - [ ] 2.2 Implement Active Subscribers count tool to identify unique customers with active subscription status
  - [ ] 2.3 Build ARPU calculation tool that divides current MRR by active subscriber count with dependency on MRR tool
  - [ ] 2.4 Develop Customer Churn Rate tool to calculate percentage of customers who canceled in current month
  - [ ] 2.5 Create Revenue Churn Rate tool to measure MRR lost to cancellations as percentage of starting period MRR
  - [ ] 2.6 Implement LTV calculation tool using ARPU ÷ Churn Rate formula with dependencies on both prerequisite tools
  - [ ] 2.7 Build MRR Expansion tool to calculate revenue from subscription upgrades and plan changes to higher tiers
  - [ ] 2.8 Create MRR Contraction tool to measure revenue lost from downgrades and plan changes to lower tiers
  - [ ] 2.9 Implement Average Subscription Duration tool for churned customers using start/end date analysis
  - [ ] 2.10 Build Revenue at Risk tool to identify subscriptions with upcoming expirations or payment failures

- [ ] 3.0 Develop Conversational Agent with Business Intelligence Context
  - [ ] 3.1 Create Mastra Agent class instance with specialized system instructions for subscription business intelligence
  - [ ] 3.2 Configure agent with comprehensive tool access to all subscription calculation tools
  - [ ] 3.3 Design natural language interpretation logic for common BI queries ("What's our MRR?", "How many customers churned?")
  - [ ] 3.4 Implement explanation generation for calculation methodologies when users ask "How did you calculate that?"
  - [ ] 3.5 Add metric definition responses for educational queries ("What is MRR?", "What does churn rate mean?")
  - [ ] 3.6 Configure conversational flow to guide users from basic metrics to more complex calculations
  - [ ] 3.7 Implement follow-up question handling to maintain context about previously calculated metrics

- [ ] 4.0 Implement Tool Orchestration and Dependency Management
  - [ ] 4.1 Create dependency resolution system to automatically call prerequisite tools (MRR before ARPU, ARPU before LTV)
  - [ ] 4.2 Implement intelligent tool selection logic based on user queries and available cached results
  - [ ] 4.3 Set up conversation context preservation using Mastra's RuntimeContext for dynamic configuration
  - [ ] 4.4 Create tool result caching mechanism to avoid recalculating metrics within the same conversation session
  - [ ] 4.5 Implement error propagation system that converts technical MCP server failures to user-friendly messages
  - [ ] 4.6 Design tool output formatting to include both numeric results and human-readable explanations

- [ ] 5.0 Create Testing Suite and Validation Framework
  - [ ] 5.1 Write unit tests for each individual subscription calculation tool with mock Stripe data
  - [ ] 5.2 Create integration tests for Stripe MCP client with proper API mocking and error scenario testing
  - [ ] 5.3 Implement accuracy validation tests that compare calculated metrics against known Stripe dashboard values
  - [ ] 5.4 Build agent conversation testing framework to validate natural language interpretation and responses
  - [ ] 5.5 Create dependency orchestration tests to ensure tools call prerequisites in correct order
  - [ ] 5.6 Implement performance tests to validate sub-5 second response time requirement for metric calculations
  - [ ] 5.7 Design error handling tests for various failure scenarios (API timeouts, invalid data, partial failures)