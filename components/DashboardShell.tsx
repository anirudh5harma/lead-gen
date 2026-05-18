'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Lead } from '@/lib/leads'
import type { View, UserProfile } from './dashboard/types'
import type { SubscriptionTier } from '@/lib/lead-credits'
import {
  classifyDashboardCommandClient,
  isVoiceCancellation,
  isVoiceConfirmation,
  type DashboardCommand,
  type DashboardCommandInterpretation,
} from '@/lib/dashboard-command-layer'
import {
  classifyDashboardConversationClient,
  rankConversationPipelineLeads,
  type DashboardConversationAction,
  type DashboardConversationCollection,
} from '@/lib/dashboard-conversation-layer'
import Icon from '@/components/Icon'
import LeadDrawer from './dashboard/LeadDrawer'
import { useToast } from '@/components/Toast'
import HomeView from './dashboard/HomeView'
import CampaignsView from './dashboard/CampaignsView'
import AccountsView from './dashboard/AccountsView'
import OutreachView from './dashboard/OutreachView'
import IntegrationsView from './dashboard/IntegrationsView'
import SettingsView from './dashboard/SettingsView'
import ContentView, { type ContentIdea, type ContentVoiceCommand } from './dashboard/ContentView'

interface Props {
  initialLeads: Lead[]
  userProfile: UserProfile
}

type NavEntry = { id: View; label: string; sub: string; icon: string; group?: string }
type DrawerMode = 'open' | 'review'
type VoiceStatus = 'idle' | 'listening' | 'processing' | 'confirm' | 'clarify' | 'error'

type BrowserSpeechRecognitionResult = {
  isFinal?: boolean
  0?: { transcript?: string }
}

type BrowserSpeechRecognitionEvent = {
  results: {
    length: number
    [index: number]: BrowserSpeechRecognitionResult
  }
}

type BrowserSpeechRecognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type BrowserSpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => BrowserSpeechRecognition
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition
}

const VIEWS: NavEntry[] = [
  { id: 'home',         label: 'Home',         sub: 'Today’s queue and command bar.',                          icon: 'sync_alt' },
  { id: 'campaigns',    label: 'Campaigns',    sub: 'GTM motions — audience, trigger, narrative, channels.',    icon: 'campaign', group: 'GTM' },
  { id: 'outreach',     label: 'Pipeline',     sub: 'Outbound — priority leads, drafts, sent, replies.',       icon: 'mail',    group: 'GTM' },
  { id: 'accounts',     label: 'Signals',      sub: 'Outbound — accounts, signals, fit scores.',               icon: 'sensors', group: 'GTM' },
  { id: 'content',      label: 'Content',      sub: 'Content engine — ideas, composer, calendar, performance.', icon: 'edit_note', group: 'GTM' },
  { id: 'integrations', label: 'Integrations', sub: 'Sending, social, CRM, signals, agents API.',              icon: 'hub',     group: 'System' },
  { id: 'settings',     label: 'Settings',     sub: 'Profile, billing, team, and preferences.',                icon: 'settings', group: 'System' },
]

const VALID_VIEWS = new Set(VIEWS.map(v => v.id))

function normalizeView(input: string | null): View {
  if (!input) return 'home'
  if (VALID_VIEWS.has(input as View)) return input as View
  if (input.startsWith('sales/')) return input.endsWith('outreach') ? 'outreach' : 'home'
  if (input.startsWith('marketing/') || input.startsWith('content/')) return 'content'
  if (input.startsWith('revenue/')) return 'accounts'
  if (input.startsWith('engine/') || input === 'agents') return 'integrations'
  return 'home'
}

function sameContentIdeaList(a: ContentIdea[], b: ContentIdea[]): boolean {
  if (a.length !== b.length) return false
  return a.every((idea, index) => {
    const other = b[index]
    return other?.id === idea.id && other.status === idea.status && other.score === idea.score && other.angle === idea.angle
  })
}

