export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
  appEnv: import.meta.env.VITE_APP_ENV ?? (import.meta.env.PROD ? 'production' : 'development'),
  version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
  commit: typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'dev',
  builtAt: typeof __APP_BUILT_AT__ === 'string' ? __APP_BUILT_AT__ : '',
} as const;

export const isConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
