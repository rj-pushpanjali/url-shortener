// src/components/ErrorMessage.jsx
//
// Shows a validation/API error. Renders nothing when there is no error.
// role="alert" makes screen readers announce it.

export default function ErrorMessage({ message }) {
  if (!message) return null;
  return (
    <p className="message error" role="alert">
      {message}
    </p>
  );
}
