import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const EnvSchema = z.object({
  KEEPERHUB_API_KEY: z.string().optional().default(""),
  KEEPERHUB_API_URL: z.string().url().default("https://app.keeperhub.com"),
  KEEPERHUB_MCP_URL: z.string().url().default("https://app.keeperhub.com/mcp"),
  RPC_URL: z.string().min(1).default("https://ethereum-sepolia-rpc.publicnode.com"),
  CHAIN_ID: z.coerce.number().default(11155111),
  NETWORK: z.string().default("sepolia"),
  WALLET_ADDRESS: z.string().optional().default(""),
  BLOCKSCOUT_MCP_URL: z
    .string()
    .url()
    .optional()
    .default("https://mcp.blockscout.com/mcp"),
  BLOCKSCOUT_API_URL: z
    .string()
    .default("https://eth-sepolia.blockscout.com/api"),
  TARGET_CONTRACT_ADDRESS: z.string().optional().default(""),
  TARGET_ORACLE_ADDRESS: z.string().optional().default(""),
  ACTION_LOG_ADDRESS: z.string().optional().default(""),
  AGENT_VERSION: z.string().default("0.1.0"),
  POLICY_VERSION: z.string().default("0.1.0"),
  WORKFLOW_ID: z.string().optional().default(""),
  WORKFLOW_VERSION: z.string().default("1"),
  EVIDENCE_STORE_PATH: z.string().default("./data/evidence.jsonl"),
  APPROVAL_QUEUE_PATH: z.string().default("./data/approvals.jsonl"),
  PORT: z.coerce.number().int().positive().max(65535).default(3847),
  PROOFOPS_OPERATOR_TOKEN: z.string().optional().default(""),
  PROOFOPS_ALLOWED_ORIGIN: z.string().optional().default(""),
  INJECT_FAILURE_MODE: z.string().optional().default(""),
  X402_ENABLED: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  X402_PRICE_USDC: z.string().optional().default("0.10"),
});

export type AppEnv = z.infer<typeof EnvSchema>;

export const env: AppEnv = EnvSchema.parse(process.env);

export function requireEnv(keys: (keyof AppEnv)[]): void {
  const missing: string[] = [];
  for (const key of keys) {
    const value = env[key];
    if (value === undefined || value === null || value === "") {
      missing.push(String(key));
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Copy .env.example → .env and fill values. Never paste secrets into chat.`,
    );
  }
}

export function redactSecrets(text: string): string {
  return text
    .replace(/kh_[A-Za-z0-9_\-]+/g, "kh_***REDACTED***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***REDACTED***");
}