export default function DashboardShell({ initialLeads, userProfile }: Props) {
  const router = useRouter()
  const toast = useToast()
  const [, startTransition] = useTransition()
  const [activeView, setActiveView] = useState<View>(() => {
    if (typeof window === 'undefined') return 'home'
    return normalizeView(new URLSearchParams(window.location.search).get('view'))
  })
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle')
  const [voiceTranscript, setVoiceTranscript] = useState('')
  const [voiceMessage, setVoiceMessage] = useState('Hold V and say a command.')
  const [pendingCommand, setPendingCommand] = useState<DashboardCommand | null>(null)
  const [clarification, setClarification] = useState<Extract<DashboardCommandInterpretation, { kind: 'clarify' }> | null>(null)
  const [globalLead, setGlobalLead] = useState<Lead | null>(null)
  const [globalLeadMode, setGlobalLeadMode] = useState<DrawerMode>('open')
  const [commandSearch, setCommandSearch] = useState<{ query: string; nonce: number } | null>(null)
  const [pendingScrollTarget, setPendingScrollTarget] = useState<string | null>(null)
  const [lastVoiceCollection, setLastVoiceCollection] = useState<DashboardConversationCollection | null>(null)
  const [contentIdeasForVoice, setContentIdeasForVoice] = useState<ContentIdea[]>([])
  const [contentVoiceCommand, setContentVoiceCommand] = useState<ContentVoiceCommand | null>(null)
  const [pipelineFocusLeadId, setPipelineFocusLeadId] = useState<string | null>(null)
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const transcriptRef = useRef('')
  const keyListeningRef = useRef(false)
  const voiceBusyRef = useRef(false)

  const userTier = useMemo<SubscriptionTier>(() => {
    const plan = (userProfile.plan ?? 'free') as SubscriptionTier
    return ['free', 'launch', 'team', 'growth', 'scale', 'enterprise'].includes(plan) ? plan : 'free'
  }, [userProfile.plan])

  useEffect(() => {
    function onPopState() {
      setActiveView(normalizeView(new URLSearchParams(window.location.search).get('view')))
      setPendingScrollTarget(window.location.hash.replace(/^#/, '') || null)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '')
    if (hash) setPendingScrollTarget(hash)
  }, [])

  useEffect(() => {
    if (mobileNavOpen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [mobileNavOpen])

  const leadById = useMemo(() => new Map(initialLeads.map(lead => [lead.id, lead])), [initialLeads])

  const commandLeads = useMemo(() => initialLeads.map(lead => ({
    id: lead.id,
    target_company: lead.target_company,
    company_domain: lead.company_domain,
    contact_name: lead.contact_name,
    contact_title: lead.contact_title,
    relevance_score: lead.relevance_score,
    status: lead.status,
    sent_at: lead.sent_at,
    replied_at: lead.replied_at,
    booked_at: lead.booked_at,
  })), [initialLeads])

  const pipelineLeadsForVoice = useMemo(() => rankConversationPipelineLeads(commandLeads), [commandLeads])

  const conversationContext = useMemo(() => ({
    activeView,
    lastCollection: lastVoiceCollection,
    contentIdeas: contentIdeasForVoice.map(idea => ({
      id: idea.id,
      angle: idea.angle,
      platform: idea.platform,
      score: idea.score,
      status: idea.status,
    })),
    pipelineLeads: pipelineLeadsForVoice,
  }), [activeView, contentIdeasForVoice, lastVoiceCollection, pipelineLeadsForVoice])

  const navigate = useCallback((v: View, sectionId?: string) => {
    setActiveView(v)
    setMobileNavOpen(false)
    setPendingScrollTarget(sectionId ?? null)
    const url = new URL(window.location.href)
    url.searchParams.set('view', v)
    url.hash = sectionId ? `#${sectionId}` : ''
    window.history.replaceState({}, '', url.toString())
  }, [])

  useEffect(() => {
    if (!pendingScrollTarget) return
    const handle = window.setTimeout(() => {
      const target = document.getElementById(pendingScrollTarget)
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      setPendingScrollTarget(null)
    }, 80)
    return () => window.clearTimeout(handle)
  }, [activeView, pendingScrollTarget])

  const refresh = useCallback(() => { startTransition(() => router.refresh()) }, [router, startTransition])

  const request = useCallback(async function request<T>(input: string, init?: RequestInit): Promise<T> {
    const response = await fetch(input, init)
    const json = await response.json().catch(() => ({})) as T & { error?: string }
    if (!response.ok) throw new Error(json.error || `Request failed with ${response.status}`)
    return json
  }, [])

  const fetchContentIdeasForVoice = useCallback(async () => {
    const json = await request<{ ideas?: ContentIdea[] }>('/api/content?resource=ideas')
    const ideas = (Array.isArray(json.ideas) ? json.ideas : [])
      .filter(idea => idea.status === 'proposed' || idea.status === 'approved')
    setContentIdeasForVoice(ideas)
    return ideas
  }, [request])

  const executeDashboardCommand = useCallback(async (command: DashboardCommand) => {
    setVoiceStatus('processing')
    setVoiceMessage(command.summary)
    voiceBusyRef.current = true
    try {
      if (command.type === 'navigate') {
        navigate(command.view, command.sectionId)
        // Content view tabs: switch to the requested sub-section
        if (command.view === 'content' && command.tab) {
          setContentVoiceCommand({ nonce: Date.now(), tab: command.tab as 'ideas' | 'composer' | 'calendar' | 'performance' })
        }
        toast.info(command.summary)
        setVoiceMessage(command.summary)
        return
      }

      if (command.type === 'refresh') {
        refresh()
        toast.info('Dashboard refresh started.')
        setVoiceMessage('Dashboard refresh started.')
        return
      }

      if (command.type === 'search') {
        setCommandSearch(current => ({ query: command.query, nonce: (current?.nonce ?? 0) + 1 }))
        // Voice search is always for companies/signals — navigate to Accounts view
        navigate('accounts')
        setVoiceMessage(command.summary)
        return
      }

      const lead = leadById.get(command.leadId)
      if (!lead) throw new Error('That lead is no longer loaded. Refresh and try again.')

      if (command.action === 'open' || command.action === 'review' || command.action === 'draft') {
        setGlobalLead(lead)
        setGlobalLeadMode(command.action === 'open' ? 'open' : 'review')
        setVoiceMessage(command.summary)
        return
      }

      if (command.action === 'unlock') {
        setGlobalLead(lead)
        setGlobalLeadMode('open')
        await request(`/api/leads/${lead.id}/unlock`, { method: 'POST' })
        refresh()
        toast.success(`Unlocked contact for ${lead.target_company}.`)
        setVoiceMessage(`Unlocked contact for ${lead.target_company}.`)
        return
      }

      if (command.action === 'status') {
        await request(`/api/leads/${lead.id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: command.status }),
        })
        refresh()
        if (command.status === 'dismissed') setGlobalLead(null)
        toast.success(`Marked ${lead.target_company} ${command.status}.`)
        setVoiceMessage(`Marked ${lead.target_company} ${command.status}.`)
        return
      }

      if (command.action === 'send') {
        const draftResult = await request<{
          draft?: { to?: string | null; cc?: Array<{ email?: string | null }>; subject?: string; body?: string }
        }>(`/api/leads/${lead.id}/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const draft = draftResult.draft
        if (!draft?.to || !draft.subject || !draft.body) throw new Error('The draft does not have a complete recipient, subject, and body.')
        await request('/api/outreach/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leadId: lead.id,
            to: draft.to,
            cc: draft.cc?.map(item => item.email).filter((email): email is string => Boolean(email)) ?? [],
            subject: draft.subject,
            body: draft.body,
          }),
        })
        refresh()
        toast.success(`Outreach sent for ${lead.target_company}.`)
        setVoiceMessage(`Outreach sent for ${lead.target_company}.`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Command failed.'
      toast.error(message)
      setVoiceStatus('error')
      setVoiceMessage(message)
      return
    } finally {
      voiceBusyRef.current = false
      window.setTimeout(() => setVoiceStatus(current => current === 'processing' ? 'idle' : current), 1200)
    }
  }, [leadById, navigate, refresh, request, toast])

  const dashboardCommandFromConversationAction = useCallback((action: DashboardConversationAction): DashboardCommand | null => {
    if (action.type !== 'pipeline_item') return null
    if (action.action === 'status') {
      return {
        type: 'lead',
        action: 'status',
        status: action.status,
        leadId: action.leadId,
        leadLabel: action.leadLabel,
        summary: action.summary,
        requiresConfirmation: action.requiresConfirmation,
      }
    }
    return {
      type: 'lead',
      action: action.action === 'details' ? 'open' : action.action,
      leadId: action.leadId,
      leadLabel: action.leadLabel,
      summary: action.summary,
      requiresConfirmation: action.requiresConfirmation,
    }
  }, [])

  const executeDashboardConversationAction = useCallback(async (action: DashboardConversationAction) => {
    setVoiceStatus('processing')
    setVoiceMessage(action.summary)
    voiceBusyRef.current = true
    try {
      if (action.type === 'show_collection') {
        setLastVoiceCollection(action.collection)
        if (action.collection === 'contentIdeas') {
          navigate('content')
          setContentVoiceCommand({ nonce: Date.now(), tab: 'ideas', reload: true })
          const ideas = await fetchContentIdeasForVoice()
          const message = ideas.length
            ? `Showing ${ideas.length} content idea${ideas.length === 1 ? '' : 's'}. Say "approve idea 1", "reject idea 1", or "draft idea 1".`
            : 'Showing Content. No active ideas are queued yet.'
          toast.info(message)
          setVoiceMessage(message)
          return
        }

        const [firstLead] = pipelineLeadsForVoice
        setPipelineFocusLeadId(firstLead?.id ?? null)
        navigate('outreach')
        const message = pipelineLeadsForVoice.length
          ? `Showing ${pipelineLeadsForVoice.length} pipeline item${pipelineLeadsForVoice.length === 1 ? '' : 's'}. Say "show lead 1", "draft lead 1", "unlock lead 1", or "send lead 1".`
          : 'Showing Pipeline. There are no active pipeline items.'
        toast.info(message)
        setVoiceMessage(message)
        return
      }

      if (action.type === 'content_idea') {
        setLastVoiceCollection('contentIdeas')
        navigate('content')
        if (action.action === 'approve' || action.action === 'reject') {
          const status = action.action === 'approve' ? 'approved' : 'rejected'
          await request('/api/content', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'set_idea_status', ideaId: action.ideaId, status }),
          })
          await fetchContentIdeasForVoice()
          setContentVoiceCommand({ nonce: Date.now(), tab: 'ideas', reload: true })
          const message = `${status === 'approved' ? 'Approved' : 'Rejected'} idea ${action.index}.`
          toast.success(message)
          setVoiceMessage(message)
          return
        }

        await request('/api/content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'write', ideaId: action.ideaId }),
        })
        await fetchContentIdeasForVoice()
        setContentVoiceCommand({ nonce: Date.now(), tab: 'composer', reload: true })
        const message = `Drafted idea ${action.index}. Opening Composer.`
        toast.success(message)
        setVoiceMessage(message)
        return
      }

      const command = dashboardCommandFromConversationAction(action)
      if (!command) throw new Error('That action is not available yet.')
      setLastVoiceCollection('pipeline')
      setPipelineFocusLeadId(action.leadId)
      navigate('outreach')
      await executeDashboardCommand(command)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Command failed.'
      toast.error(message)
      setVoiceStatus('error')
      setVoiceMessage(message)
      return
    } finally {
      voiceBusyRef.current = false
      window.setTimeout(() => setVoiceStatus(current => current === 'processing' ? 'idle' : current), 1200)
    }
  }, [dashboardCommandFromConversationAction, executeDashboardCommand, fetchContentIdeasForVoice, navigate, pipelineLeadsForVoice, request, toast])

  const handleContentVisibleContextChange = useCallback(({ ideas }: { ideas: ContentIdea[] }) => {
    setContentIdeasForVoice(current => sameContentIdeaList(current, ideas) ? current : ideas)
  }, [])

  const runInterpretedTranscript = useCallback(async (spokenText: string) => {
    const transcript = spokenText.trim()
    if (!transcript || voiceBusyRef.current) return

    setVoiceTranscript(transcript)
    // Clear any previous search so the user sees fresh results on next command
    if (commandSearch) setCommandSearch(null)
    // Optimistic feedback: show transcript immediately while LLM classifies
    setVoiceStatus('processing')
    setVoiceMessage(`Heard: "${transcript.slice(0, 80)}${transcript.length > 80 ? '...' : ''}"`)
    if (pendingCommand) {
      if (isVoiceConfirmation(transcript)) {
        const command = pendingCommand
        setPendingCommand(null)
        setClarification(null)
        void executeDashboardCommand(command)
        return
      }
      if (isVoiceCancellation(transcript)) {
        setPendingCommand(null)
        setVoiceStatus('idle')
        setVoiceMessage('Command cancelled.')
        return
      }
      setVoiceStatus('confirm')
      setVoiceMessage(`Say "confirm" to run: ${pendingCommand.summary}`)
      return
    }

    if (clarification) {
      const normalized = transcript.toLowerCase()
      const option = clarification.options.find((item, index) => (
        normalized.includes(item.label.toLowerCase()) ||
        normalized === `${index + 1}` ||
        normalized.includes(`option ${index + 1}`)
      ))
      if (option) {
        setClarification(null)
        void executeDashboardCommand(option.command)
        return
      }
    }

    const conversation = await classifyDashboardConversationClient(transcript, conversationContext)
    if (conversation.kind === 'action') {
      setClarification(null)
      const command = dashboardCommandFromConversationAction(conversation.action)
      if (command && 'requiresConfirmation' in command && command.requiresConfirmation) {
        setPendingCommand(command)
        setVoiceStatus('confirm')
        setVoiceMessage(`Confirm to run: ${command.summary}`)
      } else {
        void executeDashboardConversationAction(conversation.action)
      }
      return
    }
    if (conversation.kind === 'clarify') {
      setClarification(null)
      setVoiceStatus('clarify')
      setVoiceMessage(conversation.reason)
      return
    }

    const result = await classifyDashboardCommandClient({ transcript, activeView, leads: commandLeads })
    if (result.kind === 'command') {
      setClarification(null)
      if ('requiresConfirmation' in result.command && result.command.requiresConfirmation) {
        setPendingCommand(result.command)
        setVoiceStatus('confirm')
        setVoiceMessage(`Confirm to run: ${result.command.summary}`)
      } else {
        void executeDashboardCommand(result.command)
      }
      return
    }

    if (result.kind === 'clarify') {
      setClarification(result)
      setVoiceStatus('clarify')
      setVoiceMessage(result.reason)
      return
    }

    setVoiceStatus('error')
    setVoiceMessage(result.reason)
  }, [
    activeView,
    clarification,
    commandLeads,
    commandSearch,
    conversationContext,
    dashboardCommandFromConversationAction,
    executeDashboardCommand,
    executeDashboardConversationAction,
    pendingCommand,
  ])

  const stopVoice = useCallback(() => {
    keyListeningRef.current = false
    const recognition = recognitionRef.current
    if (!recognition) return
    try {
      recognition.stop()
    } catch {
      recognition.abort()
    }
  }, [])

  const startVoice = useCallback(() => {
    if (keyListeningRef.current || voiceBusyRef.current) return
    const SpeechRecognition = (window as BrowserSpeechRecognitionWindow).SpeechRecognition
      ?? (window as BrowserSpeechRecognitionWindow).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setVoiceStatus('error')
      setVoiceMessage('Voice commands need a browser with speech recognition support. Try Chrome or Edge.')
      return
    }

    transcriptRef.current = ''
    setVoiceTranscript('')
    setVoiceStatus('listening')
    setVoiceMessage(pendingCommand ? `Say "confirm" or "cancel".` : 'Listening. Release V to run the command.')

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.onresult = (event) => {
      let text = ''
      for (let index = 0; index < event.results.length; index += 1) {
        text += `${event.results[index]?.[0]?.transcript ?? ''} `
      }
      transcriptRef.current = text.trim()
      setVoiceTranscript(transcriptRef.current)
    }
    recognition.onerror = (event) => {
      setVoiceStatus('error')
      setVoiceMessage(event.error === 'not-allowed' ? 'Microphone access was blocked.' : 'Voice recognition failed. Try again.')
    }
    recognition.onend = () => {
      recognitionRef.current = null
      const transcript = transcriptRef.current.trim()
      if (transcript) {
        runInterpretedTranscript(transcript)
      } else {
        setVoiceStatus(current => current === 'listening' ? 'idle' : current)
        setVoiceMessage('No command was heard.')
      }
    }
    recognitionRef.current = recognition
    keyListeningRef.current = true
    try {
      recognition.start()
    } catch {
      keyListeningRef.current = false
      setVoiceStatus('error')
      setVoiceMessage('Could not start voice recognition.')
    }
  }, [pendingCommand, runInterpretedTranscript])

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null) {
      const element = target as HTMLElement | null
      if (!element) return false
      const tag = element.tagName.toLowerCase()
      return element.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select'
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'v' || event.repeat || event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return
      event.preventDefault()
      startVoice()
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'v') return
      event.preventDefault()
      stopVoice()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      recognitionRef.current?.abort()
    }
  }, [startVoice, stopVoice])

  async function logout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  const titleMeta = VIEWS.find(v => v.id === activeView) ?? VIEWS[0]
  const credits = userProfile.lead_credit_balance ?? 0

  return (
    <div className="min-h-screen flex bg-surface font-body-main text-on-surface">
      {/* Desktop sidebar */}
      <Sidebar profile={userProfile} activeView={activeView} onNavigate={navigate} />

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-on-surface/40 md:hidden" onClick={() => setMobileNavOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 w-64 md:hidden">
            <Sidebar profile={userProfile} activeView={activeView} onNavigate={navigate} forceShow />
          </div>
        </>
      )}

      <div className="flex-1 min-w-0 flex flex-col md:pl-64">
        <TopBar
          subtitle={titleMeta.sub}
          onRefresh={refresh}
          onMenu={() => setMobileNavOpen(true)}
          onLogout={() => void logout()}
          credits={credits}
          voiceStatus={voiceStatus}
          onVoiceStart={startVoice}
          onVoiceStop={stopVoice}
        />

        <main className="flex-1">
          <div className="max-w-[1280px] mx-auto px-margin-page py-stack-lg">
            {activeView === 'home'         && <HomeView key={`home-${commandSearch?.nonce ?? 0}`} profile={userProfile} leads={initialLeads} onNavigate={navigate} commandSearch={commandSearch} />}
            {activeView === 'campaigns'    && <CampaignsView profile={userProfile} leads={initialLeads} />}
            {activeView === 'accounts'     && <AccountsView key={`accounts-${commandSearch?.nonce ?? 0}`} profile={userProfile} leads={initialLeads} commandSearch={commandSearch} />}
            {activeView === 'outreach'     && <OutreachView profile={userProfile} leads={initialLeads} focusLeadId={pipelineFocusLeadId} />}
            {activeView === 'content'      && (
              <ContentView
                profile={userProfile}
                voiceCommand={contentVoiceCommand}
                onVisibleContextChange={handleContentVisibleContextChange}
              />
            )}
            {activeView === 'integrations' && <IntegrationsView profile={userProfile} />}
            {activeView === 'settings'     && <SettingsView profile={userProfile} userTier={userTier} />}
          </div>
        </main>
      </div>
      <VoiceCommandSurface
        status={voiceStatus}
        transcript={voiceTranscript}
        message={voiceMessage}
        pendingCommand={pendingCommand}
        clarification={clarification}
        onConfirm={() => {
          if (!pendingCommand) return
          const command = pendingCommand
          setPendingCommand(null)
          void executeDashboardCommand(command)
        }}
        onCancel={() => { setPendingCommand(null); setClarification(null); setVoiceStatus('idle'); setVoiceMessage('Command cancelled.') }}
        onRunOption={(command) => { setClarification(null); void executeDashboardCommand(command) }}
      />
      <LeadDrawer lead={globalLead} mode={globalLeadMode} onClose={() => setGlobalLead(null)} />
    </div>
  )
}

