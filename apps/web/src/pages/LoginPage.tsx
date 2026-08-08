import { type FormEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { defaultRouteForRole } from "../auth/authorization";

export function LoginPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!code || submittingRef.current) return;
    submittingRef.current = true;
    setError("");
    setIsSubmitting(true);
    try {
      const role = await login(code);
      navigate(defaultRouteForRole(role), { replace: true });
    } catch (error) {
      setError((error as { status?: number }).status === 401
        ? "That access code isn’t valid."
        : "Couldn’t sign in. Check your signal and try again.");
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-mark" aria-hidden="true">D</div>
      <div className="login-copy">
        <p className="eyebrow">DiveLine · Staff access</p>
        <h1>Ready at the door?</h1>
        <p>Enter tonight’s access code to open the guest check-in tools.</p>
      </div>
      <form className="login-form" onSubmit={handleSubmit}>
        <label htmlFor="access-code">Access code</label>
        <input
          id="access-code"
          type="password"
          inputMode="text"
          autoComplete="current-password"
          placeholder="Enter access code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setError("");
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "login-error" : undefined}
          autoFocus
        />
        {error && <p id="login-error" className="form-error" role="alert">{error}</p>}
        <button className="button button-primary" type="submit" disabled={!code || isSubmitting}>
          {isSubmitting ? "Signing in…" : "Enter"} {!isSubmitting && <span aria-hidden="true">→</span>}
        </button>
      </form>
      <p className="access-note">Authorized event staff only</p>
    </main>
  );
}
