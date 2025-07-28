# PRD: Subscription Business Intelligence Chat System

## Introduction/Overview

This feature enables SaaS business owners to obtain subscription business intelligence metrics through natural language conversations via [Mastra.ai](http://Mastra.ai)'s chat interface. The system calculates key subscription metrics from Stripe data on-demand, providing accurate insights about Monthly Recurring Revenue (MRR), customer metrics, and churn analysis for the current month period.

The primary problem this solves is the need for non-technical business stakeholders to quickly access and understand subscription performance data without building complex dashboards or writing SQL queries.

## Goals

1. **Provide accurate subscription metrics calculation** from Stripe API data using natural language queries
2. **Enable dependency-based metric calculation** starting with foundational metrics (MRR) and building to complex metrics (LTV)
3. **Deliver insights through conversational AI** that can explain calculations and provide context
4. **Support current month analysis** for immediate business decision-making
5. **Integrate seamlessly with Stripe** using the official MCP server for reliable data access

## User Stories

1. **As a product manager**, I want to ask "What's our current MRR?" and get an accurate calculation with explanation, so that I can quickly assess revenue performance.
2. **As a sales team member**, I want to ask "How many active subscribers do we have?" and understand growth trends, so that I can set realistic targets.
3. **As a finance team member**, I want to ask "What's our customer churn rate this month?" and get detailed breakdown, so that I can report on business health.
4. **As a SaaS owner**, I want to ask "What's our customer lifetime value?" and understand how it's calculated, so that I can make informed acquisition decisions.
5. **As any business stakeholder**, I want to ask follow-up questions about metrics like "How did you calculate that?" so that I can understand the methodology.

## Functional Requirements

### Core Metric Calculations (Priority Order)

1. **The system must calculate Monthly Recurring Revenue (MRR)** by summing all active subscription amounts and normalizing non-monthly billing periods to monthly values.
2. **The system must count Active Subscribers** by identifying unique customers with at least one active subscription status.
3. **The system must calculate Average Revenue Per User (ARPU)** by dividing current MRR by the number of active subscribers.
4. **The system must calculate Customer Churn Rate** by determining the percentage of customers who canceled subscriptions in the current month.
5. **The system must calculate Revenue Churn Rate** by measuring MRR lost to cancellations as a percentage of starting period MRR.
6. **The system must calculate Customer Lifetime Value (LTV)** using the formula: ARPU ÷ Churn Rate.
7. **The system must calculate MRR Expansion** from subscription upgrades and plan changes to higher-value tiers.
8. **The system must calculate MRR Contraction** from subscription downgrades and plan changes to lower-value tiers.
9. **The system must calculate Average Subscription Duration** for churned customers by analyzing subscription start and end dates.
10. **The system must identify Revenue at Risk** by analyzing subscriptions with upcoming expirations or payment failures.

### Integration Requirements

1. **The system must use the official Stripe MCP server** for all Stripe API interactions via Mastra's `MCPClient`.
2. **The system must implement calculation logic as Mastra tools** using `createTool` with proper input/output schemas and validation.
3. **The system must provide a conversational agent** using Mastra's `Agent` class that can access subscription calculation tools and explain results.
4. **The system must handle dependency-based calculations** by orchestrating tool calls in the correct order (MRR → ARPU → LTV).
5. **The system must handle Stripe API rate limits** and implement appropriate error handling for failed requests.
6. **The system must use Mastra's RuntimeContext** for passing dynamic configuration (API keys, user context) to calculation tools.

### Natural Language Interface Requirements

1. **The system must interpret natural language queries** for subscription metrics (e.g., "What's our MRR?", "How many customers churned?").
2. **The system must provide explanations of calculations** when requested, showing the formula and data sources used.
3. **The system must handle follow-up questions** and maintain conversation context about previously calculated metrics.
4. **The system must provide metric definitions** when users ask "What is MRR?" or similar definitional questions.

### Data Processing Requirements

1. **The system must process current month data only** unless specifically asked for comparison periods.

### Mastra Architecture Requirements

1. **The system must implement a subscription BI agent** with clear instructions for interpreting business intelligence queries and selecting appropriate calculation tools.
2. **The system must create individual tools for each metric** (MRR Tool, ARPU Tool, Churn Tool, etc.) with proper Zod schemas and descriptions.
3. **The system must implement tool orchestration logic** that automatically calls dependent metrics when needed (e.g., ARPU tool calls MRR tool if not already available).
4. **The system must provide tool result explanations** that include both numeric results and methodology descriptions for business users.
5. **The system must handle conversational context** to allow follow-up questions about previously calculated metrics without recalculation.
6. **The system must implement proper error propagation** from MCP server failures to user-friendly error messages in the chat interface.

## Non-Goals (Out of Scope)

1. **Historical trend analysis** beyond current month comparisons
2. **Predictive analytics or forecasting** of future subscription performance
3. **Subscription management capabilities** (creating, modifying, or canceling subscriptions)
4. **Customer communication features** or direct customer interaction
5. **Payment processing functionality** or transaction management
6. **Dashboard or visualization interface** - only chat-based interaction
7. **Multi-tenant or workspace management** - single Stripe account per implementation
8. **Real-time streaming updates** - calculations only on-demand
9. **Data export or reporting features** beyond conversational responses

## Design Considerations

- **Agent Instructions**: Design clear system instructions that help the agent understand subscription business terminology and when to use each calculation tool
- **Tool Descriptions**: Write tool descriptions that clearly explain when each metric should be calculated and any prerequisites
- **Conversational Flow**: Design natural conversation patterns that guide users from basic metrics to more complex calculations
- **Error Handling**: Provide clear, non-technical error messages when Stripe data is unavailable or incomplete
- **Response Format**: Structure tool outputs and agent responses to include the metric value, brief explanation, and offer to explain calculation methodology
- **Context Preservation**: Utilize Mastra's conversation context to reference previously calculated metrics without redundant calculations
- **Tool Integration**: Ensure smooth integration between MCP server data retrieval and Mastra tool execution

## Technical Considerations

- **Mastra Agent Architecture**: Configure a conversational agent using `Agent` class with appropriate instructions for business intelligence context
- **Stripe MCP Integration**: Use `MCPClient` to connect to the official Stripe MCP server with proper authentication and error handling
- **Tool Design**: Structure each metric calculation as a separate Mastra tool using `createTool` with:
    - Zod schemas for input/output validation
    - Clear descriptions for agent understanding
    - Proper error handling and data validation
- **Dependency Management**: Implement tool orchestration to respect calculation dependencies (MRR before ARPU, ARPU before LTV)
- **Data Transformation**: Handle subscription status filtering, billing period normalization, and currency conversion within tools
- **Context Passing**: Use `RuntimeContext` for dynamic configuration like API credentials or user-specific settings
- **Caching Strategy**: Implement session-level caching for Stripe data to avoid redundant API calls within conversation
- **Response Formatting**: Design tool outputs to include both calculated values and human-readable explanations

## Success Metrics

1. **Calculation Accuracy**: 100% accuracy for MRR calculations compared to Stripe dashboard values
2. **Response Time**: Sub-5 second response time for metric calculations
3. **User Comprehension**: Users can successfully interpret and use calculated metrics for business decisions
4. **Error Rate**: Less than 5% error rate for Stripe API integration issues
5. **Conversation Completion**: 90% of metric requests result in successful calculation and explanation

## Open Questions

1. **Free Trial Handling**: Should free trial subscriptions be included in active subscriber counts but excluded from MRR?
2. **Partial Month Calculations**: For mid-month implementations, should churn rates be annualized or calculated for partial period?
3. **Multiple Plans per Customer**: How should customers with multiple active subscriptions be handled in ARPU calculations?
4. **Currency Handling**: Should multi-currency subscriptions be converted to a base currency for MRR calculations?
5. **Dunning Management**: Should subscriptions in dunning (past due) status be considered active for MRR purposes?
6. **Proration Handling**: How should mid-month subscription changes affect MRR expansion/contraction calculations?
7. **Tool Memory**: Should calculation results be cached in agent memory for the conversation session, or recalculated on each request?
8. **Agent Instructions**: What level of business intelligence context should be included in the agent's system instructions?
9. **Tool Granularity**: Should complex metrics like LTV be single tools or composed of multiple smaller tools for better transparency?
10. **Error Recovery**: How should the agent handle partial failures when some Stripe data is unavailable but other calculations can proceed?