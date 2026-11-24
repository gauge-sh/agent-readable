import type { Server } from 'node:http';
import type { NodeMarkdownHandlerOptions, NodeRequestListener } from './node.js';

export type { NodeMarkdownHandlerOptions, NodeRequestListener };

export interface NextAppLike {
  prepare(): Promise<void>;
  getRequestHandler(): NodeRequestListener;
}

/** Prepare a Next application and return an unbound Node HTTP server. */
export function createNextMarkdownServer(
  app: NextAppLike,
  options: NodeMarkdownHandlerOptions,
): Promise<Server>;
