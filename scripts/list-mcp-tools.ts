#!/usr/bin/env tsx
/**
 * List MCP-shaped incident tools (for docs / agent wiring).
 */
import { getIncidentMcpTools } from "../src/mcp/tools.js";

const tools = getIncidentMcpTools();
console.log(JSON.stringify(tools, null, 2));
console.log(`\n${tools.length} tools — PolicyEngine still gates every write.`);
