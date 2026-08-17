'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'

const SEEN_KEY = 'sephiria:welcome-seen:v1'

interface WelcomeModalProps {
  forceOpen?: boolean
  onClose?: () => void
}

export function WelcomeModal({ forceOpen = false, onClose }: WelcomeModalProps) {
  const [autoOpen, setAutoOpen] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setAutoOpen(true)
    } catch {
      // 사파리 프라이빗 모드 등에서 localStorage 접근이 던지면 자동 표시를 포기한다.
    }
  }, [])

  function handleClose() {
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      // 저장에 실패해도 닫기는 계속 진행한다.
    }
    setAutoOpen(false)
    onClose?.()
  }

  return (
    <Modal
      open={autoOpen || forceOpen}
      onClose={handleClose}
      title="세피리아 인벤토리 최적화"
      className="w-full max-w-[34rem]"
    >
      <div className="flex flex-col gap-4 text-sm leading-relaxed text-sephiria-fg">
        <p>
          게임의 인벤토리 배치를 대신 풀어 주는 도구입니다. 아티팩트와 석판을 놓으면 석판
          효과와 제약, 콤보를 계산해 레벨 합이 가장 높은 자리를 찾아 줍니다.
        </p>

        <ol className="flex flex-col gap-1.5">
          <li>
            1. 채우기 — 게임 스크린샷을 붙여넣거나(Ctrl+V) 왼쪽 팔레트에서 끌어다 놓습니다.
          </li>
          <li>
            2. 다듬기 — 칸을 클릭해 인챈트 횟수와 목표 강화, 우선순위를 정합니다. 칸 자체에
            각인된 레벨도 여기서 넣습니다.
          </li>
          <li>
            3. 돌리기 — &lsquo;최적 배치 찾기&rsquo;를 누르면 배치를 바꿔 가며 가장 좋은
            자리를 찾습니다.
          </li>
        </ol>

        <ul className="flex flex-col gap-1.5 rounded-inner bg-sephiria-grid p-3 text-xs leading-relaxed text-sephiria-muted">
          <li>
            · 칸의 5/5 배지는 현재 레벨과 상한입니다. 파란색은 풀강, 빨간색은 레벨이 -1
            이하로 떨어져 효과가 무효인 상태입니다.
          </li>
          <li>
            · 제약이 있는 아티팩트는 조건을 만족하는 자리에 놓아야 고유 효과가 켜집니다.
          </li>
          <li>· 하얀 종이를 놓으면 콤보 패널에서 목표 콤보를 고를 수 있습니다.</li>
        </ul>

        <p className="text-xs text-sephiria-muted">
          이 안내는 오른쪽 위 &lsquo;도움말&rsquo;로 언제든 다시 열 수 있습니다.
        </p>

        <div className="flex justify-end">
          <Button size="sm" onClick={handleClose}>
            시작하기
          </Button>
        </div>
      </div>
    </Modal>
  )
}
