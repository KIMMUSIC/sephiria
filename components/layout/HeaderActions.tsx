'use client'

import { useState } from 'react'
import { Github, HelpCircle, MessageSquare } from 'lucide-react'
import { FeedbackModal } from '@/components/feedback/FeedbackModal'
import { WelcomeModal } from '@/components/onboarding/WelcomeModal'

const actionClass =
  'flex items-center gap-1.5 rounded-ctl border border-sephiria-border px-3 py-1.5 text-xs font-medium text-sephiria-muted transition-colors duration-200 ease-seph hover:bg-sephiria-grid hover:text-sephiria-fg active:scale-[0.98]'

export function HeaderActions() {
  const [helpOpen, setHelpOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        aria-label="도움말"
        title="사용 안내를 다시 봅니다"
        className={actionClass}
      >
        <HelpCircle size={13} />
        <span className="hidden sm:inline">도움말</span>
      </button>

      <button
        type="button"
        onClick={() => setFeedbackOpen(true)}
        aria-label="문의"
        title="문의나 의견을 남깁니다"
        className={actionClass}
      >
        <MessageSquare size={13} />
        <span className="hidden sm:inline">문의</span>
      </button>

      <a
        href="https://github.com/KIMMUSIC/sephiria"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="GitHub 저장소 열기 (새 창)"
        title="GitHub 저장소를 새 창으로 엽니다"
        className={actionClass}
      >
        <Github size={13} />
        <span className="hidden sm:inline">GitHub</span>
      </a>

      <WelcomeModal forceOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </>
  )
}
