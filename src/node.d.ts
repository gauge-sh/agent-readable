import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MarkdownHandlerOptions } from './runtime.js';

export type * from './runtime.js';

export interface NodeMarkdownHandlerOptions extends MarkdownHandlerOptions {
  origin: string;
}

export type NodeRequestListener = (req: IncomingMessage, res: ServerResponse) => unknown;

/** Wrap an existing Node HTTP handler without replacing its routes or APIs. */
export function createNodeMarkdownHandler(
  options: NodeMarkdownHandlerOptions,
  next: NodeRequestListener,
): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
