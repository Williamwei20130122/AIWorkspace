/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Download,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'

import { cn } from '@/lib/utils'

/** 把秒数格式化为 mm:ss（超过一小时为 h:mm:ss）。 */
export function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function extensionFromUrl(url: string, fallback = 'bin'): string {
  try {
    const clean = url.split(/[?#]/)[0] ?? ''
    const last = clean.slice(clean.lastIndexOf('/') + 1)
    const dot = last.lastIndexOf('.')
    if (dot > 0 && dot < last.length - 1) {
      const ext = last.slice(dot + 1).toLowerCase()
      if (/^[a-z0-9]{1,8}$/.test(ext)) return ext
    }
  } catch {
    // 忽略解析失败，使用兜底扩展名
  }
  return fallback
}

/** 从 MIME 推断下载扩展名。 */
function extensionFromMime(mime: string | undefined, fallback = 'bin'): string {
  if (!mime) return fallback
  const map: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/mpeg': 'mpeg',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/webm': 'weba',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  }
  return map[mime] ?? fallback
}

/** 组装下载文件名：无扩展名时按 MIME/URL 补全。 */
export function withExtension(
  filename: string,
  opts: { url?: string; mime?: string; fallback?: string },
): string {
  if (/\.[a-z0-9]{1,8}$/i.test(filename)) return filename
  const ext = opts.url
    ? extensionFromUrl(opts.url, '')
    : ''
  const finalExt = ext || extensionFromMime(opts.mime, opts.fallback ?? 'bin')
  return finalExt ? `${filename}.${finalExt}` : filename
}

/**
 * 下载远程 / data: / blob: 资源为本地文件。
 * 优先 fetch 转 blob 以获得正确的文件名与跨域下载能力；失败时回退为
 * 同源 <a download> 直链，仍失败（跨域且无 CORS）时新开窗口保存。
 */
export async function downloadMediaFile(
  url: string,
  filename: string,
): Promise<void> {
  const finalName = filename || 'download'
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = finalName
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // 延迟释放，避免下载尚未开始就被回收
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
    return
  } catch {
    // 回退：浏览器直链下载
  }
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = finalName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** 把文本内容保存为本地文件（如 Markdown / TXT）。 */
export function downloadTextFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

interface PlayerBaseProps {
  src: string
  /** 下载时使用的文件名（可不含扩展名，会自动补全）。 */
  downloadName?: string
  className?: string
  /** 视频封面图（可选）。 */
  poster?: string
  /** 媒体加载失败时回调（供调用方展示失败重试 UI）。 */
  onError?: () => void
}

/* ---------- 共享控制条样式 ---------- */

const CONTROL_BTN =
  'inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/85 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40'

const TIME_TEXT =
  'select-none text-[11.5px] font-medium tabular-nums text-white/75'

/* ---------- 进度条（可点击 / 拖拽） ---------- */

function SeekBar(props: {
  value: number
  max: number
  onChange: (value: number) => void
  className?: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const pct =
    props.max > 0 ? Math.min(100, Math.max(0, (props.value / props.max) * 100)) : 0

  const computeValue = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el || props.max <= 0) return 0
      const rect = el.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      return ratio * props.max
    },
    [props.max],
  )

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(true)
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    props.onChange(computeValue(event.clientX))
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    props.onChange(computeValue(event.clientX))
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    setDragging(false)
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      ref={trackRef}
      role='slider'
      aria-valuemin={0}
      aria-valuemax={Math.round(props.max)}
      aria-valuenow={Math.round(props.value)}
      tabIndex={0}
      className={cn(
        'group relative h-4 cursor-pointer touch-none select-none',
        props.className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          props.onChange(Math.min(props.max, props.value + 5))
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault()
          props.onChange(Math.max(0, props.value - 5))
        }
      }}
    >
      <div className='absolute top-1/2 left-0 h-[5px] w-full -translate-y-1/2 rounded-full bg-white/25' />
      <div
        className='absolute top-1/2 left-0 h-[5px] -translate-y-1/2 rounded-full bg-[#8b7bf5] transition-[width] group-hover:bg-[#a08ff8]'
        style={{ width: `${pct}%` }}
      />
      <div
        className={cn(
          'absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,.4)] transition-transform',
          dragging ? 'scale-110' : 'scale-0 group-hover:scale-100',
        )}
        style={{ left: `${pct}%` }}
      />
    </div>
  )
}

/* ---------- 音量控制 ---------- */

