import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Random Video Chat',
  description: 'A low-cost random video chat web app',
  manifest: '/manifest.json',
}

export const viewport = {
  themeColor: '#09090b',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
