import { Component, type ReactNode } from "react";
import Logo from "@/components/Logo";

interface Props { children: ReactNode }
interface State { hasError: boolean }

/**
 * Catches unexpected render errors anywhere in the app and shows a friendly
 * screen instead of a blank white page. Wraps the router in App.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error("[Furora] uncaught error:", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 text-center">
        <Logo className="h-8 opacity-80" />
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-serif text-primary">Something went wrong</h1>
          <p className="text-sm text-muted-foreground max-w-sm">
            An unexpected error occurred. Reloading the page usually fixes it — if it keeps happening, please try again in a little while.
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="rounded-full bg-primary text-primary-foreground text-sm font-medium px-5 py-2.5 hover:bg-primary/90 active:scale-95 transition"
        >
          Reload page
        </button>
      </div>
    );
  }
}
