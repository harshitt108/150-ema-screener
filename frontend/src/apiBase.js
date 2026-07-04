// Single source of truth for the backend URL.
//  - vite dev server:      talk to the local FastAPI on :8000
//  - production build:     same origin ('' → relative /api/... paths); the
//                          FastAPI app serves the built frontend itself
//  - either can be overridden at build time with VITE_API_BASE
export const API_BASE =
  import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? 'http://localhost:8000' : '')
