// src/components/UrlTable.jsx
//
// Table of the user's URLs: Original URL | Short URL | Clicks | Created At | Delete.
// Purely presentational; the page owns the data and the delete action.
//
// Links use rel="noopener noreferrer". The backend only accepts http(s)
// long URLs, so a javascript: URL can't reach this href.

export default function UrlTable({ urls, onDelete, deletingId }) {
  if (urls.length === 0) {
    return <p className="muted">You haven't created any short URLs yet.</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Original URL</th>
            <th>Short URL</th>
            <th>Clicks</th>
            <th>Created At</th>
            <th>Delete</th>
          </tr>
        </thead>
        <tbody>
          {urls.map((url) => (
            <tr key={url.id}>
              <td className="long-url">
                <a href={url.longUrl} target="_blank" rel="noopener noreferrer" title={url.longUrl}>
                  {url.longUrl}
                </a>
              </td>
              <td>
                <a href={url.shortUrl} target="_blank" rel="noopener noreferrer">
                  {url.shortUrl}
                </a>
              </td>
              <td>{url.totalClicks}</td>
              <td>{new Date(url.createdAt).toLocaleString()}</td>
              <td>
                <button
                  type="button"
                  className="danger"
                  onClick={() => onDelete(url)}
                  disabled={deletingId === url.id}
                >
                  {deletingId === url.id ? 'Deleting...' : 'Delete'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
