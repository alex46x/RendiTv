'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { clearGuestSession, readGuestSession, subscribeToGuestSession, type GuestSession } from '@/lib/guest-session'
import VideoChat from '@/components/VideoChat'
import { LogOut, User as UserIcon } from 'lucide-react'

type LobbyPresence = {
  guestId: string
  username: string
  updatedAt: number
}

type PairOfferPayload = {
  pairId: string
  senderId: string
  senderName: string
  targetId: string
}

type PairAcceptPayload = {
  pairId: string
  senderId: string
  senderName: string
  targetId: string
}

export default function ChatDashboard() {
  const router = useRouter()
  const supabase = createClient()

  const guest = useSyncExternalStore(
    subscribeToGuestSession,
    readGuestSession,
    () => undefined as GuestSession | null | undefined
  )
  const [inQueue, setInQueue] = useState(false)
  const [matchId, setMatchId] = useState<string | null>(null)
  const [partnerId, setPartnerId] = useState<string | null>(null)
  const [queueError, setQueueError] = useState<string | null>(null)
  const lobbyChannelRef = useRef<RealtimeChannel | null>(null)
  const pairingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPairIdRef = useRef<string | null>(null)
  const inQueueRef = useRef(false)

  const clearPairAttempt = () => {
    pendingPairIdRef.current = null

    if (pairingTimeoutRef.current) {
      clearTimeout(pairingTimeoutRef.current)
      pairingTimeoutRef.current = null
    }
  }

  const clearQueueResources = () => {
    clearPairAttempt()

    if (lobbyChannelRef.current) {
      void supabase.removeChannel(lobbyChannelRef.current)
      lobbyChannelRef.current = null
    }
  }

  const setQueueState = (nextInQueue: boolean) => {
    inQueueRef.current = nextInQueue
    setInQueue(nextInQueue)
  }

  const sendLobbyBroadcast = async (
    channel: RealtimeChannel,
    event: 'pair-offer' | 'pair-accept',
    payload: PairOfferPayload | PairAcceptPayload
  ) => {
    const result = await channel.httpSend(event, payload)

    if (!result.success) {
      throw new Error(result.error)
    }
  }

  const listWaitingGuests = (channel: RealtimeChannel) => {
    const presenceState = channel.presenceState<LobbyPresence>()
    const waitingGuests = Object.values(presenceState)
      .flat()
      .filter((entry) => entry?.guestId && entry?.username)
      .map((entry) => ({
        guestId: entry.guestId,
        username: entry.username,
        updatedAt: entry.updatedAt,
      }))

    return waitingGuests.sort((a, b) => a.guestId.localeCompare(b.guestId))
  }

  const activateMatch = (nextPairId: string, nextPartnerId: string) => {
    clearQueueResources()
    setQueueState(false)
    setQueueError(null)
    setPartnerId(nextPartnerId)
    setMatchId(nextPairId)
  }

  const maybeAttemptPair = () => {
    const currentGuest = guest
    const channel = lobbyChannelRef.current

    if (!currentGuest || !channel || !inQueueRef.current || matchId || pendingPairIdRef.current) {
      return
    }

    const waitingGuests = listWaitingGuests(channel)
    const myIndex = waitingGuests.findIndex((entry) => entry.guestId === currentGuest.id)

    if (myIndex < 0 || myIndex % 2 !== 0 || myIndex + 1 >= waitingGuests.length) {
      return
    }

    const partner = waitingGuests[myIndex + 1]
    const pairId = [currentGuest.id, partner.guestId].sort().join(':')
    pendingPairIdRef.current = pairId

    void sendLobbyBroadcast(channel, 'pair-offer', {
      pairId,
      senderId: currentGuest.id,
      senderName: currentGuest.username,
      targetId: partner.guestId,
    }).catch((error) => {
      console.error('Failed to send pair offer:', error)
      clearPairAttempt()
    })

    pairingTimeoutRef.current = setTimeout(() => {
      if (pendingPairIdRef.current === pairId) {
        clearPairAttempt()
        maybeAttemptPair()
      }
    }, 3000)
  }

  useEffect(() => {
    if (guest === null) {
      router.push('/')
    }
  }, [guest, router])

  useEffect(() => {
    return () => {
      clearPairAttempt()

      if (lobbyChannelRef.current) {
        void supabase.removeChannel(lobbyChannelRef.current)
        lobbyChannelRef.current = null
      }
    }
  }, [supabase])

  const leaveQueue = async () => {
    setQueueState(false)
    clearQueueResources()
  }

  const joinQueue = async () => {
    if (!guest) {
      router.push('/')
      return
    }

    clearQueueResources()
    setQueueState(true)
    setQueueError(null)
    setMatchId(null)
    setPartnerId(null)

    const channel = supabase.channel('guest-lobby', {
      config: {
        presence: {
          key: guest.id,
        },
      },
    })

    lobbyChannelRef.current = channel

    channel
      .on('presence', { event: 'sync' }, () => {
        maybeAttemptPair()
      })
      .on('broadcast', { event: 'pair-offer' }, async ({ payload }: { payload: PairOfferPayload }) => {
        const offer = payload

        if (!guest || !inQueueRef.current || offer.targetId !== guest.id || pendingPairIdRef.current) {
          return
        }

        const waitingGuests = listWaitingGuests(channel)
        const myIndex = waitingGuests.findIndex((entry) => entry.guestId === guest.id)
        const expectedPartner = myIndex > 0 ? waitingGuests[myIndex - 1] : null

        if (myIndex % 2 === 0 || !expectedPartner || expectedPartner.guestId !== offer.senderId) {
          return
        }

        await sendLobbyBroadcast(channel, 'pair-accept', {
          pairId: offer.pairId,
          senderId: guest.id,
          senderName: guest.username,
          targetId: offer.senderId,
        })

        activateMatch(offer.pairId, offer.senderId)
      })
      .on('broadcast', { event: 'pair-accept' }, ({ payload }: { payload: PairAcceptPayload }) => {
        const acceptance = payload

        if (!guest || !inQueueRef.current || acceptance.targetId !== guest.id) {
          return
        }

        if (pendingPairIdRef.current !== acceptance.pairId) {
          return
        }

        activateMatch(acceptance.pairId, acceptance.senderId)
      })
      .subscribe(async (status: string) => {
        if (status === 'SUBSCRIBED') {
          const { error } = await channel.track({
            guestId: guest.id,
            username: guest.username,
            updatedAt: Date.now(),
          } satisfies LobbyPresence)

          if (error) {
            console.error('Failed to enter guest lobby:', error)
            clearQueueResources()
            setQueueState(false)
            setQueueError(`Failed to join queue. ${error.message}`)
            return
          }

          maybeAttemptPair()
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearQueueResources()
          setQueueState(false)
          setQueueError('Realtime connection failed. Please try again.')
        }
      })
  }

  const handleNext = async () => {
    setMatchId(null)
    setPartnerId(null)
    await joinQueue()
  }

  const handleStop = async () => {
    setMatchId(null)
    setPartnerId(null)
    await leaveQueue()
  }

  const handleExitGuestMode = async () => {
    await leaveQueue()
    clearGuestSession()
    router.push('/')
  }

  if (guest === undefined || !guest) {
    return <div className="min-h-screen flex items-center justify-center bg-zinc-900 text-white">Loading...</div>
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
      <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-4 md:px-6 bg-zinc-900/50 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center font-bold text-white">R</div>
          <span className="font-semibold text-lg tracking-tight">RandomChat</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-zinc-400 bg-zinc-800/50 px-3 py-1.5 rounded-full">
            <UserIcon size={16} />
            {guest.username}
          </div>
          <button onClick={handleExitGuestMode} className="text-zinc-400 hover:text-white transition p-2 rounded-full hover:bg-zinc-800">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        {!matchId || !partnerId ? (
          <div className="flex-1 flex flex-col items-center justify-center p-4">
            <div className="max-w-md w-full text-center space-y-6">
              <div className="w-24 h-24 bg-zinc-900 rounded-full flex items-center justify-center mx-auto border border-zinc-800 shadow-2xl">
                <div className={`w-16 h-16 rounded-full ${inQueue ? 'bg-indigo-500 animate-pulse' : 'bg-zinc-800'}`} />
              </div>

              <div>
                <h2 className="text-2xl font-semibold mb-2">
                  {inQueue ? 'Looking for someone...' : 'Ready to chat?'}
                </h2>
                <p className="text-zinc-400">
                  {inQueue
                    ? 'Guest mode is searching for another random person in the lobby.'
                    : 'Click start to enter the guest queue with your username.'}
                </p>
              </div>

              {queueError && <p className="text-red-400 text-sm">{queueError}</p>}

              <div className="pt-4">
                {inQueue ? (
                  <button
                    onClick={handleStop}
                    className="px-8 py-3 bg-zinc-800 text-white rounded-full font-medium hover:bg-zinc-700 transition w-full sm:w-auto"
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    onClick={joinQueue}
                    className="px-8 py-3 bg-indigo-600 text-white rounded-full font-medium hover:bg-indigo-700 transition w-full sm:w-auto shadow-lg shadow-indigo-500/20"
                  >
                    Start Chatting
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <VideoChat
            matchId={matchId}
            userId={guest.id}
            partnerId={partnerId}
            onNext={handleNext}
            onStop={handleStop}
            allowReport={false}
            useMatchStatusTable={false}
          />
        )}
      </main>
    </div>
  )
}
