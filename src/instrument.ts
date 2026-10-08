import * as Sentry from '@sentry/nestjs';
import { config as dotEnvConfig } from 'dotenv';

// Loaded before anything else in `main.ts`: Sentry has to patch Node and Nest
// before they are first required, so env has to be read here as well.
dotEnvConfig();

// Errors plus tracing. Without SENTRY_DSN the SDK stays off, so local runs
// without a Sentry account behave as before.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  // Every transaction locally, 10 % in production to stay within quota.
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
});
