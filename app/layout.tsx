import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '세피리아 인벤토리 최적화',
  description: '세피리아 게임 인벤토리 아티팩트/석판 자동 최적 배치 서비스',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko" className="dark">
      <body className="min-h-screen bg-sephiria-bg antialiased">
        {children}
      </body>
    </html>
  )
}
