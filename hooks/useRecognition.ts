'use client'

// Retired histogram path. SmartUploader fallback is manual — do not wire this back in.

import { useState, useCallback, useRef } from 'react'
import type { RecognitionResult } from '@/types'
import type { GridParams } from '@/lib/gridDetector'
import {
  computeCellCrops,
  cropCellIcon,
  isCellEmpty,
} from '@/lib/gridDetector'
import { loadTemplates, recognizeAll } from '@/lib/templateMatcher'

interface RecognitionProgress {
  phase: 'loading' | 'cropping' | 'matching' | 'done'
  completed: number
  total: number
}

interface UseRecognitionReturn {
  isRecognizing: boolean
  progress: RecognitionProgress | null
  results: RecognitionResult[]
  recognize: (screenshot: HTMLImageElement, gridParams: GridParams) => Promise<void>
  cancel: () => void
}

export function useRecognition(): UseRecognitionReturn {
  const [isRecognizing, setIsRecognizing] = useState(false)
  const [progress, setProgress] = useState<RecognitionProgress | null>(null)
  const [results, setResults] = useState<RecognitionResult[]>([])
  const cancelledRef = useRef(false)

  const recognize = useCallback(
    async (screenshot: HTMLImageElement, gridParams: GridParams) => {
      cancelledRef.current = false
      setIsRecognizing(true)
      setResults([])

      try {
        // Phase 1: Load templates
        setProgress({ phase: 'loading', completed: 0, total: 295 })
        await loadTemplates()
        if (cancelledRef.current) return

        // Phase 2: Crop cells from screenshot
        setProgress({ phase: 'cropping', completed: 0, total: gridParams.slotNum })

        const canvas = document.createElement('canvas')
        canvas.width = screenshot.naturalWidth
        canvas.height = screenshot.naturalHeight
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(screenshot, 0, 0)

        const crops = computeCellCrops(gridParams)
        const cellImages: { slotIndex: number; imageData: ImageData }[] = []

        for (const crop of crops) {
          if (cancelledRef.current) return
          const iconData = cropCellIcon(ctx, crop, 40)
          if (!isCellEmpty(iconData)) {
            cellImages.push({ slotIndex: crop.slotIndex, imageData: iconData })
          }
          setProgress({
            phase: 'cropping',
            completed: crop.slotIndex + 1,
            total: gridParams.slotNum,
          })
        }

        if (cancelledRef.current) return

        // Phase 3: Template matching
        setProgress({ phase: 'matching', completed: 0, total: cellImages.length })

        const recognized = await recognizeAll(cellImages, (completed, total) => {
          if (!cancelledRef.current) {
            setProgress({ phase: 'matching', completed, total })
          }
        })

        if (cancelledRef.current) return

        setResults(recognized)
        setProgress({ phase: 'done', completed: cellImages.length, total: cellImages.length })
      } catch (err) {
        console.error('Recognition failed:', err)
      } finally {
        if (!cancelledRef.current) {
          setIsRecognizing(false)
        }
      }
    },
    []
  )

  const cancel = useCallback(() => {
    cancelledRef.current = true
    setIsRecognizing(false)
    setProgress(null)
  }, [])

  return { isRecognizing, progress, results, recognize, cancel }
}
