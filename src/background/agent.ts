import { buildJevRequest, validateChoiceAnswer } from '../shared/action-space';
import { activeJevModel, callJevProvider } from '../shared/providers';
import { createFieldContext, generateFieldText } from '../shared/text-helper';
import { suggestSwaggerGetOperation } from '../shared/swagger-support';
import { isLocalSystemOneEndpoint, toLocalSystemOneRequest } from '../shared/providers/local-systemone';
import { isYoutubeResultPage, isYoutubeWatchPage, parseNavigationIntent, type NavigationIntent } from '../shared/navigation-intent';
import { suggestYoutubeVideo, titleMatchesRequestedSong, watchVideoId } from '../shared/youtube-support';
import {
  ActResult,
  AgentProgress,
  AgentTiming,
  ChoiceQuestion,
  AgentStepLog,
  AppSettings,
  DEFAULT_SETTINGS,
  PageAction,
  PageSnapshot,
  PrepareResult,
  RecentAction,
} from '../shared/types';
import { TrustedInput } from './input';
import { routeDirectIntent } from '../shared/intent-router';
import { runYoutubeMediaSkill } from './media-skill';
import { verifyGenericDone } from '../shared/completion-verifier';
import { planWithChatAI, type AgentPlan } from '../shared/planner';
import { readTaskMemory, rememberTask, type TaskMemory } from '../shared/task-memory';
import { suggestVisionAction } from '../shared/vision';
import { checkObservedTarget } from '../shared/direct-tools';


/** Semantic fingerprint of an observation: URL, scroll, visible text and the element table. */
export function computePageFingerprint(snapshot: PageSnapshot): string {
  const semantics = snapshot.actions.map(({ rect, ...a }) => a);
  return JSON.stringify([snapshot.url, Math.round(snapshot.scroll.y), snapshot.text, semantics]);
}

interface PageSummary {
  url: string;
  title: string;
  textLength: number;
  scrollY: number;
  fingerprint: string;
}

const summarize = (s: PageSnapshot): PageSummary => ({
  url: s.url,
  title: s.title,
  textLength: s.text.length,
  scrollY: s.scroll.y,
  fingerprint: computePageFingerprint(s),
});

/** Describes, in words the model can use, what an action visibly did. */
export function describeOutcome(before: PageSummary, after: PageSummary): string {
  if (after.url !== before.url) return `navigated to ${after.url}`;
  if (after.title !== before.title) return `page changed: "${after.title}"`;
  if (Math.abs(after.textLength - before.textLength) > 50) return 'page content changed (something opened, closed or loaded; same URL)';
  if (Math.abs(after.scrollY - before.scrollY) > 40) return 'scrolled';
  if (after.fingerprint !== before.fingerprint) return 'minor change on the page';
  return 'no visible change';
}

/** DONE / BLOCKED are accepted only when the independent cross-check does not contradict them. */
const GOAL_DONE_MIN = 0.5;
const STUCK_MIN = 0.5;

/**
 * Errors Chrome raises when the page navigated (or its document was replaced) while a message
 * was in flight. The action itself ran; only the reply was lost.
 */
export function isNavigationError(message: string): boolean {
  return (
    /back\/forward cache/i.test(message) ||
    /message (channel|port) (is |was )?closed/i.test(message) ||
    /Receiving end does not exist/i.test(message) ||
    /Frame was removed/i.test(message) ||
    /Extension context invalidated/i.test(message)
  );
}

const OP_BY_KIND: Record<string, string> = { click: 'CLICK', fill: 'TYPE_TEXT', select: 'SELECT', scroll: '', wait: '', key: '' };

function readNoul(answer: any): number | undefined {
  const v = answer?.noul ?? answer?.probability;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined;
}

const INTERNAL_PREFIXES = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'view-source:', 'devtools://'];

const MAX_CONSECUTIVE_STALE = 4;
/** DONE/BLOCKED below this confidence is confirmed by a second look before the run ends. */
const TERMINAL_CONFIRM_THRESHOLD = 0.5;
const DEADLOCK_RUN = 3;
/** Same target executed this many times within the last REPEAT_WINDOW actions ends the run. */
const REPEAT_LIMIT = 3;
const REPEAT_WINDOW = 6;

export class AgentRunner {
  private progress: AgentProgress = {
    status: 'idle',
    goal: '',
    currentStep: 0,
    maxSteps: DEFAULT_SETTINGS.maxSteps,
    logs: [],
  };

  private settings: AppSettings = DEFAULT_SETTINGS;
  private history: RecentAction[] = [];
  private activeTabId: number | null = null;
  private runToken = 0;
  private runStartedAt = 0;
  private decisionAbort: AbortController | null = null;
  private navigationIntent: NavigationIntent | null = null;
  private youtubeVideoFallbackUsed = false;
  private youtubePlayAttempted = false;
  private youtubeWaits = 0;
  private youtubeTitleWaits = 0;
  /** Video ID chosen from a matching search result, used to detect redirects/autoplay changes. */
  private expectedYoutubeVideoId: string | null = null;
  private taskPlan: AgentPlan | null = null;
  private planIndex = 0;
  private subgoalHistoryStart = 0;
  private taskMemory: TaskMemory | null = null;
  private visionAttempted = false;
  private unverifiedDoneCount = 0;
  private replanCount = 0;


  private lastFingerprint: string | null = null;
  private lastSummary: PageSummary | null = null;
  /** Tabs the run came from, most recent last, so a closed follow-up tab returns to its opener. */
  private tabStack: number[] = [];
  private pendingTab: { from: number; to: number; closed: boolean } | null = null;
  private tabNote: string | null = null;
  /** Trusted input via chrome.debugger; attached per run when the setting is on and permitted. */
  private input = new TrustedInput();

  constructor() {
    this.input.onCancelled = () => {
      if (this.progress.status !== 'running') return;
      this.stop();
      this.progress.lastError = 'Stopped: debugging was cancelled from the browser bar.';
      this.broadcastUpdate();
    };
    // A click may open a new tab (target=_blank, window.open). Like a person, the agent
    // follows it; when that tab closes it returns to the tab that opened it.
    try {
      chrome.tabs.onCreated.addListener((tab) => this.onTabCreated(tab));
      chrome.tabs.onRemoved.addListener((tabId) => this.onTabRemoved(tabId));
    } catch {
      // Not running inside an extension (unit tests without tab events)
    }
  }

  private onTabCreated(tab: chrome.tabs.Tab): void {
    if (this.progress.status !== 'running' || tab.id === undefined) return;
    if (this.activeTabId === null || tab.openerTabId !== this.activeTabId) return;
    this.tabStack.push(this.activeTabId);
    this.pendingTab = { from: this.activeTabId, to: tab.id, closed: false };
    this.activeTabId = tab.id;
  }

  private onTabRemoved(tabId: number): void {
    if (tabId !== this.activeTabId || this.tabStack.length === 0) return;
    const back = this.tabStack.pop()!;
    this.pendingTab = { from: tabId, to: back, closed: true };
    this.activeTabId = back;
  }

  /** Brings a newly opened (or restored) tab to the front and waits for it before observing. */
  private async followTab(): Promise<void> {
    const pending = this.pendingTab;
    if (!pending) return;
    this.pendingTab = null;
    this.lastFingerprint = null; // a different document: the previous action's outcome is "opened a tab"
    this.tabNote = pending.closed ? 'the tab closed; back on the previous tab' : 'opened a new tab and switched to it';
    await chrome.tabs.update(pending.to, { active: true }).catch(() => undefined);
    await this.waitForTabToLoad(pending.to);
    await this.attachInput(pending.to);
    this.sendStatus({ text: this.tabNote });
  }
  private startUrl = '';
  private visitedUrls: string[] = [];
  private consecutiveStale = 0;
  private decisionCount = 0;
  private targetFailureCount = new Map<string, number>();
  private lastTargetActionId: string | null = null;
  private lastStaleNotice: string | null = null;
  private pendingTerminal: string | null = null;
  private vetoed: 'DONE' | 'BLOCKED' | null = null;
  /** One inconsistent answer is asked again; a second one ends the run. */
  private invalidAnswerRetried = false;
  /** Give a high-confidence first-step BLOCKED one extra independent look without forcing a click. */
  private initialBlockReviewed = false;
  /** Text generated for a decision that turned out stale; reused only for an identical helper input. */
  private pendingText: { key: string; text: string } | null = null;

