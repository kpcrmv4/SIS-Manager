'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Camera } from 'lucide-react'
import type { IScannerControls } from '@zxing/browser'

/**
 * Camera QR scanner. The camera starts on a tap (iOS needs a user gesture) and stops
 * as soon as one code is read; the parent decides what the code means.
 */
export function Scanner({ onCode, paused }: { onCode: (text: string) => void; paused: boolean }) {
  const t = useTranslations('scan')
  const video = useRef<HTMLVideoElement>(null)
  const controls = useRef<IScannerControls | null>(null)
  const [state, setState] = useState<'idle' | 'running' | 'denied'>('idle')

  async function start() {
    if (!video.current) return
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser')
      const reader = new BrowserQRCodeReader()
      setState('running')
      controls.current = await reader.decodeFromVideoDevice(undefined, video.current, (result, _err, ctl) => {
        if (result) {
          ctl.stop()
          controls.current = null
          setState('idle')
          onCode(result.getText())
        }
      })
    } catch {
      setState('denied')
    }
  }

  useEffect(() => {
    if (paused && controls.current) {
      controls.current.stop()
      controls.current = null
      setState('idle')
    }
  }, [paused])

  useEffect(() => () => controls.current?.stop(), [])

  return (
    <div className="scanbox" data-testid="scanbox">
      <video ref={video} muted playsInline className={state === 'running' ? '' : 'invisible'} />
      <div className="frame" />
      {state === 'running' && <div className="scanline" />}
      {state !== 'running' && (
        <button type="button" onClick={() => void start()} className="btn-primary relative z-10">
          <Camera className="size-4" aria-hidden />
          {t('cameraStart')}
        </button>
      )}
      <div className="hint">{state === 'denied' ? t('cameraDenied') : t('hint')}</div>
    </div>
  )
}
