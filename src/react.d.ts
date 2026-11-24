import type { ReactNode } from 'react';

/**
 * Renders content only for static Markdown extraction.
 * Stripped from the shipped HTML by `agent-readable build`, and returns null
 * during browser hydration so React matches the stripped DOM without errors.
 */
export function AgentOnly(props: { children?: ReactNode; as?: 'div' | 'span' }): ReactNode;
