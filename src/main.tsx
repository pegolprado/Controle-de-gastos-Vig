import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import './index.css';
import App from './App';
import { queryClient } from '@/lib/queryClient';
import { isConfigured } from '@/lib/env';
import { AuthProvider } from '@/app/AuthProvider';
import { BrandProvider } from '@/app/BrandProvider';
import { ThemeProvider, useTheme } from '@/app/ThemeProvider';
import { WorkspaceProvider } from '@/app/WorkspaceProvider';
import { ConfirmProvider } from '@/components/ui/Confirm';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { NotConfigured } from '@/app/NotConfigured';

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="top-center" richColors closeButton toastOptions={{ duration: 4000 }} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        {isConfigured ? (
          <QueryClientProvider client={queryClient}>
            <BrandProvider>
              <AuthProvider>
                <WorkspaceProvider>
                  <ConfirmProvider>
                    <App />
                  </ConfirmProvider>
                </WorkspaceProvider>
              </AuthProvider>
            </BrandProvider>
          </QueryClientProvider>
        ) : (
          <NotConfigured />
        )}
        <ThemedToaster />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
