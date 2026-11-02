"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestCode, verifyCode } from "@/lib/actions";
import { formatPhone, normalizePhone } from "@/lib/phone";

export function SignIn({ slug }: { slug: string }) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pretty = normalizePhone(phone);

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await requestCode(slug, phone);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDevCode(result.devCode ?? null);
    setStep("code");
  }

  async function checkCode(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await verifyCode(slug, phone, code);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="stack">
      <h1>Sign in</h1>
      {step === "phone" ? (
        <form className="stack" onSubmit={sendCode}>
          {error && (
            <p className="banner-error" role="alert">
              {error}
            </p>
          )}
          <label className="field">
            Mobile number
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <button className="button primary" disabled={pending}>
            {pending ? "Sending…" : "Text me a code"}
          </button>
        </form>
      ) : (
        <form className="stack" onSubmit={checkCode}>
          {error && (
            <p className="banner-error" role="alert">
              {error}
            </p>
          )}
          <p>Code for {pretty ? formatPhone(pretty) : phone}</p>
          {devCode && (
            <p className="dev-code">
              Texting isn't turned on yet, so here is your code.
              <strong>{devCode}</strong>
            </p>
          )}
          <label className="field">
            6-digit code
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <button className="button primary" disabled={pending}>
            {pending ? "Checking…" : "Continue"}
          </button>
          <button
            className="button ghost"
            type="button"
            onClick={() => {
              setStep("phone");
              setCode("");
              setError(null);
              setDevCode(null);
            }}
          >
            Use a different number
          </button>
        </form>
      )}
    </div>
  );
}
