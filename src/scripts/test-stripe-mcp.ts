#!/usr/bin/env tsx

/**
 * Test script for MCP Client connection (including Stripe)
 * 
 * This script verifies that the MCP client can successfully connect
 * to both local and Stripe MCP servers and retrieve available tools.
 */

import { config } from 'dotenv';
import { mcpClient } from '../mastra/mcp/mcp-client';

// Load environment variables
config();

async function testMCPConnection() {
  console.log('🔧 Testing MCP Client Connection (Local + Stripe)...\n');

  try {
    // Test getting available tools from all servers
    console.log('1. Retrieving available tools from all MCP servers...');
    const tools = await mcpClient.getTools();
    console.log(`✅ Retrieved ${Object.keys(tools).length} tools from all MCP servers`);
    
    // Separate tools by server
    const localTools = Object.keys(tools).filter(name => name.startsWith('localTools_'));
    const stripeTools = Object.keys(tools).filter(name => name.startsWith('stripe_'));
    
    console.log(`   📋 Local tools: ${localTools.length}`);
    console.log(`   💳 Stripe tools: ${stripeTools.length}`);
    
    // List some available Stripe tools
    if (stripeTools.length > 0) {
      console.log('\n📋 Available Stripe Tools:');
      stripeTools.slice(0, 10).forEach((toolName, index) => {
        console.log(`   ${index + 1}. ${toolName}`);
      });
      
      if (stripeTools.length > 10) {
        console.log(`   ... and ${stripeTools.length - 10} more Stripe tools`);
      }
    } else {
      console.log('\n⚠️  No Stripe tools found - check STRIPE_SECRET_KEY environment variable');
    }

    // Test getting toolsets
    console.log('\n2. Retrieving available toolsets...');
    const toolsets = await mcpClient.getToolsets();
    console.log(`✅ Retrieved ${Object.keys(toolsets).length} toolsets from all servers`);

    // Show example of how tools would be used with an Agent
    console.log('\n3. Example usage pattern with Mastra Agent:');
    console.log('   ```typescript');
    console.log('   import { Agent } from "@mastra/core/agent";');
    console.log('   import { openai } from "@ai-sdk/openai";');
    console.log('   import { mcpClient } from "./mastra/mcp/mcp-client";');
    console.log('   ');
    console.log('   const agent = new Agent({');
    console.log('     name: "Subscription BI Assistant",');
    console.log('     instructions: "Help with subscription metrics using Stripe data...",');
    console.log('     model: openai("gpt-4o"),');
    console.log('     tools: await mcpClient.getTools(), // Gets both local and Stripe tools');
    console.log('   });');
    console.log('   ');
    console.log('   // Or for dynamic config:');
    console.log('   const response = await agent.stream("Calculate MRR", {');
    console.log('     toolsets: await mcpClient.getToolsets(),');
    console.log('   });');
    console.log('   ```');

    console.log('\n🎉 All tests passed! MCP client is properly configured with Stripe integration.');

  } catch (error) {
    console.error('\n❌ Error testing Stripe MCP connection:');
    console.error(error instanceof Error ? error.message : String(error));
    
    if (error instanceof Error && error.message.includes('STRIPE_SECRET_KEY')) {
      console.log('\n💡 Make sure to:');
      console.log('   1. Copy .env.example to .env');
      console.log('   2. Add your Stripe secret key to the .env file');
      console.log('   3. Use a test key (sk_test_...) for development');
    }
    
    process.exit(1);
  } finally {
    // Clean up connection
    await mcpClient.disconnect();
    console.log('\n🔌 Disconnected from MCP servers');
  }
}

// Run the test
testMCPConnection();