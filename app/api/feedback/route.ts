import { NextResponse } from 'next/server'
import { formatFeedback, validateFeedback } from '@/lib/feedback'

export const runtime = 'nodejs'

const WEBHOOK_TIMEOUT_MS = 8000

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: '잘못된 요청입니다' }, { status: 400 })
  }

  // 허니팟: 진짜 사용자는 이 숨겨진 필드를 채우지 않는다. 봇이 채웠다면
  // 실패를 알려주면 우회를 학습하므로, 아무것도 보내지 않고 성공한 척한다.
  const website = (body as Record<string, unknown> | null)?.['website']
  if (typeof website === 'string' && website !== '') {
    return NextResponse.json({ ok: true })
  }

  const validation = validateFeedback(body)
  if (!validation.ok) {
    return NextResponse.json({ ok: false, error: validation.error }, { status: 400 })
  }

  const webhookUrl = process.env.FEEDBACK_WEBHOOK_URL
  if (!webhookUrl) {
    console.error(
      '[feedback] FEEDBACK_WEBHOOK_URL 이 설정되지 않았습니다. .env.local 에 Discord/Slack 웹훅 URL 을 넣어 주세요.',
    )
    return NextResponse.json(
      { ok: false, error: '문의 채널이 아직 설정되지 않았습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 503 },
    )
  }

  const text = formatFeedback(validation.value)

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
    // Discord 는 content 를, Slack 은 text 를 읽고 모르는 필드는 무시하므로
    // 한 벌의 본문으로 두 메신저를 모두 지원한다.
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, text }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) {
      // 웹훅 URL 이나 응답 본문을 클라이언트에 돌려주지 않는다 (목적지 노출 금지).
      return NextResponse.json(
        { ok: false, error: '전송에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 502 },
      )
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: '전송에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true })
}
