import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.string().default("info"),

  PGHOST: z.string().default("127.0.0.1"),
  PGPORT: z.coerce.number().int().default(55432),
  PGDATABASE: z.string().default("salvionix"),
  CORE_API_PASSWORD: z.string().min(16),

  PGRST_JWT_SECRET: z.string().min(32),
  POSTGREST_URL: z.url().default("http://127.0.0.1:55300"),

  CONVERSATION_TOKEN_SECRET: z.string().min(32),
  BOT_HMAC_SECRET: z.string().min(32),

  WAHA_BASE_URL: z.url().default("http://127.0.0.1:3100"),
  WAHA_API_KEY: z.string().optional(),
  OUTBOX_PACE_MIN_MS: z.coerce.number().int().min(0).default(2000),
  OUTBOX_PACE_MAX_MS: z.coerce.number().int().min(0).default(5000),

  // Gotenberg turns the HTML templates into PDFs. It is a separate container on the internal network.
  GOTENBERG_URL: z.url().default("http://127.0.0.1:53000"),
  // Private folder for the PDFs, outside any web root. Relative paths are resolved from the working directory.
  DOCUMENTS_DIR: z.string().min(1).default("./.data/documents"),
  // Where the document templates and settings.json are read from. Unset: the templates folder of this repository.
  TEMPLATES_DIR: z.string().min(1).optional(),

  // Development only. Production authenticates the panel with Cloudflare Access (CRM-T3).
  ADMIN_DEV_SUB: z.uuid().optional(),
  ADMIN_ALLOWED_ORIGINS: z.string().default("http://127.0.0.1:5173,http://localhost:5173"),
});

export type Config = z.infer<typeof schema>;

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Names only: a value, even a wrong one, may be a secret.
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid configuration: ${names.join(", ")}`);
  }
  return parsed.data;
};

/** Secrets of channels and bots are looked up by the name stored in the database. */
export const namedSecret = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(name)) return undefined;
  const value = env[name];
  return value && value.length >= 16 ? value : undefined;
};

export const botUrl = (env: NodeJS.ProcessEnv, botKey: string): string | undefined => {
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(botKey)) return undefined;
  return env[`BOT_URL_${botKey.toUpperCase()}`];
};
