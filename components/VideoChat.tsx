'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Mic, MicOff, Video, VideoOff, SkipForward, X, MessageSquare, Send } from 'lucide-react'

type VideoChatProps = {
  matchId: string
  userId: string
  partnerId: string
  onNext: () => void
  onStop: () => void
  allowReport?: boolean
  useMatchStatusTable?: boolean
}

export default function VideoChat({
  matchId,
  userId,
  partnerId,
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

  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const [messages, setMessages] = useState<{sender: string, text: string}[]>([])
  const [chatInput, setChatInput] = useState('')
  const [partnerDisconnected, setPartnerDisconnected] = useState(false)
  const [connectionState, setConnectionState] = useState<string>('connecting')

  const isCaller = userId > partnerId

  useEffect(() => {
    let mounted = true
    let pc: RTCPeerConnection | null = null
    let stream: MediaStream | null = null
    let channel: any = null
    let matchChannel: any = null

    const initWebRTC = async () => {
      // 1. Get local media
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        if (!mounted) {
          stream.getTracks().forEach(track => track.stop())
          return
        }
        localStreamRef.current = stream
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream
        }
      } catch (err) {
        console.error("Error accessing media devices.", err)
        // Handle gracefully, maybe they don't have a camera
      }

      // 2. Setup Peer Connection
      // Using Google's public STUN servers for MVP
      const configuration = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
      pc = new RTCPeerConnection(configuration)
      peerConnectionRef.current = pc

      // Add local tracks
      if (stream) {
        stream.getTracks().forEach(track => {
          pc!.addTrack(track, stream!)
        })
      }

      // Handle remote tracks
      pc.ontrack = (event) => {
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0]
        }
      }

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          channel?.send({
            type: 'broadcast',
            event: 'webrtc',
            payload: { type: 'ice', candidate: event.candidate, sender: userId }
          })
        }
      }

      pc.onconnectionstatechange = () => {
        setConnectionState(pc!.connectionState)
        if (pc!.connectionState === 'disconnected' || pc!.connectionState === 'failed' || pc!.connectionState === 'closed') {
          setPartnerDisconnected(true)
        }
      }

      // 3. Setup Supabase Realtime Channel
      channel = supabase.channel(`match_${matchId}`)
      channelRef.current = channel

      channel.on('broadcast', { event: 'webrtc' }, async ({ payload }: any) => {
        if (payload.sender === userId) return // Ignore own messages

        try {
          if (payload.type === 'offer') {
            await pc!.setRemoteDescription(new RTCSessionDescription(payload.offer))
            const answer = await pc!.createAnswer()
            await pc!.setLocalDescription(answer)
            channel.send({
              type: 'broadcast',
              event: 'webrtc',
              payload: { type: 'answer', answer, sender: userId }
            })
          } else if (payload.type === 'answer') {
            await pc!.setRemoteDescription(new RTCSessionDescription(payload.answer))
          } else if (payload.type === 'ice') {
            await pc!.addIceCandidate(new RTCIceCandidate(payload.candidate))
          } else if (payload.type === 'chat') {
            setMessages(prev => [...prev, { sender: 'Stranger', text: payload.text }])
          } else if (payload.type === 'leave') {
            setPartnerDisconnected(true)
          }
        } catch (err) {
          console.error("Error handling WebRTC message", err)
        }
      }).subscribe(async (status: string) => {
        if (status === 'SUBSCRIBED' && isCaller) {
          // Caller initiates the offer
          try {
            const offer = await pc!.createOffer()
            await pc!.setLocalDescription(offer)
            channel.send({
              type: 'broadcast',
              event: 'webrtc',
              payload: { type: 'offer', offer, sender: userId }
            })
          } catch (err) {
            console.error("Error creating offer", err)
          }
        }
      })
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
      channel?.send({
        type: 'broadcast',
        event: 'webrtc',
        payload: { type: 'leave', sender: userId }
      })
      if (stream) {
        stream.getTracks().forEach(track => track.stop())
      }
      pc?.close()
      if (channel) supabase.removeChannel(channel)
      if (matchChannel) supabase.removeChannel(matchChannel)
    }
  }, [matchId, userId, isCaller, supabase, useMatchStatusTable])

  const toggleMute = () => {
    const audioTracks = localStreamRef.current?.getAudioTracks() ?? []

    if (audioTracks.length > 0) {
      audioTracks.forEach(track => {
        track.enabled = !track.enabled
      })
      setIsMuted(!audioTracks[0].enabled)
    }
  }

  const toggleVideo = () => {
    const videoTracks = localStreamRef.current?.getVideoTracks() ?? []

    if (videoTracks.length > 0) {
      videoTracks.forEach(track => {
        track.enabled = !track.enabled
      })
      setIsVideoOff(!videoTracks[0].enabled)
    }
  }

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault()
    if (!chatInput.trim()) return
    
    setMessages(prev => [...prev, { sender: 'You', text: chatInput }])
    channelRef.current?.send({
      type: 'broadcast',
      event: 'webrtc',
      payload: { type: 'chat', text: chatInput, sender: userId }
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
    <div className="flex-1 flex flex-col md:flex-row bg-zinc-950 overflow-hidden">
      {/* Video Area */}
      <div className="flex-1 relative bg-black flex flex-col">
        {/* Remote Video */}
        <div className="flex-1 relative">
          <video 
            ref={remoteVideoRef} 
            autoPlay 
            playsInline 
            className="w-full h-full object-cover"
          />
          {partnerDisconnected && (
            <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-white z-10">
              <p className="text-xl font-semibold mb-4">Stranger has disconnected</p>
              <button 
                onClick={onNext}
                className="px-6 py-3 bg-indigo-600 rounded-full font-medium hover:bg-indigo-700 transition flex items-center gap-2"
              >
                <SkipForward size={20} />
                Find Next
              </button>
            </div>
          )}
          {connectionState === 'connecting' && !partnerDisconnected && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white z-10">
              <p className="animate-pulse">Connecting...</p>
            </div>
          )}
        </div>

        {/* Local Video (PiP) */}
        <div className="absolute bottom-20 right-4 md:bottom-4 md:right-4 w-32 h-48 md:w-48 md:h-64 bg-zinc-800 rounded-xl overflow-hidden border-2 border-zinc-700 shadow-xl z-20">
          <video 
            ref={localVideoRef} 
            autoPlay 
            playsInline 
            muted 
            className="w-full h-full object-cover transform scale-x-[-1]"
          />
        </div>

        {/* Controls Overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between z-30">
          <div className="flex items-center gap-3">
            <button onClick={toggleMute} className={`p-3 rounded-full ${isMuted ? 'bg-red-500 text-white' : 'bg-zinc-800/80 text-white hover:bg-zinc-700'} backdrop-blur-sm transition`}>
              {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
            <button onClick={toggleVideo} className={`p-3 rounded-full ${isVideoOff ? 'bg-red-500 text-white' : 'bg-zinc-800/80 text-white hover:bg-zinc-700'} backdrop-blur-sm transition`}>
              {isVideoOff ? <VideoOff size={20} /> : <Video size={20} />}
            </button>
          </div>
          
          <div className="flex items-center gap-3">
            {allowReport && (
              <button onClick={handleReport} className="text-xs text-zinc-400 hover:text-red-400 transition mr-2">
                Report
              </button>
            )}
            <button onClick={onStop} className="p-3 bg-zinc-800/80 text-white rounded-full hover:bg-zinc-700 backdrop-blur-sm transition">
              <X size={20} />
            </button>
            <button onClick={onNext} className="px-6 py-3 bg-indigo-600 text-white rounded-full font-medium hover:bg-indigo-700 transition flex items-center gap-2 shadow-lg">
              <SkipForward size={20} />
              <span className="hidden sm:inline">Next</span>
            </button>
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="w-full md:w-80 lg:w-96 bg-zinc-900 border-l border-zinc-800 flex flex-col h-64 md:h-auto z-40">
        <div className="p-4 border-b border-zinc-800 flex items-center gap-2 text-zinc-100 font-medium">
          <MessageSquare size={18} />
          Chat
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="text-center text-xs text-zinc-500 my-2">
            You&apos;re now chatting with a random stranger. Say hi!
          </div>
          {messages.map((msg, i) => (
            <div key={i} className={`flex flex-col ${msg.sender === 'You' ? 'items-end' : 'items-start'}`}>
              <span className="text-[10px] text-zinc-500 mb-1 px-1">{msg.sender}</span>
              <div className={`px-4 py-2 rounded-2xl max-w-[85%] text-sm ${msg.sender === 'You' ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-zinc-800 text-zinc-200 rounded-bl-sm'}`}>
                {msg.text}
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={sendChat} className="p-3 border-t border-zinc-800 flex gap-2 bg-zinc-900">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-zinc-800 text-zinc-100 px-4 py-2 rounded-full text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 border border-zinc-700"
            disabled={partnerDisconnected}
          />
          <button 
            type="submit" 
            disabled={!chatInput.trim() || partnerDisconnected}
            className="p-2 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:opacity-50 transition flex-shrink-0"
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  )
}