/* ─── Sidebar ─────────────────────────────────────────────────── */

function Sidebar({
  profile, activeView, onNavigate, forceShow,
}: {
  profile: UserProfile; activeView: View; onNavigate: (v: View) => void; forceShow?: boolean;
}) {
  const initials = (profile.client_name || profile.company_name || 'BS')
    .split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <aside className={`${forceShow ? 'flex w-full h-full' : 'hidden md:flex w-64 fixed left-0 top-0 h-screen'} flex-col bg-surface-container-lowest hairline-r z-50`}>
      <div className="px-6 py-10">
        <h1 className="font-bold text-[20px] tracking-tight text-primary leading-none">Bombsell</h1>
        <p className="font-label-mono text-[9px] uppercase tracking-[0.18em] text-on-surface-variant mt-1">Agentic GTM</p>
      </div>

      {profile.workspaces && profile.workspaces.length > 0 && (
        <div className="px-4 mb-3">
          <label className="font-label-mono text-[9px] uppercase tracking-widest text-outline-variant px-1">Workspace</label>
          <select
            value={profile.active_client_id ?? ''}
            onChange={async (e) => {
              const id = e.target.value
              if (!id) return
              await fetch('/api/clients', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activeClientId: id }) })
              window.location.reload()
            }}
            className="mt-1 w-full font-label-mono text-[11px] uppercase bg-surface-container border border-outline-variant/40 rounded px-2 py-1.5"
          >
            {!profile.active_client_id && <option value="">Personal</option>}
            {profile.workspaces.map((w) => <option key={w.client_id} value={w.client_id}>{w.name} · {w.role}</option>)}
          </select>
        </div>
      )}

      <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
        {VIEWS.map((v, i) => {
          const active = activeView === v.id
          const showGroup = v.group && v.group !== VIEWS[i - 1]?.group
          return (
            <div key={v.id}>
              {showGroup && <p className="px-3 pt-4 pb-1 font-label-mono text-[9px] uppercase tracking-widest text-outline-variant">{v.group}</p>}
              <button
                onClick={() => onNavigate(v.id)}
                className={`group w-full flex items-center gap-3 px-3 py-2 rounded transition-colors font-label-mono text-label-mono uppercase tracking-wider ${
                  active
                    ? 'bg-secondary-container text-on-secondary-container'
                    : 'text-on-surface-variant hover:bg-surface-container'
                }`}
              >
                <Icon name={v.icon} size={20} fill={active} />
                <span>{v.label}</span>
              </button>
            </div>
          )
        })}
      </nav>

      <div className="mt-auto">
        <button
          onClick={() => onNavigate('settings')}
          className="mx-4 mb-6 w-[calc(100%-2rem)] p-3 bg-surface-container rounded-lg hairline-border flex items-center justify-between group hover:bg-surface-container-high transition-colors text-left"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded bg-primary text-on-primary flex items-center justify-center font-bold text-xs shrink-0">{initials}</div>
            <div className="flex flex-col min-w-0">
              <p className="font-label-mono text-[10px] text-on-surface uppercase truncate leading-tight">{profile.client_name || profile.company_name}</p>
              <p className="font-label-mono text-[9px] text-primary uppercase leading-tight">{profile.plan ?? 'free'} plan</p>
            </div>
          </div>
          <Icon name="settings" size={18} className="text-on-surface-variant group-hover:text-primary transition-colors shrink-0" />
        </button>
      </div>
    </aside>
  )
}

