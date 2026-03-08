'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LogOut, MessageSquare, Send, SkipForward } from 'lucide-react'

type VideoChatProps = {
  matchId: string
  userId: string
  partnerId: string
  localStream: MediaStream | null
  mediaError?: string | null
  selfName?: string
  onNext: () => void
  onStop: () => void
  allowReport?: boolean
  useMatchStatusTable?: boolean
}

type ChatMessage = {
  sender: 'You' | 'Stranger'
  text: string
}

function buildIceServers(): RTCIceServer[] {
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]

  const turnUrls = process.env.NEXT_PUBLIC_TURN_URLS
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (!turnUrls || turnUrls.length === 0) {
    return iceServers
  }

  iceServers.push({
    urls: turnUrls.length === 1 ? turnUrls[0] : turnUrls,
    username: process.env.NEXT_PUBLIC_TURN_USERNAME,
    credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
  })

  return iceServers
}

async function waitForIceGatheringComplete(pc: RTCPeerConnection, timeoutMs = 2000) {
  if (pc.iceGatheringState === 'complete') {
    return
  }

  await new Promise<void>((resolve) => {
    let settled = false

    const cleanup = () => {
      pc.removeEventListener('icegatheringstatechange', handleStateChange)
      clearTimeout(timeoutId)
    }

    const finish = () => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      resolve()
    }

    const handleStateChange = () => {
      if (pc.iceGatheringState === 'complete') {
        finish()
      }
    }

    const timeoutId = setTimeout(finish, timeoutMs)
    pc.addEventListener('icegatheringstatechange', handleStateChange)
  })
}

