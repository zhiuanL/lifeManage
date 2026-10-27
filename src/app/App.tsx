import { BrowserRouter } from "react-router-dom";
import { AppRouter } from "./AppRouter";
import { ErrorBoundary } from "./ErrorBoundary";
import { LifeOSProvider } from "./LifeOSProvider";

export function App() {
  return (
    <ErrorBoundary>
      <LifeOSProvider>
        <BrowserRouter>
          <AppRouter />
        </BrowserRouter>
      </LifeOSProvider>
    </ErrorBoundary>
  );
}
