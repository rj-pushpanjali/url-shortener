// src/components/UrlForm.jsx
//
// "Enter long URL" form. On success it shows the new short URL with a
// Copy button and tells the parent (so the table can add the new row).
// The result box is hidden again once that URL is no longer in `urls`
// (for example after it is deleted), so a dead link is never shown.

import { useState } from 'react';
import { createShortUrl } from '../services/urlService';
import CopyButton from './CopyButton';
import ErrorMessage from './ErrorMessage';

export default function UrlForm({ onCreated, urls = [] }) {
  const [longUrl, setLongUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);

  const showCreated = created && urls.some((u) => u.id === created.id);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const response = await createShortUrl(longUrl.trim());
      setCreated(response.data);
      setLongUrl('');
      onCreated(response.data);
    } catch (err) {
      setCreated(null);
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card">
      <form onSubmit={handleSubmit}>
        <label htmlFor="longUrl">Enter long URL:</label>
        <input
          id="longUrl"
          type="url"
          placeholder="https://example.com/a-very-long-url"
          value={longUrl}
          onChange={(e) => setLongUrl(e.target.value)}
          required
        />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Shortening...' : 'Shorten URL'}
        </button>
      </form>

      <ErrorMessage message={error} />

      {showCreated && (
        <div className="result">
          <strong>Short URL:</strong>
          <div className="result-row">
            <a href={created.shortUrl} target="_blank" rel="noopener noreferrer">
              {created.shortUrl}
            </a>
            <CopyButton text={created.shortUrl} />
          </div>
        </div>
      )}
    </section>
  );
}