function VolumeControl(props: {
  muted: boolean
  volume: number
  onToggleMute: () => void
  onChange: (value: number) => void
}) {
  const Icon = props.muted || props.volume === 0
    ? VolumeX
    : props.volume < 0.5
      ? Volume1
      : Volume2
  return (
    <div className='group/vol flex items-center gap-1.5'>
      <button
        type='button'
        className={CONTROL_BTN}
        onClick={props.onToggleMute}
        aria-label={props.muted ? '取消静音' : '静音'}
      >
        <Icon className='h-4 w-4' />
      </button>
      <div className='h-4 w-0 overflow-hidden transition-all duration-200 group-hover/vol:w-20 group-focus-within/vol:w-20'>
        <input
          type='range'
          min={0}
          max={1}
          step={0.05}
          value={props.muted ? 0 : props.volume}
          onChange={(event) => props.onChange(Number(event.target.value))}
          className='h-4 w-20 cursor-pointer accent-[#8b7bf5]'
          aria-label='音量'
        />
      </div>
    </div>
  )
}

/* ---------- 自定义视频播放器 ---------- */

export function VideoPlayer(props: PlayerBaseProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    const onFullscreenChange = () => {
      setFullscreen(document.fullscreenElement === wrapRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [])

  const showControls = useCallback(() => {
    setControlsVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControlsVisible(false)
    }, 2600)
  }, [])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play().catch(() => undefined)
    } else {
      video.pause()
    }
    showControls()
  }, [showControls])

  const handleDownload = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      await downloadMediaFile(
        props.src,
        withExtension(props.downloadName ?? 'video', {
          url: props.src,
          mime: 'video/mp4',
          fallback: 'mp4',
        }),
      )
    } finally {
      setDownloading(false)
    }
  }

  const toggleFullscreen = () => {
    if (document.fullscreenElement === wrapRef.current) {
      void document.exitFullscreen().catch(() => undefined)
    } else {
      void wrapRef.current?.requestFullscreen().catch(() => undefined)
    }
  }

  const pct = duration > 0 ? (current / duration) * 100 : 0

  return (
    <div
      ref={wrapRef}
      className={cn(
        'group/player relative w-full overflow-hidden rounded-[14px] bg-[#0d0c1d] shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)]',
        fullscreen && 'rounded-none',
        props.className,
      )}
      onMouseMove={showControls}
      onMouseLeave={() => {
        if (videoRef.current && !videoRef.current.paused) setControlsVisible(false)
      }}
    >
      {/* 原生控件关闭，播放完全由自绘控制条驱动 */}
      <video
        ref={videoRef}
        src={props.src}
        poster={props.poster}
        playsInline
        preload='metadata'
        className={cn(
          'block w-full bg-black',
          fullscreen ? 'h-full max-h-screen object-contain' : 'max-h-[420px] object-contain',
        )}
        onClick={togglePlay}
        onPlay={() => {
          setPlaying(true)
          showControls()
        }}
        onPause={() => {
          setPlaying(false)
          setControlsVisible(true)
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onProgress={(event) => {
          const video = event.currentTarget
          if (video.buffered.length > 0) {
            setBuffered(video.buffered.end(video.buffered.length - 1))
          }
        }}
        onVolumeChange={(event) => {
          setVolume(event.currentTarget.volume)
          setMuted(event.currentTarget.muted)
        }}
        onDoubleClick={toggleFullscreen}
        onError={() => props.onError?.()}
      />

      {/* 中央大播放键（暂停时显示） */}
      {!playing && (
        <button
          type='button'
          onClick={togglePlay}
          aria-label='播放'
          className='absolute top-1/2 left-1/2 z-10 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-all hover:scale-105 hover:bg-black/70'
        >
          <Play className='ml-1 h-7 w-7 fill-current' />
        </button>
      )}

      {/* 底部控制条 */}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pt-8 pb-2.5 transition-opacity duration-200',
          controlsVisible || !playing ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        {/* 缓冲 + 播放进度 */}
        <div className='relative mb-1 h-4'>
          <div className='absolute top-1/2 left-0 h-[5px] w-full -translate-y-1/2 rounded-full bg-white/20' />
          <div
            className='absolute top-1/2 left-0 h-[5px] -translate-y-1/2 rounded-full bg-white/30'
            style={{
              width: duration > 0 ? `${Math.min(100, (buffered / duration) * 100)}%` : '0%',
            }}
          />
          <SeekBar
            className='absolute inset-x-0 top-0'
            value={current}
            max={duration}
            onChange={(value) => {
              const video = videoRef.current
              if (!video) return
              video.currentTime = value
              setCurrent(value)
            }}
          />
          {/* 已播放高亮覆盖在 SeekBar 轨道上方 */}
          <div
            className='pointer-events-none absolute top-1/2 left-0 h-[5px] -translate-y-1/2 rounded-full bg-[#8b7bf5]'
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className='flex items-center gap-1'>
          <button
            type='button'
            className={CONTROL_BTN}
            onClick={togglePlay}
            aria-label={playing ? '暂停' : '播放'}
          >
            {playing ? (
              <Pause className='h-4.5 w-4.5 fill-current' />
            ) : (
              <Play className='h-4.5 w-4.5 fill-current' />
            )}
          </button>

          <span className={cn(TIME_TEXT, 'mr-1')}>
            {formatMediaTime(current)} / {formatMediaTime(duration)}
          </span>

          <VolumeControl
            muted={muted}
            volume={volume}
            onToggleMute={() => {
              const video = videoRef.current
              if (video) video.muted = !video.muted
            }}
            onChange={(value) => {
              const video = videoRef.current
              if (!video) return
              video.volume = value
              video.muted = value === 0
            }}
          />

          <div className='flex-1' />

          <button
            type='button'
            className={CONTROL_BTN}
            onClick={() => void handleDownload()}
            disabled={downloading}
            aria-label='下载视频'
            title='下载视频'
          >
            <Download className='h-4 w-4' />
          </button>
          <button
            type='button'
            className={CONTROL_BTN}
            onClick={toggleFullscreen}
            aria-label={fullscreen ? '退出全屏' : '全屏'}
          >
            {fullscreen ? (
              <Minimize2 className='h-4 w-4' />
            ) : (
              <Maximize2 className='h-4 w-4' />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- 自定义音频播放器 ---------- */

export function AudioPlayer(props: PlayerBaseProps) {
  const audioRef = useRef<HTMLAudioElement>(null)

  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      void audio.play().catch(() => undefined)
    } else {
      audio.pause()
    }
  }

  const handleDownload = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      await downloadMediaFile(
        props.src,
        withExtension(props.downloadName ?? 'audio', {
          url: props.src,
          mime: 'audio/mpeg',
          fallback: 'mp3',
        }),
      )
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      className={cn(
        'flex w-full items-center gap-3 rounded-[14px] border border-[#e5e2f7] bg-gradient-to-r from-[#f6f4ff] to-[#fbfaff] px-3.5 py-3',
        props.className,
      )}
    >
      <audio
        ref={audioRef}
        src={props.src}
        preload='metadata'
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onVolumeChange={(event) => {
          setVolume(event.currentTarget.volume)
          setMuted(event.currentTarget.muted)
        }}
        onError={() => props.onError?.()}
      />

      <button
        type='button'
        onClick={togglePlay}
        aria-label={playing ? '暂停' : '播放'}
        className='flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#6c5ce7] text-white shadow-[0_4px_14px_rgba(108,92,231,.35)] transition-all hover:scale-105 hover:bg-[#5b4bd6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6c5ce7]/40'
      >
        {playing ? (
          <Pause className='h-5 w-5 fill-current' />
        ) : (
          <Play className='ml-0.5 h-5 w-5 fill-current' />
        )}
      </button>

      <div className='min-w-0 flex-1'>
        <SeekBar
          value={current}
          max={duration}
          onChange={(value) => {
            const audio = audioRef.current
            if (!audio) return
            audio.currentTime = value
            setCurrent(value)
          }}
          className='w-full'
        />
        <div className='mt-0.5 flex items-center justify-between'>
          <span className='text-[11.5px] font-medium tabular-nums text-[#6d6b8a]'>
            {formatMediaTime(current)}
          </span>
          <span className='text-[11.5px] font-medium tabular-nums text-[#a3a2b8]'>
            {formatMediaTime(duration)}
          </span>
        </div>
      </div>

      <div className='hidden shrink-0 items-center gap-1.5 sm:flex'>
        <VolumeControl
          muted={muted}
          volume={volume}
          onToggleMute={() => {
            const audio = audioRef.current
            if (audio) audio.muted = !audio.muted
          }}
          onChange={(value) => {
            const audio = audioRef.current
            if (!audio) return
            audio.volume = value
            audio.muted = value === 0
          }}
        />
      </div>

      <button
        type='button'
        onClick={() => void handleDownload()}
        disabled={downloading}
        aria-label='下载音频'
        title='下载音频'
        className='inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border border-[#ded9f7] bg-white px-3 text-[12.5px] font-semibold text-[#5b4bd6] transition-colors hover:border-[#6c5ce7] hover:bg-[#f4f1ff] disabled:opacity-60'
      >
        <Download className='h-3.5 w-3.5' />
        下载
      </button>
    </div>
  )
}