  public setSettings(settings: AppSettings): void {
    this.settings = settings;
    if (this.progress.status !== 'running') {
      this.progress.maxSteps = settings.maxSteps || DEFAULT_SETTINGS.maxSteps;
    }
  }

  public getProgress(): AgentProgress {
    return this.progress;
  }

  private reset(goal: string, tabId: number): void {
    this.runToken++;
    this.decisionAbort?.abort(new Error('Superseded by a new agent task'));
    this.decisionAbort = null;
    this.runStartedAt = Date.now();
    this.activeTabId = tabId;
    this.navigationIntent = parseNavigationIntent(goal);
    this.youtubeVideoFallbackUsed = false;
    this.youtubePlayAttempted = false;
    this.youtubeWaits = 0;
    this.youtubeTitleWaits = 0;
    this.expectedYoutubeVideoId = null;
    this.taskPlan = null;
    this.planIndex = 0;
    this.subgoalHistoryStart = 0;
    this.taskMemory = null;
    this.visionAttempted = false;
    this.unverifiedDoneCount = 0;
    this.replanCount = 0;
    this.history = [];
    this.lastFingerprint = null;
    this.lastSummary = null;
    this.tabStack = [];
    this.pendingTab = null;
    this.tabNote = null;
    this.startUrl = '';
    this.visitedUrls = [];
    this.consecutiveStale = 0;
    this.decisionCount = 0;
    this.targetFailureCount.clear();
    this.lastTargetActionId = null;
    this.lastStaleNotice = null;
    this.pendingTerminal = null;
    this.vetoed = null;
    this.invalidAnswerRetried = false;
    this.initialBlockReviewed = false;
    this.pendingText = null;
    this.progress = {
      status: 'running',
      goal,
      timing: {
        observeMs: 0, decisionMs: 0, textHelperMs: 0, actionMs: 0,
        waitMs: 0, startupMs: 0, totalMs: 0, decisionCalls: 0,
        currentPhase: 'starting',
      },
      currentStep: 0,
      maxSteps: this.settings.maxSteps || DEFAULT_SETTINGS.maxSteps,
      logs: [],
    };
  }

  /** Fast-path for media transport: act ONCE and verify a changed video ID. */
  private async tryDirectMedia(token: number): Promise<boolean> {
    const tabId = this.activeTabId;
    if (tabId === null) return false;
    const tab = await chrome.tabs.get(tabId);
    const intent = routeDirectIntent(this.progress.goal, tab.url || '');
    if (!intent) return false;
    this.setPhase('acting');
    const started = Date.now();
    try {
      await this.ensureContentScriptReady(tabId);
      if (token !== this.runToken) return true;
      const result = await runYoutubeMediaSkill(
        tabId, intent, this.input, this.settings.trustedInput,
        () => token !== this.runToken || this.progress.status !== 'running'
      );
      if (token !== this.runToken) return true;
      this.recordTime('actionMs', Date.now() - started);
      this.progress.verification = { ok: result.ok, reason: result.reason };
      if (result.ok) {
        this.progress.currentStep++;
        this.addLog({
          step: this.progress.currentStep, timestamp: Date.now(),
          operation: 'MEDIA_' + intent.command.toUpperCase(),
          targetLabel: result.beforeId + ' -> ' + result.afterId,
          latencyMs: result.elapsedMs, provider: 'browser'
        });
        this.finish('done');
      } else {
        this.finish('blocked', result.reason);
      }
    } catch (error: any) {
      if (token === this.runToken) this.finish('error', 'Media control: ' + (error?.message || String(error)));
    }
    return true;
  }

