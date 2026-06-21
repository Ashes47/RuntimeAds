import { useEffect, useState } from "react";

import type { DashboardMessage, DashboardViewState } from "./types";

declare function acquireVsCodeApi(): {
  postMessage(message: DashboardMessage): void;
};

const vscode = acquireVsCodeApi();

function formatAuthStatus(status: string): string {
  switch (status) {
    case "authenticated":
      return "Signed in";
    case "unauthenticated":
      return "Not signed in";
    default:
      return status;
  }
}

function formatHealth(health: string): string {
  switch (health) {
    case "healthy":
      return "Working";
    case "degraded":
      return "Needs attention";
    case "unhealthy":
      return "Not working";
    default:
      return health;
  }
}

function formatRelativeTime(iso: string | undefined): string {
  if (!iso || iso === "never" || iso === "not started") {
    return iso ?? "never";
  }
  return iso;
}

export function App({ initialState }: { initialState: DashboardViewState }) {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    const handler = (event: MessageEvent<DashboardMessage>) => {
      if (event.data.type === "state") {
        setState(event.data.state);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const { status, developerId, logoUri } = state;
  const signedIn = status.authStatus === "authenticated";

  return (
    <main className="dashboard">
      <header>
        <div className="brand">
          {logoUri ? <img className="brand-logo" src={logoUri} alt="RuntimeAds logo" /> : null}
          <div>
            <h1>RuntimeAds</h1>
            <p>Your account — connection, activity, and privacy</p>
          </div>
        </div>
      </header>

      <section>
        <h2>Account</h2>
        <dl>
          <Row label="Sign-in status" value={formatAuthStatus(status.authStatus)} />
          {signedIn && developerId ? <Row label="Account ID" value={developerId} mono /> : null}
          <Row
            label="Device ID"
            value={status.installId ?? "pending"}
            mono
            hint="Use this ID if you contact support"
          />
        </dl>
      </section>

      <section>
        <h2>Connection</h2>
        <dl>
          <Row label="Status" value={formatHealth(status.health)} />
          <Row label="Last synced" value={formatRelativeTime(status.lastSyncAt ?? "never")} />
          {status.lastError && status.lastError !== "none" ? (
            <Row label="Last issue" value={status.lastError} />
          ) : null}
        </dl>
        {!signedIn ? (
          <p className="hint">
            Sign in with <strong>RuntimeAds: Sign In</strong> to start earning.
          </p>
        ) : null}
      </section>

      {status.signals ? (
        <section>
          <h2>Activity</h2>
          <p className="section-intro">
            RuntimeAds detects when Claude or Codex is waiting and shows sponsor ads during that
            time.
          </p>
          <dl>
            <Row label="Wait sessions detected" value={String(status.signals.signalsGenerated)} />
            <Row label="Currently waiting" value={String(status.signals.activeSessions)} />
          </dl>
          {status.signals.signalsGenerated === 0 ? (
            <p className="hint">
              No wait time detected yet. Use Claude or Codex and we'll detect when it's waiting. If
              nothing shows up, re-run <strong>RuntimeAds: Set Up Claude & Codex</strong>.
            </p>
          ) : null}
        </section>
      ) : null}

      <section>
        <h2>Privacy</h2>
        <p>
          RuntimeAds never collects prompts, AI responses, code, terminal output, file paths, or
          repository names. Only wait-time and ad display events are sent to credit your account.
        </p>
      </section>

      <button
        type="button"
        onClick={() => {
          vscode.postMessage({ type: "openDiagnostics" });
        }}
      >
        Troubleshooting &amp; details
      </button>
    </main>
  );
}

function Row({
  label,
  value,
  mono = false,
  hint,
}: {
  label: string;
  value: string;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <>
      <dt title={hint}>{label}</dt>
      <dd className={mono ? "mono" : undefined} title={hint}>
        {value}
      </dd>
    </>
  );
}
