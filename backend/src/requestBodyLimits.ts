import express, { type Express } from 'express';

// Only these endpoints receive scans or bulk uploads encoded in JSON.
export const LARGE_BODY_PATHS = [
  '/api/icr/check-quality',
  '/api/icr/evaluate-cloud',
  '/api/icr/evaluate-bulk',
  '/api/students/bulk-import',
];

export function applyRequestBodyLimits(app: Express): void {
  // Register the larger parser on the exact upload POST routes. Once it has
  // consumed a JSON body, the 1 MB parser below skips that request.
  app.post(LARGE_BODY_PATHS, express.json({ limit: '100mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ limit: '1mb', extended: true }));
}
