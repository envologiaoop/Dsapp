import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { ThemeSwitch } from '../ui/ThemeSwitch';
import { cn } from '../../lib/utils';
import { getTelegramDeepLink, getTelegramHandle, getTelegramProfileUrl } from '../../utils/telegram';
import {
  getPasswordValidationMessage,
  getSignupValidationErrors,
  isValidEmail,
  isValidPassword,
  isValidUsername,
  normalizeSignupInput,
  SIGNUP_YEAR_OPTIONS,
  validateAvatarFile,
} from '../../utils/validation';

// ─── Types ──────────────────────────────────────────────────────────────────────

type AuthScreen =
  | 'login'
  | 'signup-1'      // Step 1: Email + passwords
  | 'signup-2'      // Step 2: Name, username, dept, year
  | 'signup-3'      // Step 3: Avatar (optional)
  | 'forgot-req'    // Forgot password: request code
  | 'forgot-reset'  // Forgot password: enter code + new password
  | 'telegram';     // Telegram verification gate

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

interface OnboardingFlowProps {
  onFinish: (user: any) => void;
}

// ─── Small reusable components ──────────────────────────────────────────────────

function AuthInput(
  props: React.InputHTMLAttributes<HTMLInputElement> & { hasError?: boolean }
) {
  const { hasError, className, ...rest } = props;
  return (
    <input
      {...rest}
      className={cn(
        'w-full rounded-lg border bg-background px-4 py-3 text-sm outline-none transition-colors',
        'placeholder:text-muted-foreground/60',
        hasError
          ? 'border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-200 dark:focus:ring-red-900/30'
          : 'border-border focus:border-primary focus:ring-2 focus:ring-primary/15',
        className
      )}
    />
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
  disabled,
  hasError,
  name,
  onKeyDown,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  hasError?: boolean;
  name?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <AuthInput
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        hasError={hasError}
        name={name}
        onKeyDown={onKeyDown}
        className="pr-11"
      />
      <button
        type="button"
        tabIndex={-1}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <motion.p
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-1 text-xs text-red-500"
    >
      {message}
    </motion.p>
  );
}

function InlineSuccess({ message }: { message: string }) {
  return (
    <motion.p
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-1 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"
    >
      <CheckCircle2 size={11} />
      {message}
    </motion.p>
  );
}

function Banner({ tone, children }: { tone: 'error' | 'success'; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'rounded-lg border px-4 py-3 text-sm',
        tone === 'error' &&
          'border-red-200 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400',
        tone === 'success' &&
          'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-400'
      )}
    >
      {children}
    </motion.div>
  );
}

function SignupProgress({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {([1, 2, 3] as const).map((s) => (
        <div
          key={s}
          className={cn(
            'rounded-full transition-all duration-300',
            s === step
              ? 'h-1.5 w-7 bg-primary'
              : s < step
              ? 'h-1.5 w-1.5 bg-primary/40'
              : 'h-1.5 w-1.5 bg-border'
          )}
        />
      ))}
    </div>
  );
}

function PrimaryBtn({
  children,
  onClick,
  disabled,
  spinning,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  spinning?: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled || spinning}
      whileTap={disabled || spinning ? undefined : { scale: 0.98 }}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {spinning && <RefreshCw size={14} className="animate-spin" />}
      {children}
    </motion.button>
  );
}

function OutlineBtn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      className="flex w-full items-center justify-center rounded-lg border border-border bg-transparent py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted/60 disabled:opacity-50"
    >
      {children}
    </motion.button>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      <ArrowLeft size={15} />
      Back
    </button>
  );
}

function Logo() {
  return (
    <div className="text-center">
      <h1 className="text-3xl font-bold tracking-tight ddu-gradient-text">DDU Social</h1>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        Campus Connect
      </p>
    </div>
  );
}

// Animation presets
const fadeIn = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
};

const slideIn = {
  initial: { opacity: 0, x: 28 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -28 },
  transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const },
};

