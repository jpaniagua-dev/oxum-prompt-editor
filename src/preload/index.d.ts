import type { RendererApi } from '../shared/contracts.js';

declare global {
  interface Window {
    readonly api: RendererApi;
  }
}

export {};
