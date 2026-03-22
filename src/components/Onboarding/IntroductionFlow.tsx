import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CloudOff,
  Download,
  HandHeart,
  RefreshCw,
  Shield,
  Sparkles,
  Smartphone,
  Zap,
} from 'lucide-react';
import { ThemeSwitch } from '../ui/ThemeSwitch';
import { cn } from '../../lib/utils';

type IntroSlide = {
  id: string;
  title: string;
  description: string;
  accent: string;
  icon: React.ReactNode;
  points: string[];
  footer?: React.ReactNode;
};

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface IntroductionFlowProps {
  onComplete: () => void;
}

const slideIn = {
  initial: { opacity: 0, x: 28 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -28 },
  transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const },
};

export function IntroductionFlow({ onComplete }: IntroductionFlowProps) {
  const [current, setCurrent] = useState(0);
  const [pwaReady, setPwaReady] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installState, setInstallState] = useState<'idle' | 'ready' | 'prompted' | 'installed' | 'dismissed'>('idle');
  const [installHint, setInstallHint] = useState<string | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const updateStandalone = () => {
      const standalone = window.matchMedia('(display-mode: standalone)').matches;
      setIsStandalone(standalone || (window.navigator as any).standalone === true);
    };

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallState('ready');
      setInstallHint('Install to get instant launch from your home screen.');
    };

    const handleInstalled = () => {
      setInstallState('installed');
      setInstallPrompt(null);
      setInstallHint('PWA installed. You can launch directly from your home screen.');
    };

    updateStandalone();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then(() => setPwaReady(true))
        .catch(() => setPwaReady(false));
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    window.matchMedia('(display-mode: standalone)').addEventListener('change', updateStandalone);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
      window.matchMedia('(display-mode: standalone)').removeEventListener('change', updateStandalone);
    };
  }, []);

  const slides = useMemo<IntroSlide[]>(
    () => [
      {
        id: 'hello',
        title: 'Welcome to DDU Social',
        description: 'A clean, fast hub built for Dire Dawa University students.',
        accent: 'from-primary/20 via-primary/10 to-transparent',
        icon: <Sparkles className="h-5 w-5 text-primary" />,
        points: [
          'Instagram-inspired feed with slick cards and motion',
          'Dark & light themes with a single toggle',
          'Safe-by-default auth with Telegram verification',
        ],
      },
      {
        id: 'connect',
        title: 'Share and connect effortlessly',
        description: 'Stories, chats, notifications, and profiles that feel familiar.',
        accent: 'from-emerald-300/30 via-emerald-200/20 to-transparent',
        icon: <HandHeart className="h-5 w-5 text-emerald-500" />,
        points: [
          'Post updates, stories, and reels with smooth media previews',
          'Smart notifications so you never miss follows or comments',
          'Profile-first design so people can discover you quickly',
        ],
      },
      {
        id: 'reliable',
        title: 'Built to stay reliable',
        description: 'Offline-first touches keep the app usable when campus Wi-Fi drops.',
        accent: 'from-amber-300/30 via-amber-200/20 to-transparent',
        icon: <CloudOff className="h-5 w-5 text-amber-500" />,
        points: [
          'Service worker caches the shell for quicker reloads',
          'Data-saver friendly: lean requests and lazy loading',
          'Security-first: spam checks, rate limits, and verified identities',
        ],
      },
      {
        id: 'install',
        title: 'Install the app',
        description: 'Add DDU Social to your home screen for a full PWA experience.',
        accent: 'from-blue-400/25 via-blue-300/20 to-transparent',
        icon: <Download className="h-5 w-5 text-blue-500" />,
        points: [
          installState === 'installed' || isStandalone
            ? 'Installed and ready to launch like a native app.'
            : 'Tap “Install app” below when prompted, or use your browser menu.',
          pwaReady
            ? 'Offline shell cached. You can reopen even if you lose connection.'
            : 'Preparing offline cache… keep this tab open for a moment.',
          'On iOS: Share → “Add to Home Screen”. On Android/desktop: browser menu → “Install app”.',
        ],
        footer: (
          <div className="space-y-2 rounded-lg border border-dashed border-border/80 bg-muted/30 p-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-primary" />
              <span>
                Install prompt: {installState === 'installed' || isStandalone
                  ? 'Installed'
                  : installState === 'ready'
                    ? 'Ready'
                    : 'Waiting for browser'}
              </span>
            </div>
            {installHint && <p className="text-muted-foreground">{installHint}</p>}
            {isStandalone && <p className="text-emerald-600 dark:text-emerald-400">You are already running the installed app.</p>}
          </div>
        ),
      },
    ],
    [installHint, installState, isStandalone, pwaReady]
  );

  const canGoNext = current < slides.length - 1;
  const dots = useMemo(() => slides.map((_, idx) => idx), [slides.length]);

  const handleNext = () => {
    if (canGoNext) {
      setCurrent((idx) => Math.min(slides.length - 1, idx + 1));
    } else {
      onComplete();
    }
  };

  const handleBack = () => {
    setCurrent((idx) => Math.max(0, idx - 1));
  };

  const handleInstallClick = async () => {
    setInstallHint(null);
    if (installState === 'installed' || isStandalone) {
      setInstallHint('Already installed. You can open it from your home screen or app list.');
      return;
    }
    if (!installPrompt) {
      setInstallState('idle');
      setInstallHint('Use your browser menu → “Install app” or “Add to Home Screen”.');
      return;
    }
    try {
      setInstallState('prompted');
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setInstallState('installed');
        setInstallHint('Nice! Look for the app icon on your home screen.');
      } else {
        setInstallState('dismissed');
        setInstallHint('You can install anytime from the browser menu.');
      }
    } catch {
      setInstallState('dismissed');
      setInstallHint('Something went wrong. Try again or use your browser menu.');
    }
  };

  const activeSlide = slides[current];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="fixed right-4 top-4 z-20">
        <ThemeSwitch />
      </div>

      <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-card px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <Shield className="h-3.5 w-3.5 text-primary" />
              Introduction
            </div>
            <h1 className="text-3xl font-bold tracking-tight ddu-gradient-text">DDU Social</h1>
            <p className="text-sm text-muted-foreground">Get a quick tour before you sign up.</p>
          </div>

          <div className="relative rounded-2xl border border-border bg-card/90 p-6 shadow-sm backdrop-blur">
            <div className={cn('absolute inset-0 -z-10 rounded-2xl bg-gradient-to-br', activeSlide.accent)} />
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={activeSlide.id} {...slideIn} className="space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full bg-background/70 px-3 py-1 text-xs font-semibold text-primary shadow-sm ring-1 ring-primary/10">
                  {activeSlide.icon}
                  <span>{current + 1} / {slides.length}</span>
                </div>

                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold">{activeSlide.title}</h2>
                  <p className="text-sm text-muted-foreground">{activeSlide.description}</p>
                </div>

                <ul className="space-y-2 text-sm text-foreground/90">
                  {activeSlide.points.map((point, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <div className="mt-1 h-2 w-2 rounded-full bg-primary/70" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>

                {activeSlide.id === 'install' && (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={handleInstallClick}
                      className={cn(
                        'flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition-colors',
                        installState === 'installed' || isStandalone
                          ? 'bg-emerald-500 text-emerald-50 hover:bg-emerald-500/90'
                          : 'bg-primary text-primary-foreground hover:opacity-90'
                      )}
                    >
                      {installState === 'installed' || isStandalone ? (
                        <>
                          <HandHeart className="h-4 w-4" />
                          Installed
                        </>
                      ) : installState === 'prompted' ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          Waiting for choice…
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4" />
                          Install app
                        </>
                      )}
                    </button>
                    {!pwaReady && (
                      <p className="text-xs text-muted-foreground">
                        Preparing offline cache… this only takes a moment.
                      </p>
                    )}
                  </div>
                )}

                {activeSlide.footer}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={current === 0 ? onComplete : handleBack}
              className="text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              {current === 0 ? 'Skip intro' : 'Back'}
            </button>

            <div className="flex items-center gap-2">
              {dots.map((dot) => (
                <span
                  key={dot}
                  className={cn(
                    'h-2 w-8 rounded-full transition-colors',
                    dot <= current ? 'bg-primary' : 'bg-border'
                  )}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              {canGoNext ? 'Next' : 'Start'}
              <Zap className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