export default function VideoChat({
  matchId,
  userId,
  partnerId,
  localStream,
  mediaError = null,
  selfName = 'You',
  onNext,
  onStop,
  allowReport = true,
  useMatchStatusTable = true,
}: VideoChatProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const channelRef = useRef<any>(null)
  const supabase = createClient()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [partnerDisconnected, setPartnerDisconnected] = useState(false)
  const [connectionState, setConnectionState] = useState<string>('connecting')
  const [connectionIssue, setConnectionIssue] = useState<string | null>(null)
  const displayConnectionIssue = connectionIssue ?? mediaError

  const isCaller = userId > partnerId

  useEffect(() => {
    localStreamRef.current = localStream

    if (!localVideoRef.current) {
      return
    }

    localVideoRef.current.srcObject = localStream

    if (localStream) {
      void localVideoRef.current.play().catch(() => {})
    }
  }, [localStream])

  useEffect(() => {
    let mounted = true
    let pc: RTCPeerConnection | null = null
    let channel: any = null
    let matchChannel: any = null
    let hasSentReady = false
    let hasSentReadyAck = false
    let hasSentOffer = false
    let pendingIceCandidates: RTCIceCandidateInit[] = []
    let connectionTimeoutId: ReturnType<typeof setTimeout> | null = null
    const remoteVideoElement = remoteVideoRef.current

    const sendSignal = async (payload: Record<string, unknown>) => {
      if (!channel) {
        return
      }

      const result = await channel.httpSend('webrtc', {
        ...payload,
        sender: userId,
      })

      if (!result.success) {
        throw new Error(result.error)
      }
    }

    const flushPendingIceCandidates = async () => {
      if (!pc?.remoteDescription || pendingIceCandidates.length === 0) {
        return
      }

      const queuedCandidates = [...pendingIceCandidates]
      pendingIceCandidates = []

      for (const candidate of queuedCandidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate))
        } catch (err) {
          console.error('Error applying queued ICE candidate', err)
        }
      }
    }

    const addRemoteIceCandidate = async (candidate: RTCIceCandidateInit) => {
      if (!pc?.remoteDescription) {
        pendingIceCandidates.push(candidate)
        return
      }

      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate))
      } catch (err) {
        console.error('Error adding ICE candidate', err)
      }
    }

    const maybeCreateOffer = async () => {
      if (!isCaller || !pc || !channel || hasSentOffer) {
        return
      }

      hasSentOffer = true

      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        await waitForIceGatheringComplete(pc)
        await sendSignal({
          type: 'offer',
          offer: pc.localDescription?.toJSON() ?? offer,
        })
      } catch (err) {
        hasSentOffer = false
        console.error('Error creating offer', err)
      }
    }

    const initWebRTC = async () => {
      if (!localStreamRef.current) {
        setConnectionIssue(mediaError ?? 'Camera preview is still loading.')
      }

      const configuration = {
        iceServers: buildIceServers(),
      }
      pc = new RTCPeerConnection(configuration)
      peerConnectionRef.current = pc

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          pc!.addTrack(track, localStreamRef.current!)
        })
      }

      pc.ontrack = (event) => {
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0]
          setConnectionState('connected')
          void remoteVideoRef.current.play().catch(() => {})
        }
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          void sendSignal({ type: 'ice', candidate: event.candidate.toJSON() })
        }
      }

      pc.onconnectionstatechange = () => {
        setConnectionState(pc!.connectionState)
        if (pc!.connectionState === 'connected') {
          setConnectionIssue(null)
        }
        if (pc!.connectionState === 'disconnected' || pc!.connectionState === 'failed' || pc!.connectionState === 'closed') {
          setPartnerDisconnected(true)
        }
      }

      pc.oniceconnectionstatechange = () => {
        if (!pc) {
          return
        }

        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          setConnectionState('connected')
          setConnectionIssue(null)
        }

        if (pc.iceConnectionState === 'failed') {
          setConnectionIssue('Media connection failed. TURN server may be required for this network.')
          setPartnerDisconnected(true)
        }

        if (pc.iceConnectionState === 'disconnected') {
          setPartnerDisconnected(true)
        }
      }

      pc.onicecandidateerror = () => {
        setConnectionIssue('ICE candidate gathering failed. TURN server may be required for this network.')
      }

      // 3. Setup Supabase Realtime Channel
      channel = supabase.channel(`match_${matchId}`)
      channelRef.current = channel

      channel.on('broadcast', { event: 'webrtc' }, async ({ payload }: any) => {
        if (payload.sender === userId) return // Ignore own messages

        try {
          if (payload.type === 'ready') {
            if (!hasSentReadyAck) {
              hasSentReadyAck = true
              await sendSignal({ type: 'ready-ack' })
            }

            await maybeCreateOffer()
          } else if (payload.type === 'ready-ack') {
            await maybeCreateOffer()
          } else if (payload.type === 'offer') {
            await pc!.setRemoteDescription(payload.offer)
            await flushPendingIceCandidates()
            const answer = await pc!.createAnswer()
            await pc!.setLocalDescription(answer)
            await waitForIceGatheringComplete(pc!)
            await sendSignal({
              type: 'answer',
              answer: pc!.localDescription?.toJSON() ?? answer,
            })
          } else if (payload.type === 'answer') {
            await pc!.setRemoteDescription(payload.answer)
            await flushPendingIceCandidates()
          } else if (payload.type === 'ice') {
            await addRemoteIceCandidate(payload.candidate)
          } else if (payload.type === 'chat') {
            setMessages(prev => [...prev, { sender: 'Stranger', text: payload.text }])
          } else if (payload.type === 'leave') {
            setPartnerDisconnected(true)
          }
        } catch (err) {
          console.error("Error handling WebRTC message", err)
        }
      }).subscribe(async (status: string) => {
        if (status === 'SUBSCRIBED' && !hasSentReady) {
          hasSentReady = true
          await sendSignal({ type: 'ready' })
        }
      })

      connectionTimeoutId = setTimeout(() => {
        if (!mounted) {
          return
        }

        setConnectionIssue((current) => (
          current ?? 'Chat signaling is connected, but video/audio is not. This browser or network pair likely needs a TURN server.'
        ))
      }, 12000)
    }

    initWebRTC()

    if (useMatchStatusTable) {
      matchChannel = supabase.channel(`match_status_${matchId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` }, (payload: any) => {
          if (payload.new.active === false) {
            setPartnerDisconnected(true)
          }
        }).subscribe()
    }

    return () => {
      mounted = false
      void channel?.httpSend('webrtc', { type: 'leave', sender: userId })
      pc?.close()
      if (remoteVideoElement) {
        remoteVideoElement.srcObject = null
      }
      if (channel) supabase.removeChannel(channel)
      if (matchChannel) supabase.removeChannel(matchChannel)
      if (connectionTimeoutId) {
        clearTimeout(connectionTimeoutId)
      }
    }
  }, [matchId, userId, isCaller, localStream, mediaError, supabase, useMatchStatusTable])

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault()
    if (!chatInput.trim()) return
    
    setMessages(prev => [...prev, { sender: 'You', text: chatInput }])
    void channelRef.current?.httpSend('webrtc', {
      type: 'chat',
      text: chatInput,
      sender: userId,
    })
    setChatInput('')
  }

  const handleReport = async () => {
    // Insert report
    await supabase.from('reports').insert({
      reporter_id: userId,
      reported_id: partnerId,
      reason: 'Inappropriate behavior'
    })
    // Insert block so they don't match again
    try {
      await supabase.from('blocks').insert({
        blocker_id: userId,
        blocked_id: partnerId
      })
    } catch (e) {
      // Ignore if already blocked
    }
    
    alert('User reported and blocked. Skipping...')
    onNext()
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#050505] text-zinc-100">
      <div className="grid min-h-0 flex-1 md:grid-cols-2">
        <section className="relative min-h-[38vh] overflow-hidden border-b border-white/10 bg-black md:border-b-0 md:border-r">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="h-full w-full object-cover"
          />

          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-4">
            <div className="rounded-full border border-white/10 bg-black/50 px-4 py-1.5 text-sm text-zinc-200 backdrop-blur">
              Unknown user
            </div>
            <div className="rounded-full border border-white/10 bg-black/50 px-4 py-1.5 text-xs uppercase tracking-[0.22em] text-zinc-400 backdrop-blur">
              Left
            </div>
          </div>

          {partnerDisconnected && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/80 px-6 text-center">
              <p className="text-2xl font-semibold">Stranger has left the chat</p>
              <p className="mt-3 max-w-md text-sm text-zinc-400">
                Your camera stays on while you remain on this page. Jump to the next stranger when you are ready.
              </p>
              <button
                onClick={onNext}
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-indigo-600 px-6 py-3 font-medium text-white transition hover:bg-indigo-500"
              >
                <SkipForward size={18} />
                Next Stranger
              </button>
            </div>
          )}

          {connectionState === 'connecting' && !partnerDisconnected && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/45 px-6 text-center">
              <div className="max-w-md space-y-3">
                <p className="text-lg font-medium tracking-wide text-white">Connecting...</p>
                {displayConnectionIssue && (
                  <p className="text-sm leading-6 text-zinc-300">{displayConnectionIssue}</p>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="relative min-h-[38vh] overflow-hidden bg-zinc-950">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full scale-x-[-1] object-cover"
          />

          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-4">
            <div className="rounded-full border border-white/10 bg-black/50 px-4 py-1.5 text-sm text-zinc-200 backdrop-blur">
              {selfName}
            </div>
            <div className="rounded-full border border-white/10 bg-black/50 px-4 py-1.5 text-xs uppercase tracking-[0.22em] text-zinc-400 backdrop-blur">
              Right
            </div>
          </div>

          {!localStream && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/85 px-6 text-center">
              <p className="max-w-sm text-sm text-zinc-300">
              {displayConnectionIssue ?? 'Waiting for camera preview...'}
              </p>
            </div>
          )}
        </section>
      </div>

      <div className="grid min-h-[310px] border-t border-white/10 bg-[#090a0e] md:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4 border-b border-white/10 bg-zinc-100/[0.03] p-4 md:border-b-0 md:border-r">
          <div className="rounded-[28px] border border-white/10 bg-zinc-950/90 p-5">
            <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Session</p>
            <p className="mt-4 text-2xl font-semibold text-white">
              {connectionState === 'connected' ? 'You are live' : 'Waiting for stranger'}
            </p>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              {displayConnectionIssue ?? 'Your own camera stays visible on the right until you leave this page.'}
            </p>
          </div>

          <button
            onClick={onNext}
            className="rounded-[28px] bg-emerald-500/85 px-5 py-6 text-left shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-400"
          >
            <span className="block text-[11px] uppercase tracking-[0.24em] text-emerald-950/80">Action</span>
            <span className="mt-3 block text-3xl font-semibold text-white">Next</span>
            <span className="mt-2 block text-sm text-emerald-950/80">Find a new unknown user instantly.</span>
          </button>

          <button
            onClick={onStop}
            className="rounded-[28px] bg-rose-300/85 px-5 py-6 text-left shadow-lg shadow-rose-950/20 transition hover:bg-rose-200"
          >
            <span className="block text-[11px] uppercase tracking-[0.24em] text-rose-950/70">Action</span>
            <span className="mt-3 block text-3xl font-semibold text-white">Leave</span>
            <span className="mt-2 block text-sm text-rose-950/70">Return to the queue without turning your camera off.</span>
          </button>

          {allowReport && (
            <button
              onClick={handleReport}
              className="rounded-[24px] border border-red-500/20 bg-red-500/10 px-4 py-3 text-left text-sm text-red-200 transition hover:bg-red-500/15"
            >
              Report this user
            </button>
          )}
        </aside>

        <section className="flex min-h-0 flex-col bg-zinc-950/80">
          <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
              <MessageSquare size={18} />
            </div>
            <div>
              <p className="text-base font-semibold text-white">Chat</p>
              <p className="text-xs text-zinc-500">Left side is the stranger. Right side is your live camera.</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="space-y-4">
              <div className="text-center text-xs text-zinc-500">
                You&apos;re now chatting with a random stranger. Say hi!
              </div>
              {messages.map((msg, i) => (
                <div key={i} className={`flex flex-col ${msg.sender === 'You' ? 'items-end' : 'items-start'}`}>
                  <span className="mb-1 px-1 text-[10px] text-zinc-500">{msg.sender}</span>
                  <div className={`max-w-[85%] rounded-3xl px-4 py-3 text-sm ${msg.sender === 'You' ? 'rounded-br-md bg-indigo-600 text-white' : 'rounded-bl-md bg-zinc-800 text-zinc-100'}`}>
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-white/10 px-5 py-4">
            <form onSubmit={sendChat} className="flex items-center gap-3">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Write a message..."
                className="h-12 flex-1 rounded-full border border-zinc-800 bg-zinc-900 px-5 text-sm text-zinc-100 outline-none transition focus:border-indigo-500"
                disabled={partnerDisconnected}
              />
              <button
                type="submit"
                disabled={!chatInput.trim() || partnerDisconnected}
                className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send size={18} />
              </button>
              <button
                type="button"
                onClick={onStop}
                className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-zinc-900 text-zinc-300 transition hover:border-white/20 hover:text-white"
              >
                <LogOut size={18} />
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  )
}
