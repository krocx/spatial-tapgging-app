// ErrorBoundary.tsx — turns render crashes into a readable message instead of
// a blank white page.
//
// Exists because of a real incident: a Rules-of-Hooks violation in Minimap
// (React #310) unmounted the entire tree the moment a first node was added,
// leaving users staring at a white screen with no clue the map had actually
// saved. With this boundary the same class of bug shows the error text and a
// reload button — reportable in one screenshot instead of a debugging session.

import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // Console keeps the stack for DevTools; the UI shows the message.
    console.error('[roadmap] render crash caught by ErrorBoundary:', error);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: '60vh', gap: 12, padding: 24,
        textAlign: 'center', fontFamily: 'system-ui, sans-serif',
      }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', color: '#0f172a' }}>
          Something went wrong rendering the canvas
        </h2>
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b', maxWidth: 480 }}>
          Your map is saved on the server — nothing is lost. Reload to continue.
          If this keeps happening, screenshot the message below and report it.
        </p>
        <code style={{
          fontSize: '0.75rem', color: '#991b1b', background: '#fef2f2',
          border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px',
          maxWidth: 560, overflowWrap: 'anywhere',
        }}>
          {this.state.error.message}
        </code>
        <button
          onClick={() => location.reload()}
          style={{
            marginTop: 4, padding: '8px 20px', fontSize: '0.85rem',
            background: '#2f6fed', color: '#fff', border: 'none',
            borderRadius: 8, cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
