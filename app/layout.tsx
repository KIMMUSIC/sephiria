import type { Metadata, Viewport } from 'next'
import './globals.css'

const siteName = '세피리아 인벤토리 최적화'
const description = '세피리아 게임 인벤토리 아티팩트/석판 자동 최적 배치 서비스'

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  ),
  title: {
    default: siteName,
    template: `%s · ${siteName}`,
  },
  description,
  applicationName: siteName,
  keywords: ['세피리아', 'Sephiria', '인벤토리', '최적화', '아티팩트', '석판'],
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    siteName,
    title: siteName,
    description,
  },
  twitter: {
    card: 'summary',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
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
