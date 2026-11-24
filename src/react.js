'use client';
import { createElement } from 'react';

/**
 * Renders content only for static Markdown extraction.
 * Stripped from the shipped HTML by `agent-readable build`, and returns null
 * during browser hydration so React matches the stripped DOM without errors.
 */
export function AgentOnly({ children, as = 'div' }) {
  if (typeof window !== 'undefined' || process.env.NODE_ENV !== 'production') return null;
  return createElement(as === 'span' ? 'span' : 'div', { 'data-agent-only': '', hidden: true }, children);
}