// ─── Main component ────────────────────────────────────────────────────────────

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ onFinish }) => {
  const [screen, setScreen] = useState<AuthScreen>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Telegram gate state
  const [pendingTelegramUser, setPendingTelegramUser] = useState<any | null>(null);
  const [pendingTelegramSource, setPendingTelegramSource] = useState<'signup' | 'login' | null>(null);
  const [pendingTelegramStatus, setPendingTelegramStatus] = useState<string | null>(null);
  const [pendingTelegramVerifying, setPendingTelegramVerifying] = useState(false);
  const [pendingTelegramRefreshing, setPendingTelegramRefreshing] = useState(false);
  const [pendingTelegramCopied, setPendingTelegramCopied] = useState(false);

  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Signup step 1 fields
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');

  // Signup step 2 fields
  const [signupName, setSignupName] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [signupDepartment, setSignupDepartment] = useState('');
  const [signupYear, setSignupYear] = useState('1');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');

  // Signup step 3 fields
  const [signupAvatarFile, setSignupAvatarFile] = useState<File | null>(null);
  const [signupAvatarPreview, setSignupAvatarPreview] = useState<string | null>(null);

  // Forgot password fields
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const usernameCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const years = useMemo(() => [...SIGNUP_YEAR_OPTIONS], []);
  const avatarMissingError = signupAvatarFile ? null : 'Profile photo is required to create your account.';
  const avatarError = avatarMissingError || validateAvatarFile(signupAvatarFile);
  const passwordHint = getPasswordValidationMessage();
  const pendingTelegramHandle = getTelegramHandle(import.meta.env.VITE_TELEGRAM_BOT_USERNAME);
  const pendingTelegramBotUrl = getTelegramProfileUrl(import.meta.env.VITE_TELEGRAM_BOT_USERNAME);

  // Real-time password match feedback
  const confirmTouched = signupConfirmPassword !== '';
  const passwordsMatch = signupPassword === signupConfirmPassword;
  const passwordMatchError = confirmTouched && !passwordsMatch;
  const passwordMatchOk = confirmTouched && passwordsMatch && signupPassword !== '';

  // Step-gating (can user proceed to next step?)
  const step1CanProceed =
    isValidEmail(signupEmail) &&
    isValidPassword(signupPassword) &&
    confirmTouched &&
    passwordsMatch;

  const step2CanProceed =
    signupName.trim().length >= 2 &&
    isValidUsername(signupUsername.trim().toLowerCase()) &&
    signupDepartment.trim().length >= 2 &&
    SIGNUP_YEAR_OPTIONS.includes(signupYear as (typeof SIGNUP_YEAR_OPTIONS)[number]) &&
    usernameStatus === 'available';

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  const resetFeedback = () => {
    setError(null);
    setSuccess(null);
  };

  const clearPendingTelegramState = () => {
    setPendingTelegramUser(null);
    setPendingTelegramSource(null);
    setPendingTelegramStatus(null);
    setPendingTelegramCopied(false);
    setPendingTelegramRefreshing(false);
    setPendingTelegramVerifying(false);
  };

  const beginTelegramGate = (user: any, source: 'signup' | 'login') => {
    setPendingTelegramUser(user);
    setPendingTelegramSource(source);
    setPendingTelegramStatus(
      source === 'signup'
        ? `Telegram linking is required. Send the code to ${pendingTelegramHandle}.`
        : `Finish Telegram linking to access your account. Send the code to ${pendingTelegramHandle}.`
    );
    setSuccess(null);
    setError(null);
    setScreen('telegram');
  };

  const finishAuth = (user: any) => {
    clearPendingTelegramState();
    onFinish(user);
  };

  const goTo = (s: AuthScreen) => {
    resetFeedback();
    setScreen(s);
  };

  const goToLogin = () => {
    clearPendingTelegramState();
    goTo('login');
  };

  // ─── API handlers ─────────────────────────────────────────────────────────────

  const handleLogin = async () => {
    setLoading(true);
    resetFeedback();
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Login failed');
      const authenticatedUser = data?.token ? { ...data.user, authToken: data.token } : data.user;
      if (data?.user?.telegramChatId) {
        finishAuth(authenticatedUser);
      } else {
        beginTelegramGate(authenticatedUser, 'login');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const checkUsernameAvailability = async (
    usernameInput?: string,
    opts: { showError?: boolean } = {}
  ): Promise<boolean> => {
    const normalized = normalizeSignupInput({ username: usernameInput ?? signupUsername }).username;
    if (!normalized) {
      setUsernameStatus('idle');
      return false;
    }
    if (!/^[a-z0-9_.]{3,20}$/.test(normalized)) {
      setUsernameStatus('invalid');
      if (opts.showError) {
        setError('Use 3-20 lowercase letters, numbers, underscores, or periods.');
      }
      return false;
    }
    setUsernameStatus('checking');
    try {
      const response = await fetch(
        `/api/auth/check-username?username=${encodeURIComponent(normalized)}`
      );
      const data = await response.json().catch(() => null);
      const available = Boolean(response.ok && data?.available);
      setUsernameStatus(available ? 'available' : 'taken');
      if (!available && opts.showError) {
        setError('That username is already taken. Try another one.');
      }
      return available;
    } catch {
      setUsernameStatus('idle');
      if (opts.showError) {
        setError('Unable to check username right now. Please try again.');
      }
      return false;
    }
  };

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    resetFeedback();
    const validationError = validateAvatarFile(file);
    if (validationError) {
      setSignupAvatarFile(null);
      setSignupAvatarPreview(null);
      setError(validationError);
      return;
    }
    setSignupAvatarFile(file);
    if (!file) {
      setSignupAvatarPreview(null);
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => setSignupAvatarPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleProceedToStep3 = async () => {
    resetFeedback();
    const usernameAvailable = await checkUsernameAvailability(undefined, { showError: true });
    if (!usernameAvailable) return;
    setScreen('signup-3');
  };

  const handleSignup = async () => {
    // Normalise all signup fields including confirmPassword in one call
    const normalized = normalizeSignupInput({
      name: signupName,
      username: signupUsername,
      email: signupEmail,
      password: signupPassword,
      confirmPassword: signupConfirmPassword,
      department: signupDepartment,
      year: signupYear,
    });

    // BUG FIX: use the fully normalised object so confirmPassword goes through
    // the same normalisation pass as password — prevents false mismatch errors.
    const validationErrors = getSignupValidationErrors(normalized);

    if (avatarError) {
      setError(avatarError);
      return;
    }
    if (validationErrors.length > 0) {
      setError(validationErrors[0]);
      return;
    }
    const usernameAvailable = await checkUsernameAvailability(normalized.username, { showError: true });
    if (!usernameAvailable) {
      setScreen('signup-2');
      return;
    }
    setLoading(true);
    resetFeedback();
    try {
      const form = new FormData();
      form.append('name', normalized.name);
      form.append('username', normalized.username);
      form.append('email', normalized.email);
      form.append('password', normalized.password);
      form.append('confirmPassword', normalized.confirmPassword);
      form.append('department', normalized.department);
      form.append('year', normalized.year);
      if (signupAvatarFile) form.append('avatar', signupAvatarFile);
      const res = await fetch('/api/auth/signup', { method: 'POST', body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Signup failed');
      const signedUpUser = data?.token ? { ...data.user, authToken: data.token } : data.user;
      beginTelegramGate(signedUpUser, 'signup');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  const requestReset = async () => {
    setLoading(true);
    resetFeedback();
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: forgotIdentifier.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to request reset');
      goTo('forgot-reset');
      setSuccess(
        data?.delivery === 'telegram'
          ? 'Reset code sent to your linked Telegram account.'
          : 'If that account is linked to Telegram, a reset code has been sent there.'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to request reset');
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    resetFeedback();
    // Guard password match BEFORE setLoading to avoid a spurious loading flash
    if (newPassword !== confirmNewPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: forgotIdentifier.trim(),
          code: resetCode.trim(),
          newPassword,
          confirmPassword: confirmNewPassword,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to reset password');

      // Auto-login after successful password reset
      if (data?.autoLogin && data?.user && data?.token) {
        const authenticatedUser = { ...data.user, authToken: data.token };
        if (data.user.telegramChatId) {
          finishAuth(authenticatedUser);
        } else {
          beginTelegramGate(authenticatedUser, 'login');
        }
      } else {
        // Fallback to manual login if auto-login not available
        if (forgotIdentifier.includes('@')) {
          setLoginEmail(forgotIdentifier);
        }
        setLoginPassword('');
        setResetCode('');
        setNewPassword('');
        setConfirmNewPassword('');
        setForgotIdentifier('');
        goTo('login');
        setSuccess('Password updated. You can sign in now.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  const refreshPendingTelegramCode = async () => {
    if (!pendingTelegramUser?.id) return;
    setPendingTelegramRefreshing(true);
    setPendingTelegramStatus(null);
    try {
      const response = await fetch('/api/auth/telegram-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: pendingTelegramUser.id }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Unable to refresh Telegram code.');
      }
      setPendingTelegramUser((prev: any) =>
        prev
          ? { ...prev, telegramAuthCode: data.telegramAuthCode, telegramChatId: undefined }
          : prev
      );
      setPendingTelegramStatus(`New code generated. Send it to ${pendingTelegramHandle} now.`);
    } catch (e) {
      setPendingTelegramStatus(
        e instanceof Error ? e.message : 'Unable to refresh Telegram code.'
      );
    } finally {
      setPendingTelegramRefreshing(false);
    }
  };

  const verifyPendingTelegramLink = async () => {
    if (!pendingTelegramUser?.telegramAuthCode) return;
    setPendingTelegramVerifying(true);
    setPendingTelegramStatus(null);
    try {
      const response = await fetch(
        `/api/auth/verify-telegram/${pendingTelegramUser.telegramAuthCode}`
      );
      const data = await response.json().catch(() => null);
      if (data?.verified && data?.user?.telegramChatId) {
        finishAuth(data.user);
        return;
      }
      if (data?.error) {
        if (data.error.includes('expired')) {
          setPendingTelegramStatus(
            'Code has expired. Please generate a new code using the "New code" button below.'
          );
        } else {
          setPendingTelegramStatus(data.error);
        }
      } else if (data?.waiting) {
        setPendingTelegramStatus(
          `Still waiting for verification. Send the code to ${pendingTelegramHandle}, then try again.`
        );
      } else {
        setPendingTelegramStatus(
          `Unable to verify. Please ensure you sent the code to ${pendingTelegramHandle}.`
        );
      }
    } catch (e) {
      setPendingTelegramStatus(
        e instanceof Error ? e.message : 'Unable to verify Telegram right now.'
      );
    } finally {
      setPendingTelegramVerifying(false);
    }
  };

  const copyPendingTelegramCode = async () => {
    if (!pendingTelegramUser?.telegramAuthCode) return;
    try {
      await navigator.clipboard.writeText(pendingTelegramUser.telegramAuthCode);
      setPendingTelegramCopied(true);
      setPendingTelegramStatus('Telegram code copied.');
      setTimeout(() => setPendingTelegramCopied(false), 2000);
    } catch {
      setPendingTelegramStatus('Unable to copy the Telegram code right now.');
    }
  };

  const usernameHint =
    usernameStatus === 'checking'
      ? { tone: 'muted' as const, msg: 'Checking availability\u2026' }
      : usernameStatus === 'available'
      ? { tone: 'success' as const, msg: '\u2713 Username is available.' }
      : usernameStatus === 'taken'
      ? { tone: 'error' as const, msg: 'That username is already taken.' }
      : usernameStatus === 'invalid'
      ? { tone: 'error' as const, msg: 'Use 3\u201320 lowercase letters, numbers, _ or .' }
      : null;

  useEffect(
    () => () => {
      if (usernameCheckTimeoutRef.current) {
        clearTimeout(usernameCheckTimeoutRef.current);
      }
    },
    []
  );

  // ─── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Theme toggle */}
      <div className="fixed right-4 top-4 z-20">
        <ThemeSwitch />
      </div>

      <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <AnimatePresence mode="wait">

            {/* ╔══════════════╗ */}
            {/* ║    LOGIN     ║ */}
            {/* ╚══════════════╝ */}
            {screen === 'login' && (
              <motion.div key="login" {...fadeIn} className="space-y-5">
                <Logo />

                <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                  <AnimatePresence>
                    {error && <Banner tone="error">{error}</Banner>}
                    {success && <Banner tone="success">{success}</Banner>}
                  </AnimatePresence>

                  <AuthInput
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                    placeholder="Email address"
                    type="email"
                    autoComplete="email"
                    disabled={loading}
                  />

                  <PasswordInput
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                    placeholder="Password"
                    autoComplete="current-password"
                    disabled={loading}
                    name="current-password"
                  />

                  <PrimaryBtn
                    onClick={handleLogin}
                    disabled={!loginEmail.trim() || !loginPassword.trim()}
                    spinning={loading}
                  >
                    {loading ? 'Signing in\u2026' : 'Log in'}
                  </PrimaryBtn>

                  <button
                    type="button"
                    onClick={() => goTo('forgot-req')}
                    className="w-full text-center text-xs font-semibold text-primary hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>

                <div className="rounded-xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
                  Don&apos;t have an account?{' '}
                  <button
                    type="button"
                    onClick={() => goTo('signup-1')}
                    className="font-semibold text-primary hover:underline"
                  >
                    Sign up
                  </button>
                </div>
              </motion.div>
            )}

            {/* ╔════════════════════════════════╗ */}
            {/* ║  SIGNUP STEP 1: Email+Passwords ║ */}
            {/* ╚════════════════════════════════╝ */}
            {screen === 'signup-1' && (
              <motion.div key="signup-1" {...slideIn} className="space-y-5">
                <div className="space-y-3">
                  <BackBtn onClick={() => goTo('login')} />
                  <Logo />
                  <div className="text-center">
                    <h2 className="text-xl font-bold">Create account</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Start with your email and a secure password.
                    </p>
                  </div>
                  <SignupProgress step={1} />
                </div>

                <div className="rounded-xl border border-border bg-card p-6 space-y-3">
                  <AnimatePresence>
                    {error && <Banner tone="error">{error}</Banner>}
                  </AnimatePresence>

                  {/* Email */}
                  <div>
                    <AuthInput
                      value={signupEmail}
                      onChange={(e) => { setSignupEmail(e.target.value); resetFeedback(); }}
                      placeholder="Email address"
                      type="email"
                      autoComplete="email"
                      disabled={loading}
                      hasError={signupEmail !== '' && !isValidEmail(signupEmail)}
                    />
                    {signupEmail !== '' && !isValidEmail(signupEmail) && (
                      <InlineError message="Enter a valid email address." />
                    )}
                  </div>

                  {/* Password */}
                  <div>
                    <PasswordInput
                      value={signupPassword}
                      onChange={(e) => { setSignupPassword(e.target.value); resetFeedback(); }}
                      placeholder="Password"
                      autoComplete="new-password"
                      disabled={loading}
                      hasError={signupPassword !== '' && !isValidPassword(signupPassword)}
                      name="new-password"
                    />
                    {signupPassword !== '' && !isValidPassword(signupPassword) && (
                      <InlineError message={passwordHint} />
                    )}
                  </div>

                  {/* Confirm password */}
                  <div>
                    <PasswordInput
                      value={signupConfirmPassword}
                      onChange={(e) => { setSignupConfirmPassword(e.target.value); resetFeedback(); }}
                      placeholder="Confirm password"
                      autoComplete="new-password"
                      disabled={loading}
                      hasError={passwordMatchError}
                      name="confirm-new-password"
                    />
                    {passwordMatchError && (
                      <InlineError message="Passwords don\u2019t match." />
                    )}
                    {passwordMatchOk && (
                      <InlineSuccess message="Passwords match" />
                    )}
                  </div>

                  <PrimaryBtn
                    onClick={() => { resetFeedback(); setScreen('signup-2'); }}
                    disabled={!step1CanProceed}
                  >
                    Next
                  </PrimaryBtn>
                </div>

                <div className="rounded-xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={goToLogin}
                    className="font-semibold text-primary hover:underline"
                  >
                    Log in
                  </button>
                </div>
              </motion.div>
            )}

            {/* ╔═════════════════════════════════╗ */}
            {/* ║  SIGNUP STEP 2: Profile Info     ║ */}
            {/* ╚═════════════════════════════════╝ */}
            {screen === 'signup-2' && (
              <motion.div key="signup-2" {...slideIn} className="space-y-5">
                <div className="space-y-3">
                  <BackBtn onClick={() => goTo('signup-1')} />
                  <Logo />
                  <div className="text-center">
                    <h2 className="text-xl font-bold">Your profile</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Tell us a bit about yourself.
                    </p>
                  </div>
                  <SignupProgress step={2} />
                </div>

                <div className="rounded-xl border border-border bg-card p-6 space-y-3">
                  <AnimatePresence>
                    {error && <Banner tone="error">{error}</Banner>}
                  </AnimatePresence>

                  {/* Full name */}
                  <div>
                    <AuthInput
                      value={signupName}
                      onChange={(e) => { setSignupName(e.target.value); resetFeedback(); }}
                      placeholder="Full name"
                      autoComplete="name"
                      disabled={loading}
                      hasError={signupName !== '' && signupName.trim().length < 2}
                    />
                    {signupName !== '' && signupName.trim().length < 2 && (
                      <InlineError message="Name must be at least 2 characters." />
                    )}
                  </div>

                  {/* Username */}
                  <div>
                    <AuthInput
                      value={signupUsername}
                      onChange={(e) => {
                        const nextUsername = e.target.value.toLowerCase();
                        setSignupUsername(nextUsername);
                        resetFeedback();
                        if (usernameCheckTimeoutRef.current) {
                          clearTimeout(usernameCheckTimeoutRef.current);
                        }
                        if (!nextUsername.trim()) {
                          setUsernameStatus('idle');
                          return;
                        }
                        setUsernameStatus('checking');
                        usernameCheckTimeoutRef.current = setTimeout(() => {
                          void checkUsernameAvailability(nextUsername);
                        }, 300);
                      }}
                      onBlur={() => void checkUsernameAvailability()}
                      placeholder="Username (e.g. ddu_student)"
                      autoComplete="username"
                      disabled={loading}
                      hasError={usernameStatus === 'taken' || usernameStatus === 'invalid'}
                    />
                    {usernameHint && (
                      <p
                        className={cn(
                          'mt-1 text-xs',
                          usernameHint.tone === 'success' &&
                            'text-emerald-600 dark:text-emerald-400',
                          usernameHint.tone === 'error' && 'text-red-500',
                          usernameHint.tone === 'muted' && 'text-muted-foreground'
                        )}
                      >
                        {usernameHint.msg}
                      </p>
                    )}
                  </div>

                  {/* Department */}
                  <div>
                    <AuthInput
                      value={signupDepartment}
                      onChange={(e) => { setSignupDepartment(e.target.value); resetFeedback(); }}
                      placeholder="Department or program"
                      disabled={loading}
                      hasError={signupDepartment !== '' && signupDepartment.trim().length < 2}
                    />
                    {signupDepartment !== '' && signupDepartment.trim().length < 2 && (
                      <InlineError message="Enter your department." />
                    )}
                  </div>

                  {/* Academic year */}
                  <select
                    value={signupYear}
                    onChange={(e) => setSignupYear(e.target.value)}
                    disabled={loading}
                    className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
                  >
                    {years.map((year) => (
                      <option key={year} value={year}>
                        {year === 'remedial' ? 'Remedial' : `Year ${year}`}
                      </option>
                    ))}
                  </select>

                  <PrimaryBtn
                    onClick={handleProceedToStep3}
                    disabled={!step2CanProceed}
                    spinning={loading}
                  >
                    Next
                  </PrimaryBtn>
                </div>
              </motion.div>
            )}

            {/* ╔══════════════════════════════╗ */}
            {/* ║  SIGNUP STEP 3: Avatar       ║ */}
            {/* ╚══════════════════════════════╝ */}
            {screen === 'signup-3' && (
              <motion.div key="signup-3" {...slideIn} className="space-y-5">
                <div className="space-y-3">
                  <BackBtn onClick={() => goTo('signup-2')} />
                  <Logo />
                  <div className="text-center">
                    <h2 className="text-xl font-bold">Add a profile photo</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Faces beat blank circles. Add yours to keep things friendly.
                    </p>
                  </div>
                  <SignupProgress step={3} />
                </div>

                <div className="rounded-xl border border-border bg-card p-6 space-y-5">
                  <AnimatePresence>
                    {error && <Banner tone="error">{error}</Banner>}
                  </AnimatePresence>

                  <div className="flex flex-col items-center gap-4">
                    <motion.button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={loading}
                      whileHover={loading ? undefined : { scale: 1.04 }}
                      whileTap={loading ? undefined : { scale: 0.97 }}
                      className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-border bg-muted/40 transition-colors hover:border-primary/50"
                    >
                      {signupAvatarPreview ? (
                        <img
                          src={signupAvatarPreview}
                          alt="Avatar preview"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-1 text-muted-foreground">
                          <Camera size={24} />
                          <span className="text-[10px]">Tap to upload</span>
                        </div>
                      )}
                    </motion.button>

                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                      onChange={handleAvatarSelect}
                      className="hidden"
                    />

                    {signupAvatarPreview ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSignupAvatarFile(null);
                          setSignupAvatarPreview(null);
                        }}
                        className="text-xs text-muted-foreground hover:text-red-500 transition-colors"
                      >
                        Remove photo
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => avatarInputRef.current?.click()}
                        className="text-sm font-semibold text-primary hover:underline"
                        disabled={loading}
                      >
                        Add photo
                      </button>
                    )}
                  </div>

                  {avatarError && <InlineError message={avatarError} />}

                  <PrimaryBtn
                    onClick={handleSignup}
                    disabled={Boolean(avatarError)}
                    spinning={loading}
                  >
                    {loading ? 'Creating account\u2026' : 'Create account'}
                  </PrimaryBtn>
                </div>
              </motion.div>
            )}

            {/* ╔════════════════════════════════════╗ */}
            {/* ║  FORGOT PASSWORD – REQUEST CODE    ║ */}
            {/* ╚════════════════════════════════════╝ */}
            {screen === 'forgot-req' && (
              <motion.div key="forgot-req" {...fadeIn} className="space-y-5">
                <div className="space-y-3">
                  <BackBtn onClick={() => goTo('login')} />
                  <Logo />
                  <div className="text-center">
                    <h2 className="text-xl font-bold">Forgot password?</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Enter your email or username and we&apos;ll send a reset code to your Telegram.
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                  <AnimatePresence>
                    {error && <Banner tone="error">{error}</Banner>}
                    {success && <Banner tone="success">{success}</Banner>}
                  </AnimatePresence>

                  <div className="flex justify-center">
                    <div className="rounded-full bg-primary/10 p-4 text-primary">
                      <Mail size={28} />
                    </div>
                  </div>

                  <AuthInput
                    value={forgotIdentifier}
                    onChange={(e) => { setForgotIdentifier(e.target.value); resetFeedback(); }}
                    onKeyDown={(e) => e.key === 'Enter' && requestReset()}
                    placeholder="Email or username"
                    autoComplete="username"
                    disabled={loading}
                  />

                  <PrimaryBtn
                    onClick={requestReset}
                    disabled={!forgotIdentifier.trim()}
                    spinning={loading}
                  >
                    {loading ? 'Sending code\u2026' : 'Send reset code'}
                  </PrimaryBtn>
                </div>
              </motion.div>
            )}

            {/* ╔════════════════════════════════════╗ */}
            {/* ║  FORGOT PASSWORD – RESET           ║ */}
            {/* ╚════════════════════════════════════╝ */}
            {screen === 'forgot-reset' && (
              <motion.div key="forgot-reset" {...slideIn} className="space-y-5">
                <div className="space-y-3">
                  <BackBtn
                    onClick={() => {
                      resetFeedback();
                      setResetCode('');
                      setNewPassword('');
                      setConfirmNewPassword('');
                      goTo('forgot-req');
                    }}
                  />
                  <Logo />
                  <div className="text-center">
                    <h2 className="text-xl font-bold">Enter reset code</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Enter the 6-digit code from Telegram and choose a new password.
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-6 space-y-3">
                  <AnimatePresence>
                    {error && <Banner tone="error">{error}</Banner>}
                    {success && <Banner tone="success">{success}</Banner>}
                  </AnimatePresence>

                  <div className="flex justify-center">
                    <div className="rounded-full bg-primary/10 p-4 text-primary">
                      <KeyRound size={28} />
                    </div>
                  </div>

                  <AuthInput
                    value={resetCode}
                    onChange={(e) => {
                      setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                      resetFeedback();
                    }}
                    placeholder="6-digit code"
                    inputMode="numeric"
                    disabled={loading}
                    className="text-center text-lg font-mono tracking-[0.45em]"
                  />

                  <div>
                    <PasswordInput
                      value={newPassword}
                      onChange={(e) => { setNewPassword(e.target.value); resetFeedback(); }}
                      placeholder="New password"
                      autoComplete="new-password"
                      disabled={loading}
                      hasError={newPassword !== '' && !isValidPassword(newPassword)}
                      name="reset-new-password"
                    />
                    {newPassword !== '' && !isValidPassword(newPassword) && (
                      <InlineError message={passwordHint} />
                    )}
                  </div>

                  <div>
                    <PasswordInput
                      value={confirmNewPassword}
                      onChange={(e) => { setConfirmNewPassword(e.target.value); resetFeedback(); }}
                      placeholder="Confirm new password"
                      autoComplete="new-password"
                      disabled={loading}
                      hasError={confirmNewPassword !== '' && newPassword !== confirmNewPassword}
                      name="reset-confirm-password"
                    />
                    {confirmNewPassword !== '' && newPassword !== confirmNewPassword && (
                      <InlineError message="Passwords don\u2019t match." />
                    )}
                    {confirmNewPassword !== '' &&
                      newPassword === confirmNewPassword &&
                      newPassword !== '' && <InlineSuccess message="Passwords match" />}
                  </div>

                  <div className="flex gap-3">
                    <OutlineBtn
                      onClick={requestReset}
                      disabled={loading || !forgotIdentifier.trim()}
                    >
                      Resend code
                    </OutlineBtn>
                    <PrimaryBtn
                      onClick={resetPassword}
                      disabled={
                        resetCode.trim().length !== 6 ||
                        !newPassword.trim() ||
                        !confirmNewPassword.trim() ||
                        newPassword !== confirmNewPassword ||
                        !isValidPassword(newPassword)
                      }
                      spinning={loading}
                    >
                      {loading ? 'Resetting\u2026' : 'Reset password'}
                    </PrimaryBtn>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ╔════════════════╗ */}
            {/* ║ TELEGRAM GATE  ║ */}
            {/* ╚════════════════╝ */}
            {screen === 'telegram' && pendingTelegramUser && (
              <motion.div key="telegram" {...fadeIn} className="space-y-5">
                <Logo />

                <div className="text-center">
                  <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <ShieldCheck size={28} />
                  </div>
                  <h2 className="text-xl font-bold">Link Telegram to continue</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {pendingTelegramSource === 'signup'
                      ? 'Telegram linking is required to activate your account.'
                      : 'This account must finish Telegram linking before access is allowed.'}
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                  <AnimatePresence>
                    {pendingTelegramStatus && (
                      <Banner tone="success">{pendingTelegramStatus}</Banner>
                    )}
                  </AnimatePresence>

                  <div className="rounded-lg border border-dashed border-border bg-muted/30 py-5 text-center">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Your Telegram Code
                    </p>
                    <p className="font-mono text-3xl font-bold tracking-[0.5em] text-primary">
                      {pendingTelegramUser.telegramAuthCode || '------'}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <OutlineBtn
                      onClick={copyPendingTelegramCode}
                      disabled={!pendingTelegramUser.telegramAuthCode}
                    >
                      {pendingTelegramCopied ? '\u2713 Copied' : 'Copy code'}
                    </OutlineBtn>
                    <a
                      href={
                        pendingTelegramUser.telegramAuthCode
                          ? getTelegramDeepLink(
                              pendingTelegramUser.telegramAuthCode,
                              import.meta.env.VITE_TELEGRAM_BOT_USERNAME
                            )
                          : pendingTelegramBotUrl
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      Open Telegram
                    </a>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <OutlineBtn
                      onClick={refreshPendingTelegramCode}
                      disabled={pendingTelegramRefreshing || pendingTelegramVerifying}
                    >
                      {pendingTelegramRefreshing ? (
                        <span className="flex items-center gap-1.5">
                          <RefreshCw size={13} className="animate-spin" />
                          Generating\u2026
                        </span>
                      ) : (
                        'New code'
                      )}
                    </OutlineBtn>
                    <PrimaryBtn
                      onClick={verifyPendingTelegramLink}
                      disabled={pendingTelegramVerifying || pendingTelegramRefreshing}
                      spinning={pendingTelegramVerifying}
                    >
                      {pendingTelegramVerifying ? 'Checking\u2026' : "I\u2019ve linked it"}
                    </PrimaryBtn>
                  </div>

                  <p className="text-center text-xs text-muted-foreground">
                    Send the code to{' '}
                    <a
                      href={pendingTelegramBotUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-primary hover:underline"
                    >
                      {pendingTelegramHandle}
                    </a>{' '}
                    on Telegram to verify.
                  </p>
                </div>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={goToLogin}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Use a different account
                  </button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
