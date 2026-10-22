'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'grid',
          placeItems: 'center',
          minHeight: '100dvh',
          margin: 0,
          padding: '1rem',
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: '28rem' }}>
          <h1 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
          <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>
            GymOS hit an unexpected error. Anything you had already saved is unaffected.
          </p>
          <button
            onClick={reset}
            style={{
              background: '#2563eb',
              color: '#fff',
              border: 0,
              borderRadius: '0.75rem',
              padding: '0.75rem 1.25rem',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
