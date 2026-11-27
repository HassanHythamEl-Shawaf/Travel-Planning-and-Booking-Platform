"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

interface ToastMessage {
  id: number;
  message: string;
  kind: "success" | "error";
}

interface ToastContextValue {
  showToast: (message: string, kind?: ToastMessage["kind"]) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback(
    (message: string, kind: ToastMessage["kind"] = "success") => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, message, kind }]);
      window.setTimeout(
        () => setToasts((current) => current.filter((toast) => toast.id !== id)),
        4500,
      );
    },
    [],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div
            className={`toast toast-${toast.kind}`}
            key={toast.id}
            role={toast.kind === "error" ? "alert" : "status"}
          >
            <span className="toast-dot" aria-hidden="true" />
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}

export function ToastFromQuery({
  value,
}: {
  value?: string;
}) {
  const { showToast } = useToast();

  useEffect(() => {
    if (value) showToast(value);
  }, [showToast, value]);

  return null;
}
