import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import App from './App'
import './index.css'

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: (n, e: any) => n < 1 && !(e?.status >= 400 && e?.status < 500), refetchOnWindowFocus: false, staleTime: 15_000 },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
        <Toaster theme="dark" richColors position="top-right" />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