  /** Planner is best-effort: unsupported Chrome AI never prevents Jev fallback. */
  private async prepareTaskPlan(token: number): Promise<void> {
    const tabId = this.activeTabId;
    if (!this.settings.plannerEnabled || this.navigationIntent || tabId === null ||
        !chrome.storage?.local) return;
    this.taskMemory = await readTaskMemory(tabId);
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url?.startsWith('http')) return;
    try {
      await this.ensureContentScriptReady(tabId);
      const observed = await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_OBSERVE' });
      if (!observed?.success || !observed.snapshot) return;
      const shot = observed.snapshot as PageSnapshot;
      const controller = new AbortController();
      this.decisionAbort = controller;
      this.setPhase('deciding');
      if (this.progress.plannerCalls === undefined) this.progress.plannerCalls = 0;
      this.progress.plannerCalls++;
      const start = Date.now();
      try {
        const plan = await planWithChatAI(this.progress.goal, {
          url: shot.url, title: shot.title, text: shot.text,
          controls: shot.actions.map(a => a.label),
        }, this.taskMemory, controller.signal);
        if (token !== this.runToken) return;
        this.taskPlan = plan;
        this.planIndex = 0;
        this.subgoalHistoryStart = 0;
        this.progress.plan = {
          steps: plan.subgoals, activeIndex: 0, successCriteria: plan.successCriteria,
          source: 'chat_ai'
        };
        this.addLog({
          step: this.progress.currentStep, timestamp: Date.now(),
          operation: 'PLAN', targetLabel: plan.subgoals.join(' -> ').slice(0, 180),
          provider: 'browser', latencyMs: Date.now() - start
        });
      } finally {
        if (this.decisionAbort === controller) this.decisionAbort = null;
      }
    } catch (error) {
      // For a local 1B model a planner may be unsupported. Jev still works.
      this.progress.plan = {
        steps: [this.progress.goal], activeIndex: 0,
        successCriteria: 'Observable state change', source: 'fallback'
      };
      this.progress.verification = { ok: false, reason: 'Planner unavailable; using Jev: ' +
        (error instanceof Error ? error.message : String(error)).slice(0, 170) };
    }
    this.broadcastUpdate();
  }

  private async tryReplan(snapshot: PageSnapshot, token: number): Promise<boolean> {
    if (!this.taskPlan || this.replanCount >= 1 || !this.settings.plannerEnabled ||
        !chrome.storage?.local) return false;
    this.replanCount++;
    this.progress.replans = this.replanCount;
    try {
      const controller = new AbortController();
      this.decisionAbort = controller;
      const plan = await planWithChatAI(this.progress.goal + ' (previous attempt was blocked; find another safe approach)',
        { url: snapshot.url, title: snapshot.title, text: snapshot.text,
          controls: snapshot.actions.map(a => a.label) }, this.taskMemory, controller.signal);
      if (this.decisionAbort === controller) this.decisionAbort = null;
      if (token !== this.runToken) return false;
      this.taskPlan = plan;
      this.planIndex = 0;
      this.subgoalHistoryStart = this.history.length;
      this.progress.plan = {
        steps: plan.subgoals, activeIndex: 0, successCriteria: plan.successCriteria,
        source: 'chat_ai'
      };
      this.vetoed = null;
      this.pendingTerminal = null;
      this.initialBlockReviewed = false;
      this.lastStaleNotice = 'A new plan was prepared after BLOCKED. Try the next safe subgoal.';
      this.broadcastUpdate();
      return true;
    } catch {
      this.decisionAbort = null;
      return false;
    }
  }

  /** Opt-in vision can suggest ONLY an already observed safe DOM control. */
  private async tryVision(snapshot: PageSnapshot, tabId: number, token: number): Promise<boolean> {
    if (!this.settings.visionFallback || this.visionAttempted || !chrome.storage?.local) return false;
    this.visionAttempted = true;
    const controller = new AbortController();
    this.decisionAbort = controller;
    try {
      this.setPhase('deciding');
      const hint = await suggestVisionAction(tabId, this.progress.goal, snapshot, controller.signal);
      if (!hint || token !== this.runToken) return false;
      const policy = checkObservedTarget(hint.action, this.progress.goal);
      if (!policy.allowed) return false;
      this.setPhase('acting');
      const result = await this.act(tabId, hint.action);
      if (!result.ok || token !== this.runToken) return false;
      this.history.push({
        step: this.progress.currentStep + 1,
        action: 'CLICK ' + hint.action.label,
        kind: 'click', page_changed: undefined
      });
      this.progress.currentStep++;
      this.lastTargetActionId = hint.action.id;
      this.addLog({
        step: this.progress.currentStep, timestamp: Date.now(),
        operation: 'VISION (verified DOM target)', targetId: hint.action.id,
        targetLabel: hint.action.label, confidence: hint.confidence,
        provider: 'browser', latencyMs: 0
      });
      this.broadcastUpdate();
      return true;
    } catch {
      return false;
    } finally {
      if (this.decisionAbort === controller) this.decisionAbort = null;
    }
  }

  /**
   * Navigate only to a destination explicitly named by the user, before Jev
   * observes the page. A model cannot invent this URL from site content.
   */
  private async applyInitialNavigation(token: number): Promise<boolean> {
    const intent = this.navigationIntent;
    const tabId = this.activeTabId;
    if (!intent || tabId === null) return false;

    const current = await chrome.tabs.get(tabId);
    if (current.url === intent.url) return false;
    const started = Date.now();
    this.setPhase('acting');
    this.sendStatus({ text: intent.searchQuery
      ? `Opening YouTube search for "${intent.searchQuery}"...`
      : `Opening ${intent.hostname}...` });
    await this.input.detach();
    await chrome.tabs.update(tabId, { url: intent.url });
    await this.waitForTabToLoad(tabId);
    if (token !== this.runToken) return false;

    const arrived = await chrome.tabs.get(tabId);
    if (!arrived.url) throw new Error('The destination has no URL after navigation.');
    const actual = new URL(arrived.url);
    const requested = new URL(intent.url);
    // Only mark the planned navigation as successful on the correct site.
    const matchingSite = actual.hostname === requested.hostname ||
      (intent.searchQuery && ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(actual.hostname));
    if (!matchingSite) throw new Error(`Navigation redirected to another site: ${actual.hostname}`);

    this.progress.currentStep++;
    this.recordTime('actionMs', Date.now() - started);
    this.addLog({
      step: this.progress.currentStep,
      operation: intent.searchQuery ? 'SEARCH (navigate)' : 'NAVIGATE',
      targetLabel: arrived.url,
      timestamp: Date.now(),
      provider: 'browser',
      latencyMs: Date.now() - started,
    });
    this.broadcastUpdate();
    return true;
  }

  public async start(goal: string, tabId: number): Promise<void> {
    if (this.progress.status === 'running') return;
    this.reset(goal, tabId);
    const token = this.runToken;
    this.broadcastUpdate();
    const startup = Date.now();
    try {
      if (await this.tryDirectMedia(token)) return;
      await this.applyInitialNavigation(token);
      if (token !== this.runToken) return;
      if (this.navigationIntent?.navigationOnly) {
        this.finish('done');
        return;
      }
      await this.prepareTaskPlan(token);
      if (token !== this.runToken) return;
      await this.attachInput(tabId);
      this.recordTime('startupMs', Date.now() - startup);
      await this.loop(token);
    } catch (error: any) {
      if (token === this.runToken) {
        this.finish('error', `Navigation/startup failed: ${error?.message || String(error)}`);
      }
    }
  }

  /** Executes exactly one step. A new goal, or a finished run, starts over; a paused run continues. */
  public async step(goal: string, tabId: number): Promise<void> {
    if (this.progress.status === 'running') return;
    const continuing = this.progress.status === 'paused' && goal === this.progress.goal && tabId === this.activeTabId;
    if (!continuing) {
      this.reset(goal, tabId);
    } else {
      this.runToken++;
      this.progress.status = 'running';
    }
    const token = this.runToken;

    if (this.progress.currentStep >= this.progress.maxSteps) {
      this.finish('blocked', `Reached the ${this.progress.maxSteps}-step budget.`);
      return;
    }

    this.broadcastUpdate();
    const startup = Date.now();
    try {
      if (!continuing) {
        if (await this.tryDirectMedia(token)) return;
        const navigated = await this.applyInitialNavigation(token);
        if (token !== this.runToken) return;
        if (this.navigationIntent?.navigationOnly) {
          this.finish('done');
          return;
        }
        // A single-step request performs either navigation or a page action,
        // never both in one click of the Step button.
        if (navigated) {
          this.progress.status = 'paused';
          this.broadcastUpdate();
          return;
        }
      }
      if (!continuing) await this.prepareTaskPlan(token);
      if (token !== this.runToken) return;
      await this.attachInput(tabId);
      this.recordTime('startupMs', Date.now() - startup);
      const cont = await this.executeOneStep(token);
      if (token === this.runToken && this.progress.status === 'running') {
        this.progress.status = cont ? 'paused' : 'idle';
      }
      if (this.progress.status !== 'running') void this.input.detach();
      this.broadcastUpdate();
    } catch (error: any) {
      if (token === this.runToken) {
        this.finish('error', `Navigation/startup failed: ${error?.message || String(error)}`);
      }
    }
  }

  public stop(): void {
    this.runToken++;
    this.decisionAbort?.abort(new Error('Stopped by user'));
    this.decisionAbort = null;
    void this.input.detach();
    if (this.progress.status === 'running' || this.progress.status === 'paused') {
      this.progress.status = 'idle';
    }
    if (this.progress.timing) this.progress.timing.currentPhase = 'finished';
    this.broadcastUpdate();
    this.sendStatus({ clear: true });
  }

  private async loop(token: number): Promise<void> {
    while (token === this.runToken && this.progress.status === 'running') {
      if (this.progress.currentStep >= this.progress.maxSteps) {
        this.finish('blocked', `Reached the ${this.progress.maxSteps}-step budget without DONE.`);
        break;
      }
      const stepBefore = this.progress.currentStep;
      const cont = await this.executeOneStep(token);
      if (!cont) break;
      // Only throttle after a real browser action. Pure decision rechecks should not sleep.
      if (this.settings.stepDelayMs > 0 && this.progress.currentStep > stepBefore) {
        this.setPhase('waiting');
        const delay = Math.min(5000, this.settings.stepDelayMs);
        const beforeWait = Date.now();
        await new Promise((resolve) => setTimeout(resolve, delay));
        this.recordTime('waitMs', Date.now() - beforeWait);
      }
    }
  }

  /** Resolves when the tab finishes loading, or after a timeout. */
  private async waitForTabToLoad(tabId: number, timeoutMs = 8000): Promise<void> {
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      };
      const listener = (updatedTabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
      };
      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs
        .get(tabId)
        .then((tab) => {
          if (tab.status === 'complete') finish();
        })
        .catch(() => finish());
      setTimeout(finish, timeoutMs);
    });
    // Let the new document run its first frames before observing.
    await new Promise((r) => setTimeout(r, 150));
  }

  private lastPingError = '';

  private async ping(tabId: number): Promise<boolean> {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      return !!res?.pong;
    } catch (err: any) {
      this.lastPingError = err?.message || String(err);
      return false;
    }
  }

  /** Makes sure a single content script instance is listening in the tab. */
  private async ensureContentScriptReady(tabId: number): Promise<void> {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || '';
    if (INTERNAL_PREFIXES.some((p) => url.startsWith(p))) {
      throw new Error(
        `Cannot run on internal browser page (${url}). Open a regular web page and try again.`
      );
    }
    // Inject as soon as a document exists instead of waiting for the load event: the script
    // guards against double registration, so a later manifest injection is harmless.
    let injectError = '';
    for (let attempt = 0; attempt < 6; attempt++) {
      if (await this.ping(tabId)) return;
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      } catch (err: any) {
        injectError = err?.message || String(err);
      }
      const current = attempt >= 3 ? await chrome.tabs.get(tabId).catch(() => null) : null;
      if (current?.status === 'loading') await this.waitForTabToLoad(tabId, 2000);
      else await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
    if (!(await this.ping(tabId))) {
      throw new Error(
        `Content script did not respond after injection (${this.lastPingError || 'no reply'}${injectError ? `; inject: ${injectError}` : ''}). Reload the page and try again.`
      );
    }
  }

  /**
   * A YouTube music task is complete only if the actual HTML video is playing.
   * DOM inspection and playback are limited to YouTube watch pages and an
   * explicit user request to play. We never assume that opening a result = play.
   */
  private async verifyYoutubePlayback(tabId: number, snapshot: PageSnapshot, token: number): Promise<boolean | null> {
    const intent = this.navigationIntent;
    if (!intent?.searchQuery || !isYoutubeWatchPage(snapshot.url)) return null;
    if (!intent.playVideo) {
      this.finish('done');
      return false;
    }

    const media = await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_MEDIA_STATUS' })
      .catch(() => null) as { found?: boolean; playing?: boolean; paused?: boolean; videoTitle?: string } | null;
    if (token !== this.runToken) return false;

    if (this.expectedYoutubeVideoId && watchVideoId(snapshot.url) !== this.expectedYoutubeVideoId) {
      this.finish('blocked', 'YouTube changed to a different video after the selected result. The requested song was not verified.');
      return false;
    }

    if (!media?.found) {
      if (++this.youtubeWaits <= 8) {
        this.setPhase('waiting');
        await new Promise(resolve => setTimeout(resolve, 400));
        return true;
      }
      this.finish('blocked', 'YouTube watch page loaded, but no HTML video element appeared. Check sign-in, consent or page loading.');
      return false;
    }

    // A video playing is NOT proof that it is the requested track. Wait for
    // YouTube's watch-title metadata and compare the full, accent-insensitive
    // title before playing or marking the goal DONE.
    if (intent.requestedTitle) {
      const actualTitle = media.videoTitle?.trim() || '';
      if (!actualTitle) {
        if (++this.youtubeTitleWaits <= 8) {
          this.setPhase('waiting');
          await new Promise(resolve => setTimeout(resolve, 350));
          return token === this.runToken;
        }
        this.finish('blocked', `Cannot verify the requested song "${intent.requestedTitle}": YouTube did not expose the playing video title. Not marking DONE.`);
        return false;
      }
      if (!titleMatchesRequestedSong(actualTitle, intent.requestedTitle)) {
        this.finish('blocked', `The opened video is "${actualTitle}", but you requested "${intent.requestedTitle}". Refusing to report success or play the wrong song.`);
        return false;
      }
    }

    if (media.playing) {
      this.addLog({
        step: this.progress.currentStep, timestamp: Date.now(),
        operation: 'VERIFY_PLAYING',
        targetLabel: intent.requestedTitle
          ? `Verified "${media.videoTitle}" is playing`
          : 'YouTube video is playing',
        provider: 'browser', latencyMs: 0,
      });
      this.finish('done');
      return false;
    }

    if (!this.youtubePlayAttempted) {
      this.youtubePlayAttempted = true;
      this.setPhase('acting');
      const start = Date.now();
      const button = snapshot.actions.find(a =>
        a.kind === 'click' && a.role === 'button' &&
        /^(?:play|phát|bật video|resume)(?:\s|$|\()/iu.test(a.label.trim())
      );
      let ok = false;
      let reason = '';
      try {
        if (button) {
          const result = await this.act(tabId, button);
          ok = result.ok;
          if (!result.ok) reason = result.message;
        } else {
          // Prefer a trusted mouse click on the unobstructed video surface;
          // it carries genuine user activation. Synthetic video.play() often
          // fails with Chrome's autoplay policy even when the user asked to play.
          if (this.settings.trustedInput && this.input.attachedTab !== tabId) {
            await this.attachInput(tabId);
          }
          if (this.input.attachedTab === tabId) {
            const point = await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_MEDIA_RECT' })
              .catch(() => null) as { safe?: boolean; x?: number; y?: number } | null;
            if (point?.safe && typeof point.x === 'number' && typeof point.y === 'number') {
              await this.input.click(point.x, point.y);
              ok = true;
            }
          }
          if (!ok) {
            const result = await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_MEDIA_PLAY' });
            ok = result?.success === true;
            reason = result?.error || '';
          }
        }
      } catch (error: any) {
        reason = error?.message || String(error);
      }
      this.recordTime('actionMs', Date.now() - start);
      if (token !== this.runToken) return false;
      if (!ok) {
        this.finish('blocked', 'Could not start YouTube playback' + (reason ? ': ' + reason : '') +
          '. The browser may require a direct user gesture.');
        return false;
      }
      this.progress.currentStep++;
      this.addLog({ step: this.progress.currentStep, timestamp: Date.now(),
        operation: 'PLAY_VIDEO', targetLabel: 'YouTube player', provider: 'browser', latencyMs: Date.now() - start });
      this.broadcastUpdate();
      this.youtubeWaits = 0;
      return true;
    }

    if (++this.youtubeWaits <= 4) {
      this.setPhase('waiting');
      await new Promise(resolve => setTimeout(resolve, 300));
      return true;
    }
    this.finish('blocked', 'YouTube video is still paused after the play attempt. Click Play manually; autoplay may be restricted.');
    return false;
  }

  private async openYoutubeResult(tabId: number, snapshot: PageSnapshot, token: number): Promise<boolean | null> {
    const intent = this.navigationIntent;
    if (!intent?.searchQuery || !isYoutubeResultPage(snapshot.url) || this.youtubeVideoFallbackUsed) return null;
    const action = suggestYoutubeVideo(snapshot, intent.searchQuery, intent.requestedTitle);
    if (!action) return null;

    this.youtubeVideoFallbackUsed = true;
    this.setPhase('acting');
    const start = Date.now();
    this.sendStatus({ text: 'Opening a matching YouTube video from search results...' });
    let navigated = false;
    try {
      const result = await this.act(tabId, action);
      if (!result.ok) {
        this.finish('blocked', 'Could not open the YouTube video result: ' + result.message);
        return false;
      }
    } catch (error: any) {
      if (!isNavigationError(error?.message || String(error))) {
        this.finish('blocked', 'Could not open YouTube video: ' + (error?.message || String(error)));
        return false;
      }
      navigated = true;
    }
    this.recordTime('actionMs', Date.now() - start);
    if (token !== this.runToken) return false;
    this.expectedYoutubeVideoId = watchVideoId(action.href || '', snapshot.url);
    this.history.push({
      step: this.progress.currentStep + 1,
      action: 'CLICK ' + action.label,
      kind: 'click',
      page_changed: undefined,
    });
    this.progress.currentStep++;
    this.lastTargetActionId = action.id;
    this.addLog({
      step: this.progress.currentStep, timestamp: Date.now(),
      operation: 'CLICK (YouTube recovery)',
      targetId: action.id, targetLabel: action.label,
      latencyMs: Date.now() - start, provider: 'browser',
    });
    this.broadcastUpdate();
    if (navigated || (await chrome.tabs.get(tabId).catch(() => null))?.status === 'loading') {
      await this.waitForTabToLoad(tabId);
    }
    return true;
  }

  /**
   * One observe → decide → act cycle. Returns false when the run has ended.
   * A stale decision is discarded and the page is observed again without recording a step.
   */
  private async executeOneStep(token: number): Promise<boolean> {
    await this.followTab();
    const tabId = this.activeTabId;
    if (tabId === null) {
      this.finish('error', 'No active tab identified');
      return false;
    }

    // 1. Observe
    this.setPhase('observing');
    const observeStart = Date.now();
    let snapshot: PageSnapshot;
    try {
      await this.ensureContentScriptReady(tabId);
      const response = await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_OBSERVE' });
      if (!response?.success || !response.snapshot) {
        throw new Error(response?.error || 'Failed to capture page DOM snapshot');
      }
      snapshot = response.snapshot;
    } catch (err: any) {
      this.recordTime('observeMs', Date.now() - observeStart);
      this.finish('error', `Observe failed: ${err?.message || String(err)}`);
      return false;
    }
    this.recordTime('observeMs', Date.now() - observeStart);
    if (token !== this.runToken) return false;
    // Diagnostic summary helps explain BLOCKED at step 0, without exposing full page contents.
    const interactiveActions = snapshot.actions.filter((a) =>
      a.kind === 'click' || a.kind === 'fill' || a.kind === 'select'
    );
    this.progress.observation = {
      url: snapshot.url,
      title: snapshot.title,
      visibleActions: snapshot.actions.length,
      interactiveActions: interactiveActions.length,
      omittedActions: snapshot.omitted_actions,
      scrollDownAvailable: snapshot.actions.some((a) => a.id === 'scroll_down'),
      candidateLabels: [...new Set(interactiveActions.map((a) => a.label))].slice(0, 12),
    };
    this.broadcastUpdate();

    // YouTube loads results asynchronously. Avoid giving an empty page to the
    // small Jev model and immediately receiving a false BLOCKED decision.
    if (this.navigationIntent?.searchQuery && isYoutubeResultPage(snapshot.url)) {
      if (!suggestYoutubeVideo(snapshot, this.navigationIntent.searchQuery, this.navigationIntent.requestedTitle) && this.youtubeWaits++ < 5) {
        this.setPhase('waiting');
        await new Promise(resolve => setTimeout(resolve, 400));
        return token === this.runToken;
      }
      this.youtubeWaits = 0;
    }
    const playbackResult = await this.verifyYoutubePlayback(tabId, snapshot, token);
    if (playbackResult !== null) return playbackResult;

    // The explicit instruction to find AND play a YouTube video authorizes
    // opening one matching visible result. Do not ask a small Jev model to
    // re-type an already populated search box (especially when Text Helper
    // is not configured). This action is limited to verified /watch links.
    if (this.navigationIntent?.searchQuery && this.navigationIntent.playVideo && isYoutubeResultPage(snapshot.url)) {
      const result = await this.openYoutubeResult(tabId, snapshot, token);
      if (result !== null) return result;
    }

    // 2. Resolve what the previous action did and detect deadlocks
    const summary = summarize(snapshot);
    const fingerprint = summary.fingerprint;
    if (!this.startUrl) this.startUrl = snapshot.url;
    if (this.visitedUrls[this.visitedUrls.length - 1] !== snapshot.url) this.visitedUrls.push(snapshot.url);
    const last = this.history[this.history.length - 1];
    if (last && last.page_changed === undefined && this.tabNote) {
      last.outcome = `${this.tabNote}: ${snapshot.url}`;
      last.url = snapshot.url;
      last.page_changed = true;
      this.tabNote = null;
    } else if (last && last.page_changed === undefined && this.lastSummary) {
      last.outcome = describeOutcome(this.lastSummary, summary);
      last.url = snapshot.url;
      last.page_changed = fingerprint !== this.lastFingerprint;
      if (!last.page_changed && this.lastTargetActionId && last.kind !== 'wait') {
        const count = (this.targetFailureCount.get(this.lastTargetActionId) || 0) + 1;
        this.targetFailureCount.set(this.lastTargetActionId, count);
      } else if (last.page_changed) {
        this.targetFailureCount.clear();
      }
    }
    this.lastFingerprint = fingerprint;
    this.lastSummary = summary;

    const recent = this.history.slice(-DEADLOCK_RUN);
    if (
      recent.length === DEADLOCK_RUN &&
      recent.every((h) => h.page_changed === false && h.kind !== 'wait')
    ) {
      this.finish(
        'blocked',
        `${DEADLOCK_RUN} consecutive actions produced no change on the page. Inspect the page or adjust the goal.`
      );
      return false;
    }

    // 3. Loop feedback for the model. Toggling the same control (a menu that opens and closes)
    //    changes the page every time, so repeats are tracked separately from "no change".
    let warning: string | undefined;
    const repeatedAction = last?.action && last.kind !== 'wait' ? last.action : null;
    const repeated = repeatedAction ? this.repeatCount(repeatedAction) : 0;
    if (repeated >= REPEAT_LIMIT) {
      this.finish('blocked', `The same action "${repeatedAction}" was repeated ${repeated} times without reaching the goal.`);
      return false;
    }
    const suppressedTargetIds = Array.from(this.targetFailureCount.entries())
      .filter(([, count]) => count >= 2)
      .map(([id]) => id);
    if (last && last.page_changed === false && last.kind !== 'wait') {
      warning = `ATTENTION: Previous action "${last.action}" resulted in NO visible change on the page. Do NOT repeat the exact same action. Try an alternative target, scroll, or submit button.`;
    } else if (repeated >= 2 && repeatedAction) {
      warning = `ATTENTION: "${repeatedAction}" has now been executed ${repeated} times and did not advance the goal. Do NOT choose it again; use a different control that moves toward the goal.`;
      // Ids are per snapshot; withhold whatever on this page carries the same operation and label.
      for (const a of snapshot.actions) {
        if (a.node !== undefined && `${OP_BY_KIND[a.kind] || ''} ${a.label}` === repeatedAction) suppressedTargetIds.push(a.id);
      }
    } else if (this.lastStaleNotice) {
      warning = this.lastStaleNotice;
    }
    this.lastStaleNotice = null;

    // 4. Decide
    if (this.decisionCount >= this.progress.maxSteps * 2) {
      this.finish('blocked', 'Reached the model-call budget for this run.');
      return false;
    }
    const swaggerSuggestion = this.history.length === 0
      ? suggestSwaggerGetOperation(snapshot, this.progress.goal)
      : null;
    if (swaggerSuggestion && !warning) {
      warning = `Swagger API hint: ${swaggerSuggestion.hint} A visible GET route is a valid next step; BLOCKED is premature when it can be opened.`;
    }
    const { request, actionSpace } = buildJevRequest(
      activeJevModel(this.settings),
      snapshot,
      this.navigationIntent?.modelGoal || this.taskPlan?.subgoals[this.planIndex] || this.progress.goal,
      this.history,
      { warning, suppressedTargetIds },
      { start_url: this.startUrl, steps_taken: this.history.length, visited_urls: this.visitedUrls.slice(-6) }
    );
    if (this.vetoed) {
      // The previous verdict was contradicted by its cross-check; withhold it this time.
      delete actionSpace.operations[this.vetoed];
      delete (request.questions.operation as ChoiceQuestion).criteria[this.vetoed];
      this.vetoed = null;
    }

    this.setPhase('deciding');
    const started = Date.now();
    if (this.progress.timing) {
      const local = this.settings.activeProvider === 'typesafe' &&
        isLocalSystemOneEndpoint(this.settings.typesafe.endpoint);
      const sent = local ? toLocalSystemOneRequest(request) : request;
      this.progress.timing.lastRequestBytes = new TextEncoder().encode(JSON.stringify(sent)).length;
    }
    const decisionController = new AbortController();
    this.decisionAbort = decisionController;
    let jevResponse;
    try {
      this.decisionCount++;
      if (this.progress.timing) this.progress.timing.decisionCalls++;
      jevResponse = await callJevProvider(this.settings, request, decisionController.signal, true);
    } catch (err: any) {
      this.recordTime('decisionMs', Date.now() - started);
      if (token !== this.runToken) return false;
      this.finish('error', `Jev decision failed: ${err?.message || String(err)}`);
      return false;
    } finally {
      if (this.decisionAbort === decisionController) this.decisionAbort = null;
    }
    const latencyMs = Date.now() - started;
    this.recordTime('decisionMs', latencyMs);
    if (this.progress.timing) this.progress.timing.lastDecisionMs = latencyMs;
    if (token !== this.runToken) return false;

    let operationAnswer;
    try {
      operationAnswer = validateChoiceAnswer(jevResponse.answers?.operation, actionSpace.operations);
    } catch (err: any) {
      return this.rejectAnswer(`Invalid operation choice: ${err?.message || String(err)}`);
    }
    const operation = operationAnswer.choice;
    const provider = this.settings.activeProvider;
    const goalDone = readNoul(jevResponse.answers?.goal_done);
    const stuck = readNoul(jevResponse.answers?.stuck);

    // A YouTube search-results page is not evidence that the requested music
    // is playing. If the decision model says DONE here, use a verified video
    // result link instead of falsely marking the task complete.
    if (operation === 'DONE' && this.navigationIntent?.searchQuery && isYoutubeResultPage(snapshot.url)) {
      const recovery = await this.openYoutubeResult(tabId, snapshot, token);
      if (recovery !== null) return recovery;
      this.vetoed = 'DONE';
      this.lastStaleNotice = 'The user requested a video; search results alone are not DONE. Open a /watch?v= video.';
      this.broadcastUpdate();
      return true;
    }

    if (operation === 'DONE') {
      const goal = this.taskPlan?.subgoals[this.planIndex] || this.progress.goal;
      const checked = verifyGenericDone(goal, snapshot, this.history.slice(this.subgoalHistoryStart));
      this.progress.verification = { ok: checked.verified, reason: checked.reason };
      if (!checked.verified) {
        this.unverifiedDoneCount++;
        this.addLog({
          step: this.progress.currentStep, timestamp: Date.now(),
          operation: 'DONE (unverified)', targetLabel: checked.reason,
          confidence: operationAnswer.confidence, provider,
          latencyMs, goalDone, stuck
        });
        if (this.unverifiedDoneCount >= 2) {
          this.finish('blocked', 'Refused an unverified DONE: ' + checked.reason);
          return false;
        }
        this.vetoed = 'DONE';
        this.lastStaleNotice = 'Do not finish yet. Verification failed: ' + checked.reason;
        this.broadcastUpdate();
        return true;
      }
      if (this.taskPlan && this.planIndex + 1 < this.taskPlan.subgoals.length) {
        this.planIndex++;
        this.subgoalHistoryStart = this.history.length;
        this.unverifiedDoneCount = 0;
        this.initialBlockReviewed = false;
        this.pendingTerminal = null;
        if (this.progress.plan) this.progress.plan.activeIndex = this.planIndex;
        this.addLog({
          step: this.progress.currentStep, timestamp: Date.now(),
          operation: 'SUBGOAL_VERIFIED', targetLabel: checked.reason,
          latencyMs: 0, provider: 'browser'
        });
        this.broadcastUpdate();
        return true;
      }
    }

    if (operation === 'DONE' && goalDone !== undefined && goalDone < GOAL_DONE_MIN) {
      this.vetoed = 'DONE';
      this.lastStaleNotice = `ATTENTION: DONE was proposed, but the independent goal check says the task is not achieved yet (probability ${goalDone.toFixed(2)}). Something in the task is still missing; act on it.`;
      this.addLog({ step: this.progress.currentStep, timestamp: Date.now(), operation: 'DONE (vetoed)', confidence: operationAnswer.confidence, latencyMs, provider, probabilities: operationAnswer.probabilities, goalDone, stuck });
      this.broadcastUpdate();
      return true;
    }
    if (operation === 'BLOCKED' && stuck !== undefined && stuck < STUCK_MIN && this.history.length < REPEAT_WINDOW) {
      this.vetoed = 'BLOCKED';
      this.lastStaleNotice = `ATTENTION: BLOCKED was proposed, but the independent progress check does not see a dead end (stuck probability ${stuck.toFixed(2)}). Choose a control that moves toward the task.`;
      this.addLog({ step: this.progress.currentStep, timestamp: Date.now(), operation: 'BLOCKED (vetoed)', confidence: operationAnswer.confidence, latencyMs, provider, probabilities: operationAnswer.probabilities, goalDone, stuck });
      this.broadcastUpdate();
      return true;
    }

    if (
      operation === 'BLOCKED' &&
      this.history.length === 0 &&
      !this.initialBlockReviewed &&
      (interactiveActions.length > 0 || this.progress.observation?.scrollDownAvailable)
    ) {
      // Jev can prematurely say BLOCKED on collapsed API docs even when useful navigation
      // is available. Ask for a second opinion, but retain BLOCKED as a valid choice:
      // we must not force a random or potentially destructive click.
      this.initialBlockReviewed = true;
      const example = swaggerSuggestion?.action.label || (this.progress.observation?.candidateLabels || []).slice(0, 6).join(', ');
      this.lastStaleNotice =
        `RECHECK FIRST-STEP BLOCKED: no browser action was attempted yet. ` +
        `Visible controls include: ${example || '(no buttons)'}. ` +
        `If a relevant control or SCROLL_DOWN advances the user's goal, choose it. ` +
        `Otherwise choose BLOCKED again. Never click unrelated or destructive controls.`;
      this.addLog({
        step: 0,
        timestamp: Date.now(),
        operation: 'BLOCKED (initial review)',
        confidence: operationAnswer.confidence,
        latencyMs,
        provider,
        probabilities: operationAnswer.probabilities,
        goalDone,
        stuck,
      });
      this.broadcastUpdate();
      this.sendStatus({ text: 'Checking initial BLOCKED decision...', latencyMs });
      return true;
    }

    if (
      operation === 'BLOCKED' &&
      this.initialBlockReviewed &&
      this.navigationIntent?.searchQuery &&
      isYoutubeResultPage(snapshot.url)
    ) {
      const recovery = await this.openYoutubeResult(tabId, snapshot, token);
      if (recovery !== null) return recovery;
      this.finish('blocked', this.navigationIntent.requestedTitle
        ? `Không tìm thấy video có tên đầy đủ "${this.navigationIntent.requestedTitle}" trong các kết quả đang hiển thị. Lumi không mở bài không liên quan; hãy thử cuộn thêm hoặc tìm theo tên nghệ sĩ.`
        : 'YouTube search completed, but no matching playable video is currently visible. Try scrolling or refining the search.');
      return false;
    }

    if (
      operation === 'BLOCKED' &&
      this.history.length === 0 &&
      this.initialBlockReviewed &&
      swaggerSuggestion
    ) {
      // A specific, matching Swagger GET accordion is visible. Opening it
      // changes the documentation UI only; never click Try it out / Execute
      // via this fallback, and never use it for POST/PATCH/DELETE operations.
      const action = swaggerSuggestion.action;
      this.setPhase('acting');
      const fastActStart = Date.now();
      this.sendStatus({ text: 'Opening Swagger documentation for ' + swaggerSuggestion.path, latencyMs });
      try {
        const result = await this.act(tabId, action);
        if (token !== this.runToken) return false;
        if (!result.ok) {
          this.finish('blocked', 'Could not open Swagger GET ' + swaggerSuggestion.path + ': ' + result.message);
          return false;
        }
      } catch (error: any) {
        this.finish('blocked', 'Could not open Swagger GET ' + swaggerSuggestion.path + ': ' +
          (error?.message || String(error)));
        return false;
      } finally {
        this.recordTime('actionMs', Date.now() - fastActStart);
      }
      this.history.push({
        step: 1,
        action: 'CLICK ' + action.label,
        kind: 'click',
        page_changed: undefined,
      });
      this.progress.currentStep = 1;
      this.lastTargetActionId = action.id;
      this.pendingTerminal = null;
      this.lastStaleNotice =
        'A matching Swagger GET endpoint section was clicked. Inspect the updated page. ' +
        'If the section is open and the user asked to test it, proceed with "Try it out" ' +
        'and then "Execute" when available. Never assume the API call already occurred.';
      this.addLog({
        step: 1,
        timestamp: Date.now(),
        operation: 'CLICK (safe Swagger fallback)',
        targetId: action.id,
        targetLabel: action.label,
        latencyMs,
        provider,
        probabilities: operationAnswer.probabilities,
        goalDone,
        stuck,
      });
      this.broadcastUpdate();
      return true;
    }

    if (operation === 'BLOCKED' && (this.initialBlockReviewed || this.history.length > 0)) {
      if (await this.tryVision(snapshot, tabId, token)) return true;
      if (await this.tryReplan(snapshot, token)) return true;
    }

    if (operation === 'DONE' || operation === 'BLOCKED') {
      if (operationAnswer.confidence < TERMINAL_CONFIRM_THRESHOLD && this.pendingTerminal !== operation && !(operation === 'BLOCKED' && this.initialBlockReviewed)) {
        // A hesitant verdict gets one more look after the page settles; only a repeat ends the run.
        this.pendingTerminal = operation;
        this.sendStatus({ text: operation === 'DONE' ? 'Checking whether the task is complete…' : 'Checking for another way forward…', latencyMs });
        await new Promise((r) => setTimeout(r, 120));
        return true;
      }
      this.addLog({
        step: this.progress.currentStep,
        timestamp: Date.now(),
        operation,
        confidence: operationAnswer.confidence,
        latencyMs,
        provider,
        probabilities: operationAnswer.probabilities,
        goalDone,
        stuck,
      });
      if (operation === 'BLOCKED') {
        const observed = this.progress.observation;
        const candidateList = (observed?.candidateLabels || []).slice(0, 6).join(', ') || 'none';
        const confidence = Math.round(operationAnswer.confidence * 100);
        const stuckDetail = stuck === undefined
          ? 'no stuck score returned'
          : `stuck score ${Math.round(stuck * 100)}%`;
        const firstStep = this.progress.currentStep === 0 ? ' before any page actions.' : '.';
        const message =
          `Jev selected BLOCKED${firstStep} ` +
          `Confidence ${confidence}%, ${stuckDetail}. ` +
          `Visible interactive actions: ${observed?.interactiveActions ?? 0}; ` +
          `scroll-down available: ${observed?.scrollDownAvailable ? 'yes' : 'no'}. ` +
          `Sample targets: ${candidateList}. ` +
          'This is a model decision, not proof that the API or page is inaccessible.';
        this.finish('blocked', message);
      } else {
        this.finish('done');
      }
      this.sendStatus({ text: operation === 'DONE' ? 'Done' : 'Blocked (see Lumi diagnostics)', latencyMs });
      return false;
    }

    this.pendingTerminal = null;

    // 5. Resolve the target from the selected operation's head only
    let targetAction: PageAction | undefined;
    let targetConfidence = operationAnswer.confidence;
    if (operation in actionSpace.targets) {
      const candidates = actionSpace.targets[operation];
      const available = Object.values(candidates);
      if (available.length === 1) {
        // Local SystemOne omits one-candidate questions (it requires >=2
        // options). The unique observed target is unambiguous.
        targetAction = available[0];
      } else {
        try {
          const targetAnswer = validateChoiceAnswer(
            jevResponse.answers?.[`${operation.toLowerCase()}_target`],
            candidates
          );
          targetAction = candidates[targetAnswer.choice];
          targetConfidence = targetAnswer.confidence;
        } catch (err: any) {
          return this.rejectAnswer(`Invalid target choice: ${err?.message || String(err)}`);
        }
      }
    } else if (operation in actionSpace.controls) {
      targetAction = actionSpace.controls[operation];
    }
    if (!targetAction) {
      this.finish('error', `Could not find target action for operation: ${operation}`);
      return false;
    }

    // Reject model-selected links that fail the user's requested song match.
    // The deterministic fallback and the LLM must obey the same constraint.
    if (operation === 'CLICK' && this.navigationIntent?.searchQuery &&
        isYoutubeResultPage(snapshot.url) && watchVideoId(targetAction.href || '', snapshot.url) &&
        !suggestYoutubeVideo({ url: snapshot.url, actions: [targetAction] },
          this.navigationIntent.searchQuery, this.navigationIntent.requestedTitle)) {
      this.targetFailureCount.set(targetAction.id, 2);
      this.lastStaleNotice = this.navigationIntent.requestedTitle
        ? `Refused "${targetAction.label}": the full requested title "${this.navigationIntent.requestedTitle}" does not match. Find an exact title or scroll.`
        : `Refused unrelated YouTube result "${targetAction.label}". Find a video that matches the search.`;
      this.addLog({
        step: this.progress.currentStep, timestamp: Date.now(),
        operation: 'CLICK (rejected wrong song)', targetLabel: targetAction.label,
        provider, latencyMs: 0,
      });
      this.broadcastUpdate();
      return true;
    }

    // A search command was already applied through YouTube's results URL.
    // Even if Jev chooses TYPE_TEXT, do not request an unrelated cloud Text
    // Helper key just to re-enter the same query on an already searched page.
    if (operation === 'TYPE_TEXT' && this.navigationIntent?.searchQuery &&
        isYoutubeResultPage(snapshot.url)) {
      const recovery = await this.openYoutubeResult(tabId, snapshot, token);
      if (recovery !== null) return recovery;
      this.targetFailureCount.set(targetAction.id, 2);
      this.lastStaleNotice = 'Search query is already in YouTube results. Do not type it again; scroll to a video or click a /watch link.';
      this.broadcastUpdate();
      return true;
    }

    const policy = checkObservedTarget(targetAction, this.progress.goal);
    if (!policy.allowed) {
      this.finish('blocked', policy.reason + ' Target: ' + targetAction.label);
      return false;
    }

    // 6. TYPE_TEXT: the helper supplies the value; reuse it only for an identical input after a stale retry
    let generatedText: string | undefined;
    if (operation === 'TYPE_TEXT') {
      this.setPhase('typing');
      const context = createFieldContext(
        this.progress.goal,
        targetAction,
        { title: snapshot.title, text: snapshot.text },
        this.history
      );
      const key = JSON.stringify(context);
      if (this.pendingText && this.pendingText.key === key) {
        generatedText = this.pendingText.text;
      } else {
        const helperStarted = Date.now();
        try {
          generatedText = await generateFieldText(this.settings, context);
        } catch (err: any) {
          const message = err?.message || String(err);
          if (!/nothing typed/i.test(message)) {
            this.finish('error', `Text helper failed: ${message}`);
            return false;
          }
          // The helper could not derive a value from the goal: the field is not the way
          // forward. Tell the model and withhold the field after two attempts.
          this.consecutiveStale++;
          if (this.consecutiveStale >= MAX_CONSECUTIVE_STALE) {
            this.finish('error', `Text helper failed: ${message}`);
            return false;
          }
          this.targetFailureCount.set(targetAction.id, (this.targetFailureCount.get(targetAction.id) || 0) + 1);
          this.lastStaleNotice = `ATTENTION: No value for the field "${targetAction.label}" can be derived from the goal, so TYPE_TEXT there is not possible. Use links, buttons or other controls instead.`;
          this.broadcastUpdate();
          return true;
        } finally {
          this.recordTime('textHelperMs', Date.now() - helperStarted);
        }
        this.pendingText = { key, text: generatedText };
      }
      if (token !== this.runToken) return false;
    }

    // 7. Act (never retried)
    this.setPhase('acting');
    const actStarted = Date.now();
    this.sendStatus({ text: `${operation} ${targetAction.label}`.slice(0, 120), latencyMs });
    let navigated = false;
    try {
      const result = await this.act(tabId, targetAction, generatedText);
      if (!result.ok) {
        if (result.code === 'invalid') {
          this.finish('error', `Act execution failed: ${result.message}`);
          return false;
        }
        this.consecutiveStale++;
        if (this.consecutiveStale >= MAX_CONSECUTIVE_STALE) {
          this.finish('error', `Page kept changing before actions could run: ${result.message}`);
          return false;
        }
        // A covered or vanished target counts as a miss: the model is told, and after two
        // misses the target is withheld while alternatives exist.
        this.targetFailureCount.set(targetAction.id, (this.targetFailureCount.get(targetAction.id) || 0) + 1);
        this.lastStaleNotice = `ATTENTION: The target "${targetAction.label}" could not be acted on (${result.message}). If an overlay or dialog is open, act inside it or close it; otherwise choose a different target.`;
        this.broadcastUpdate();
        // A covered or vanished target usually means the page is still loading or animating
        // (an in-page sort or filter that swaps the list); give it more time before looking again.
        await new Promise((r) => setTimeout(r, 500 * this.consecutiveStale));
        return true; // observe again; nothing was executed
      }
    } catch (err: any) {
      const message = err?.message || String(err);
      if (!isNavigationError(message)) {
        this.finish('error', `Act execution failed: ${message}`);
        return false;
      }
      // The action ran and the page navigated before it could reply; the action still counts.
      navigated = true;
    } finally {
      this.recordTime('actionMs', Date.now() - actStarted);
    }

    // 8. Record execution before observing again
    this.consecutiveStale = 0;
    this.invalidAnswerRetried = false;
    this.pendingText = null;
    this.lastTargetActionId = targetAction.id;
    this.history.push({
      step: this.progress.currentStep + 1,
      action: `${operation} ${targetAction.label}`,
      kind: targetAction.kind,
      text: generatedText,
      page_changed: undefined,
    });
    this.progress.currentStep++;
    this.addLog({
      step: this.progress.currentStep,
      timestamp: Date.now(),
      operation,
      targetId: targetAction.id,
      targetLabel: targetAction.label,
      targetValue: generatedText,
      confidence: targetConfidence,
      latencyMs,
      provider,
      probabilities: operationAnswer.probabilities,
      goalDone,
      stuck,
    });
    this.broadcastUpdate();

    // A click, select or Enter may have started a navigation that only shows up as the tab
    // loading; observing the old document now would hand the model a page that is about to
    // disappear.
    if (this.pendingTab) {
      await this.followTab();
    } else if (navigated) {
      await this.waitForTabToLoad(tabId);
    } else {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (tab?.status === 'loading') await this.waitForTabToLoad(tabId);
    }
    return true;
  }

  /** An inconsistent model answer is not executed. The first one is simply asked again. */
  private rejectAnswer(message: string): boolean {
    if (!this.invalidAnswerRetried) {
      this.invalidAnswerRetried = true;
      this.lastStaleNotice = null;
      this.broadcastUpdate();
      return true;
    }
    this.finish('error', message);
    return false;
  }

  /** How often the same operation + label was executed within the recent window (counting the last action). */
  private repeatCount(action: string): number {
    return this.history.slice(-REPEAT_WINDOW).filter((h) => h.action === action && h.kind !== 'wait').length;
  }

  private addLog(log: AgentStepLog): void {
    this.progress.logs.unshift(log);
    if (this.progress.logs.length > 50) this.progress.logs.pop();
  }

  /** Attaches trusted input when enabled; records why not so the trace shows which path ran. */
  private async attachInput(tabId: number): Promise<void> {
    if (!this.settings.trustedInput) {
      this.progress.inputNote = 'Trusted input is off in settings; using synthetic events.';
    } else if (await this.input.attach(tabId)) {
      delete this.progress.inputNote;
    } else {
      this.progress.inputNote = TrustedInput.available()
        ? 'Could not attach the debugger (DevTools open on this tab?); using synthetic events.'
        : 'The debugger API is unavailable in this browser; using synthetic events.';
    }
    this.broadcastUpdate();
  }

  /**
   * One action: the page checks, scrolls and focuses the target, then the input is dispatched
   * through the DevTools protocol when attached, or with synthetic events otherwise. A
   * trusted dispatch that throws falls back to synthetic on the already prepared target.
   */
  private async act(tabId: number, action: PageAction, text?: string): Promise<ActResult> {
    if (this.input.attachedTab !== tabId) {
      const result: ActResult | undefined = await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_ACT', action, text });
      return result ?? { ok: false, code: 'failed', message: 'No reply from the page.' };
    }
    const prep: PrepareResult | undefined = await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_PREPARE', action, text });
    if (!prep) return { ok: false, code: 'failed', message: 'No reply from the page.' };
    if (!prep.ok) return prep;
    if (prep.done) return { ok: true, via: 'page' };
    try {
      if (action.kind === 'click') {
        await this.input.click(prep.x, prep.y);
      } else if (action.kind === 'fill') {
        await this.input.click(prep.x, prep.y);
        await this.input.insertText(text ?? '');
      } else if (action.kind === 'key') {
        await this.input.pressEnter();
      } else {
        return { ok: false, code: 'invalid', message: `Unknown action kind: ${String(action.kind)}` };
      }
    } catch (err: any) {
      // The session was lost mid-action (tab navigated away, user cancelled): synthetic events
      // on the target the page already prepared are the closest equivalent.
      const fallback: ActResult | undefined = await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_DISPATCH', action, text });
      return fallback ?? { ok: false, code: 'failed', message: err?.message || String(err) };
    }
    await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_SETTLE' }).catch(() => undefined);
    return { ok: true, via: 'cdp' };
  }

  private finish(status: 'done' | 'blocked' | 'error', message?: string): void {
    void this.input.detach();
    this.decisionAbort?.abort();
    this.decisionAbort = null;
    if (this.progress.timing) this.progress.timing.currentPhase = 'finished';
    this.progress.status = status;
    if (this.activeTabId !== null) {
      const tabId = this.activeTabId;
      const taskGoal = this.progress.goal;
      const lastOperation = this.progress.logs[0]?.operation || 'none';
      const endedAt = Date.now();
      void chrome.tabs.get(tabId).then(tab => rememberTask({
        tabId, host: new URL(tab.url || 'https://unknown.invalid').hostname,
        goal: taskGoal, outcome: status,
        lastOperation, updatedAt: endedAt,
      })).catch(() => undefined);
    }
    if (message) {
      this.progress.lastError = message;
    } else {
      delete this.progress.lastError;
    }
    // A finished run no longer needs numbered DOM badges or the floating
    // status HUD. Keep errors in the Side Panel's diagnostics instead of
    // leaving overlays stuck on the webpage after DONE / BLOCKED / ERROR.
    this.sendStatus({ clear: true });
    this.broadcastUpdate();
  }

  private setPhase(phase: AgentTiming['currentPhase']): void {
    if (this.progress.timing) this.progress.timing.currentPhase = phase;
    this.broadcastUpdate();
  }

  private recordTime(key: 'observeMs' | 'decisionMs' | 'textHelperMs' | 'actionMs' | 'waitMs' | 'startupMs', delta: number): void {
    if (this.progress.timing) {
      this.progress.timing[key] += Math.max(0, delta);
      if (key === 'observeMs') this.progress.timing.lastObserveMs = Math.max(0, delta);
    }
  }

  private broadcastUpdate(): void {
    if (this.progress.timing && this.runStartedAt) {
      this.progress.timing.totalMs = Math.max(0, Date.now() - this.runStartedAt);
    }
    try {
      chrome.runtime
        .sendMessage({ type: 'PROGRESS_UPDATE', progress: this.progress })
        .catch(() => {
          // Popup might be closed
        });
    } catch {
      // No receiver available
    }
  }

  private sendStatus(payload: { text?: string; latencyMs?: number; clear?: boolean }): void {
    if (this.activeTabId === null) return;
    try {
      chrome.tabs.sendMessage(this.activeTabId, { type: 'CONTENT_STATUS', ...payload }).catch(() => {
        // Tab may be navigating
      });
    } catch {
      // Tab gone
    }
  }
}
