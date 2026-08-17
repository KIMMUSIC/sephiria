'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MAX_LENGTH,
  type FeedbackCategory,
} from '@/lib/feedback'
import { cn } from '@/lib/utils'

interface FeedbackModalProps {
  open: boolean
  onClose: () => void
}

const NETWORK_ERROR = '전송에 실패했습니다. 잠시 후 다시 시도해 주세요.'

export function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const [category, setCategory] = useState<FeedbackCategory>('건의')
  const [message, setMessage] = useState('')
  const [website, setWebsite] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) return
    setCategory('건의')
    setMessage('')
    setWebsite('')
    setSending(false)
    setSent(false)
    setError(null)
  }, [open])

  async function handleSubmit() {
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, message, website }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (data.ok) {
        setSent(true)
        setMessage('')
        setWebsite('')
      } else {
        setError(data.error ?? NETWORK_ERROR)
      }
    } catch {
      setError(NETWORK_ERROR)
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="문의 · 의견 남기기"
      className="w-full max-w-[28rem]"
    >
      {sent ? (
        <div className="flex flex-col gap-4">
          <p className="rounded-inner bg-sephiria-buff px-4 py-3 text-sm leading-relaxed text-sephiria-buff-fg">
            보내 주셔서 고맙습니다. 잘 전달되었습니다.
          </p>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={onClose}>
              닫기
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="문의 유형">
            {FEEDBACK_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className={cn(
                  'rounded-ctl px-3 py-1.5 text-xs font-medium transition-colors duration-200 ease-seph',
                  category === c
                    ? 'bg-sephiria-accent-soft text-sephiria-accent-fg'
                    : 'border border-sephiria-border text-sephiria-muted hover:bg-sephiria-grid hover:text-sephiria-fg'
                )}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1">
            <textarea
              rows={6}
              maxLength={FEEDBACK_MAX_LENGTH}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="어떤 점이 불편했는지, 무엇이 있으면 좋을지 적어 주세요."
              aria-label="문의 내용"
              className="w-full resize-y rounded-inner border border-sephiria-border bg-sephiria-bg p-3 text-sm leading-relaxed text-sephiria-fg placeholder:text-sephiria-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sephiria-accent"
            />
            <span className="self-end text-xs text-sephiria-muted">
              {message.length} / {FEEDBACK_MAX_LENGTH}
            </span>
          </div>

          <input
            type="text"
            name="website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            className="hidden"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
          />

          {error && (
            <p className="rounded-inner bg-sephiria-debuff px-4 py-3 text-sm leading-relaxed text-sephiria-debuff-fg">
              {error}
            </p>
          )}

          <p className="text-xs leading-relaxed text-sephiria-muted">
            익명으로 전달됩니다. 이름이나 연락처는 받지 않습니다.
          </p>

          <div className="flex justify-end">
            <Button size="sm" onClick={handleSubmit} disabled={sending}>
              {sending ? '보내는 중…' : '보내기'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