/* ─── Top bar ─────────────────────────────────────────────────── */

function TopBar({
  subtitle, onRefresh, onMenu, onLogout, credits, voiceStatus, onVoiceStart, onVoiceStop,
}: {
  subtitle: string; onRefresh: () => void; onMenu: () => void; onLogout: () => void; credits: number;
  voiceStatus: VoiceStatus; onVoiceStart: () => void; onVoiceStop: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 h-14 bg-surface-container-low/80 backdrop-blur-md hairline-b flex items-center justify-between px-margin-page gap-2">
      <div className="flex items-center gap-stack-sm sm:gap-stack-md min-w-0 flex-1">
        <button
          onClick={onMenu}
          className="md:hidden tap-target -ml-2 h-10 w-10 inline-flex items-center justify-center rounded text-on-surface-variant hover:bg-surface-container shrink-0"
          aria-label="Open menu"
        >
          <Icon name="menu" size={20} />
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <span className="w-2 h-2 rounded-full bg-tertiary animate-pulse" />
          <span className="font-label-mono text-label-mono uppercase text-on-surface">Fleet live</span>
        </div>
        <div className="hidden md:block h-4 w-px bg-outline-variant" />
        <span className="hidden md:block font-label-mono text-[10px] uppercase text-on-surface-variant tracking-wider truncate">{subtitle}</span>
      </div>
      <div className="flex items-center gap-2 sm:gap-stack-md md:gap-stack-lg shrink-0">
        <button
          onMouseDown={onVoiceStart}
          onMouseUp={onVoiceStop}
          onMouseLeave={onVoiceStop}
          onTouchStart={(event) => { event.preventDefault(); onVoiceStart() }}
          onTouchEnd={(event) => { event.preventDefault(); onVoiceStop() }}
          className={`inline-flex h-8 items-center gap-1.5 sm:gap-2 rounded-full px-2.5 sm:px-3 font-label-mono text-[10px] uppercase tracking-widest transition-colors ${
            voiceStatus === 'listening'
              ? 'bg-primary text-on-primary'
              : 'bg-surface-container-lowest text-on-surface-variant hairline-border hover:text-primary'
          }`}
          title="Hold V to speak a dashboard command"
          aria-label="Hold to speak a dashboard command"
        >
          <Icon name="mic" size={15} />
          <span className="hidden md:inline">Hold V</span>
          <span className="hidden sm:inline md:hidden">Voice</span>
        </button>
        <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 bg-surface-container-lowest hairline-border rounded-full">
          <Icon name="database" size={16} className="text-primary" />
          <span className="font-label-mono text-[10px] uppercase text-on-surface">
            <span className="hidden sm:inline">Credits: </span>{credits}
          </span>
        </div>
        <button
          onClick={onRefresh}
          className="h-8 w-8 inline-flex items-center justify-center rounded-full text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors"
          title="Refresh" aria-label="Refresh"
        >
          <Icon name="refresh" size={18} />
        </button>
        <button onClick={onLogout} className="hidden sm:inline font-label-mono text-label-mono uppercase text-on-surface-variant hover:text-primary transition-colors">Logout</button>
      </div>
    </header>
  )
}

