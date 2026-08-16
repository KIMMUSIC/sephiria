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
    <html lang="ko">
      <body className="min-h-[100dvh] bg-sephiria-bg text-sephiria-fg antialiased">
        <a href="#main" className="skip-link">
          본문으로 건너뛰기
        </a>
        {children}
      </body>
    </html>
  )
}
