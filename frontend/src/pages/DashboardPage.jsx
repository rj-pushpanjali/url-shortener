// src/pages/DashboardPage.jsx
//
// The only authenticated page: create a short URL, see your URLs with
// click counts, delete one, log out. It owns the URL list state and passes
// pieces down to the presentational components.
//
// Click counts change on the server whenever someone opens a short link, in
// another tab or on another device, and the page can't know that. So the list
// is re-fetched quietly (no spinner, no error flash) when you come back to
// this tab, every POLL_MS while the tab is visible, and on demand with the
// Refresh button. A click is counted by the worker within a moment of the
// redirect, so the next refresh shows it.

const POLL_MS = 5000;

import { useCallback, useEffect, useRef, useState } from 'react';
import ErrorMessage from '../components/ErrorMessage';
import UrlForm from '../components/UrlForm';
import UrlTable from '../components/UrlTable';
import { useAuth } from '../context/AuthContext';
import { deleteUrl, fetchMyUrls } from '../services/urlService';

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [urls, setUrls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const deletingRef = useRef(null);
  deletingRef.current = deletingId;

  const loadUrls = useCallback(async () => {
    setError('');
    try {
      const response = await fetchMyUrls();
      setUrls(response.data);
    } catch (err) {
      // A 401 already logged us out via the central handler; the
      // ProtectedRoute redirect takes over, so just show other errors.
      if (err.status !== 401) setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUrls();
  }, [loadUrls]);

  // Quiet refresh: keeps the table as it is on failure and skips while a
  // delete is in flight (so a stale response can't bring a deleted row back).
  const refreshQuietly = useCallback(async () => {
    if (deletingRef.current !== null) return;
    try {
      const response = await fetchMyUrls();
      if (deletingRef.current === null) setUrls(response.data);
    } catch {
      // Ignore: the next tick retries, and a 401 is handled centrally.
    }
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshQuietly();
    };
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refreshQuietly();
    }, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refreshQuietly]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadUrls();
    setRefreshing(false);
  }

  // The create response has no click data yet, so a new URL starts at 0.
  function handleCreated(newUrl) {
    setUrls((current) => [{ ...newUrl, totalClicks: 0 }, ...current]);
  }

  async function handleDelete(url) {
    if (!window.confirm(`Delete ${url.shortUrl}? It will stop redirecting immediately.`)) return;
    setError('');
    setDeletingId(url.id);
    try {
      await deleteUrl(url.id);
      setUrls((current) => current.filter((u) => u.id !== url.id));
    } catch (err) {
      if (err.status !== 401) setError(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="dashboard">
      <header className="topbar">
        <h1>URL Shortener</h1>
        <div className="topbar-right">
          {user?.name && <span className="muted">{user.name}</span>}
          <button type="button" className="secondary" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      <UrlForm onCreated={handleCreated} urls={urls} />

      <section>
        <div className="section-head">
          <h2>Your URLs</h2>
          <button type="button" className="secondary" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <ErrorMessage message={error} />
        {loading ? <p className="muted">Loading...</p> : <UrlTable urls={urls} onDelete={handleDelete} deletingId={deletingId} />}
      </section>
    </main>
  );
}