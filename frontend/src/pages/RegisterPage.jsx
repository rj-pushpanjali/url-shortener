// src/pages/RegisterPage.jsx
//
// Name / Email / Password -> POST /auth/register. On success, go to the
// login page with a "created" notice (register doesn't issue a token).
// Browser validation (required, type=email, minLength) gives instant
// feedback; the backend re-validates and its message is shown on failure.

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ErrorMessage from '../components/ErrorMessage';
import { useAuth } from '../context/AuthContext';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await register(name, email, password);
      navigate('/login', { state: { notice: 'Account created. Please log in.' } });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <h1>Create account</h1>
      <form className="card" onSubmit={handleSubmit}>
        <label htmlFor="name">Name</label>
        <input id="name" type="text" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} required />

        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <p className="hint">At least 8 characters.</p>

        <ErrorMessage message={error} />

        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating...' : 'Register'}
        </button>
      </form>
      <p className="muted">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </main>
  );
}
