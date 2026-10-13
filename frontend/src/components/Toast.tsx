// Transient confirmations ("Saved", "Review started") in the corner, announced to screen readers.
// An optional action lets the user jump straight to what just happened.
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

type Tone = "ok" | "error" | "info";
interface Toast {
  id: number;
  text: string;
  tone: Tone;
  link?: { to: string; label: string };
}

const ToastContext = createContext<(text: string, opts?: { tone?: Tone; link?: Toast["link"] }) => void>(() => {});

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (text: string, opts: { tone?: Tone; link?: Toast["link"] } = {}) => {
      const id = nextId++;
      setToasts((all) => [...all.slice(-3), { id, text, tone: opts.tone ?? "ok", link: opts.link }]);
      window.setTimeout(() => dismiss(id), opts.tone === "error" ? 8000 : 4500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <span>{t.text}</span>
            {t.link && (
              <Link to={t.link.to} onClick={() => dismiss(t.id)}>
                {t.link.label}
              </Link>
            )}
            <button className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