function VoiceCommandSurface({
  status, transcript, message, pendingCommand, clarification, onConfirm, onCancel, onRunOption,
}: {
  status: VoiceStatus
  transcript: string
  message: string
  pendingCommand: DashboardCommand | null
  clarification: Extract<DashboardCommandInterpretation, { kind: 'clarify' }> | null
  onConfirm: () => void
  onCancel: () => void
  onRunOption: (command: DashboardCommand) => void
}) {
  const visible = status !== 'idle' || Boolean(transcript) || Boolean(pendingCommand) || Boolean(clarification)
  if (!visible) return null

  return (
    <div className="fixed bottom-5 left-1/2 z-[90] w-[min(92vw,38rem)] -translate-x-1/2 rounded-lg border border-outline-variant bg-surface-container-lowest shadow-2xl">
      <div className="flex items-start gap-4 p-4">
        <div className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          status === 'listening' ? 'bg-primary text-on-primary' : status === 'error' ? 'bg-error-container text-on-error-container' : 'bg-secondary-container text-on-secondary-container'
        }`}>
          <Icon name={status === 'error' ? 'error' : 'mic'} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
              {status === 'listening' ? 'Listening' : status === 'confirm' ? 'Confirm action' : status === 'clarify' ? 'Clarify' : status === 'processing' ? 'Running' : 'Voice command'}
            </span>
            {status === 'listening' && <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />}
          </div>
          <p className="mt-1 font-body-main text-on-surface">{message}</p>
          {transcript && <p className="mt-2 truncate font-label-mono text-[10px] uppercase tracking-wider text-on-surface-variant">Heard: {transcript}</p>}
          {!transcript && status === 'listening' && (
            <p className="mt-2 font-label-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              Try: show pipeline · prepare draft for top lead · unlock Acme
            </p>
          )}
          {clarification && (
            <div className="mt-3 flex flex-wrap gap-2">
              {clarification.options.map((option) => (
                <button
                  key={`${option.command.type}-${option.command.summary}`}
                  onClick={() => onRunOption(option.command)}
                  className="rounded border border-outline-variant px-3 py-1.5 font-label-mono text-[10px] uppercase tracking-wider text-on-surface hover:bg-surface-container"
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {(pendingCommand || clarification) && (
          <div className="flex shrink-0 items-center gap-2">
            {pendingCommand && (
              <button onClick={onConfirm} className="rounded bg-primary px-3 py-2 font-label-mono text-[10px] uppercase tracking-wider text-on-primary hover:bg-primary-container">
                Confirm
              </button>
            )}
            <button onClick={onCancel} className="rounded border border-outline-variant px-3 py-2 font-label-mono text-[10px] uppercase tracking-wider text-on-surface-variant hover:bg-surface-container">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
